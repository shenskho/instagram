"""Render engine: executes an edit plan (EDL JSON) on a raw talking-head video.
Segments of the output timeline are independent, so they render in parallel worker processes
and are joined at the end.

Per frame:  camera → grade → background layer (scene / sky / flyover / particles / focus / clones)
            → person over background (+ rim light, glow) → foreground → look (whole / background / subject)
            → shake / tilt → transition → textures → graphics + captions (one layer, restyled by the skin)."""
import json, math, os, subprocess, sys, time, hashlib
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter

from . import fx, media, looks, scenes
from . import motion as mo
from .motion import smooth, blit, FONT, ACCENT
from .matting import Segmenter, CleanPlate, head_info
from .particles import Particles, Flyover

# effects that cut the person out of the background (they need the precise matte)
COMP_FX = {"scene", "sky_fly", "jungle", "dinosaur_walk", "flyover", "focus", "glow", "clones"}
PREV_TR = {"dissolve", "slide", "circle"}          # transitions that blend with the previous shot
TR_FRAMES = {"whip": 6, "glitch": 7, "flash": 5, "zoom_in": 7, "zoom_out": 8, "spin": 9, "dissolve": 9, "slide": 8,
             "circle": 10, "blur": 8, "light_leak": 12}
COLORS = {"yellow": (255, 210, 31), "purple": (108, 76, 255), "blue": (52, 120, 246), "pink": (255, 110, 190),
          "black": (14, 14, 18), "white": (250, 250, 250), "cyan": (60, 220, 240), "red": (232, 52, 52)}


# =================================================================== plan
class Plan:
    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.dir = os.path.dirname(self.path)
        with open(self.path, encoding="utf-8") as f:
            self.E = json.load(f)
        E = self.E
        self.source = self._resolve(E["source"])
        self.output = self._resolve(E["output"]["path"])
        self.OW, self.OH, self.FPS = E["output"].get("w", 1080), E["output"].get("h", 1920), E["output"].get("fps", 30)
        self.work = os.path.join(os.path.dirname(self.output), ".work", os.path.splitext(os.path.basename(self.output))[0])
        os.makedirs(self.work, exist_ok=True)
        self.segs, pos = [], 0
        for s in E["timeline"]:
            f0 = int(math.ceil(s["src"][0] * self.FPS - 1e-6))
            f1 = max(f0 + 1, int(math.ceil(s["src"][1] * self.FPS - 1e-6)))
            if s.get("hold"):   # freeze frame: one source frame held for `hold` seconds
                frames = [f0] * max(1, int(round(s["hold"] * self.FPS)))
            elif s.get("reverse"):
                frames = list(range(f1 - 1, f0 - 1, -int(s.get("speed", 1))))
            else:
                frames = list(range(f0, f1))
            self.segs.append(dict(spec=s, f0=f0, f1=f1, frames=frames, out0=pos, role=s.get("role")))
            pos += len(frames)
        self.total = pos
        self.duration = pos / self.FPS
        self.thuds = []
        for s in E.get("sfx", []):
            if s["type"] == "thuds":
                t = s["t0"]
                while t < s["t1"]:
                    self.thuds.append(t); t += s["every"]
        self.shakes = [dict(t=t, amp=1.0, dur=0.3) for t in self.thuds] + E.get("shakes", [])

    def _resolve(self, p):
        return p if os.path.isabs(p) else os.path.normpath(os.path.join(self.dir, p))

    def occurrences(self, t, roles=(None, "cold_open")):
        res = []
        for sg in self.segs:
            if sg["spec"].get("reverse") or sg["spec"].get("hold") or sg["role"] not in roles:
                continue
            if sg["f0"] / self.FPS <= t < sg["f1"] / self.FPS:
                res.append((sg["out0"] + (t * self.FPS - sg["f0"])) / self.FPS)
        return res


def _legacy_effects(effects):
    """v0.2 effect names -> v0.3 ones."""
    out = []
    for e in effects:
        if e["type"] == "jungle":
            out.append({**e, "type": "scene", "places": [{"kind": "drawn", "id": "jungle"}], "motion": e.get("motion", "sway")})
        elif e["type"] == "dinosaur_walk":
            out.append({**e, "type": "flyover", "object": "dinosaur", "direction": e.get("direction", "rtl")})
        else:
            out.append(e)
    return out


# =================================================================== engine (one per process)
class Engine:
    def __init__(self, plan, plate_path=None, level_path=None, threads=2):
        self.P = P = plan
        E = P.E
        info = media.probe(P.source)
        self.SW, self.SH = info["width"], info["height"]
        self.OW, self.OH, self.FPS = P.OW, P.OH, P.FPS
        self.seg = Segmenter(self.SW, self.SH, threads=threads)
        self.plate = CleanPlate.load(plate_path) if plate_path and os.path.exists(plate_path) else CleanPlate()
        self.level = np.load(level_path) if level_path and os.path.exists(level_path) else None
        # camera grade
        G = self.G = E.get("grade", {"contrast": 1.1, "saturation": 1.12, "warmth": 0.03, "highlight_rolloff": 0.12, "vignette": 0.2})
        lx = np.arange(256, dtype=np.float32) / 255
        lut = 0.5 + (lx - 0.5) * G["contrast"]
        lut = np.where(lut > 0.78, 0.78 + (lut - 0.78) * (1 - G["highlight_rolloff"] * 2.2), lut)
        self.LUT = np.clip(lut * 255, 0, 255).astype(np.uint8)
        yy, xx = np.mgrid[0:self.OH, 0:self.OW].astype(np.float32)
        rr = ((xx - self.OW / 2) / (self.OW / 2)) ** 2 + ((yy - self.OH / 2) / (self.OH / 2)) ** 2
        self.VIGN = (1 - G["vignette"] * np.clip(rr - 0.25, 0, None) / 1.75)[..., None].astype(np.float32)
        rng = np.random.default_rng(1)
        g = E.get("grain", 0)
        self.GRAIN = [cv2.resize((rng.standard_normal((self.OH // 2, self.OW // 2)) * g).astype(np.float32),
                                 (self.OW, self.OH))[..., None] for _ in range(6)] if g else None
        # theme
        lk = E.get("look") or {}
        self.look = lk.get("style", "natural") if lk.get("style") in looks.STYLES else "natural"
        self.look_scope = lk.get("scope", "whole")
        self.skin = E.get("skin") or looks.SKIN_OF.get(self.look, "clean")
        self.texture = looks.Texture(E.get("overlays", []), self.OW, self.OH, self.FPS)
        # effects
        self.EFX = _legacy_effects(E.get("effects", []))
        self.SKY = {}
        self.SUN = None
        for e in self.EFX:
            if e["type"] == "sun": self.SUN = fx.sun_sprite(e.get("r", 95))
        self._scene_src = {}
        self._parts = {}
        self._fly = {}
        self.GFX = [(g, mo.build(g)) for g in E.get("graphics", [])]
        self._cap = {}
        self.Z = E.get("zoom", {"slow_push_per_sec": 0.012, "punches": []})
        self.AZ = E.get("auto_zoom", {"target_head_px": 185, "max": 1.4})
        self.tilts = E.get("tilts", [])

    # ------------------------------------------------------------- helpers
    def LEVEL(self, t):
        if self.level is None: return 0.3
        i = int(t * 100)
        return float(self.level[min(max(i, 0), len(self.level) - 1)])

    def grade(self, img):
        G = self.G
        x = cv2.LUT(img, self.LUT).astype(np.float32)
        l = x[..., 0:1] * 0.299 + x[..., 1:2] * 0.587 + x[..., 2:3] * 0.114
        x = l + (x - l) * G["saturation"]
        x[..., 0] *= 1 + G["warmth"]; x[..., 2] *= 1 - G["warmth"]
        x *= self.VIGN
        return np.clip(x, 0, 255).astype(np.uint8)

    def active(self, name, ts):
        for i, e in enumerate(self.EFX):
            if e["type"] == name and e["t0"] <= ts < e["t1"]:
                return i, e, (ts - e["t0"]) / max(1e-6, e["t1"] - e["t0"])
        return None

    def in_fx(self, name, ts):
        a = self.active(name, ts)
        return (a[1], a[2]) if a else None

    def needs_matte(self, ts):
        if self.look != "natural" and self.look_scope != "whole":
            return True
        if any(e["t0"] <= ts < e["t1"] and e["type"] in COMP_FX for e in self.EFX):
            return True
        return any(e["type"] == "particles" and e.get("layer") == "behind" and e["t0"] <= ts < e["t1"] for e in self.EFX)

    def shake_amount(self, ts):
        a = 0.0
        for s in self.P.shakes:
            if 0 <= ts - s["t"] < s["dur"]:
                a = max(a, s["amp"] * (1 - (ts - s["t"]) / s["dur"]) ** 2)
        return a

    def tilt_angle(self, ts):
        for t in self.tilts:
            u = (ts - t["t"]) / t.get("dur", 0.8)
            if 0 <= u < 1:
                return t.get("angle", 8) * (math.sin(min(1, u * 3) * math.pi / 2) if u < 0.33 else smooth((1 - u) / 0.67))
        return 0.0

    def draw_sun(self, bg, e, ts):
        rays, disc, glow = self.SUN
        tl = ts - e["t0"]
        k = mo.back_out(tl / 0.35) if tl < 0.35 else 1.0
        cx, cy = e.get("x", 760), e.get("y", 330)
        gh, gw = glow.shape
        y0, x0 = int(cy - gh / 2), int(cx - gw / 2)
        ya, xa, yb, xb = max(0, y0), max(0, x0), min(self.OH, y0 + gh), min(self.OW, x0 + gw)
        f = bg[ya:yb, xa:xb].astype(np.float32)
        f += glow[ya - y0:yb - y0, xa - x0:xb - x0, None] * np.array([255, 196, 80], np.float32) * 0.6 * min(1, tl / 0.3)
        bg[ya:yb, xa:xb] = np.clip(f, 0, 255).astype(np.uint8)
        blit(bg, rays, cx, cy, scale=max(0.01, k), angle=tl * 14)
        blit(bg, disc, cx, cy, scale=max(0.01, k * (1 + 0.025 * math.sin(tl * 3))))

    def scene_sources(self, i, e):
        if i not in self._scene_src:
            own = e.get("style")
            fn = (lambda im, st=own: looks.apply(im, st)) if own and own != "natural" else None
            self._scene_src[i] = [scenes.Source(sp, self.P.dir, fn) for sp in e.get("places", [{"kind": "drawn", "id": "jungle"}])]
        return self._scene_src[i]

    def sky(self, time_):
        if time_ not in self.SKY: self.SKY[time_] = scenes.sky_texture(time_)
        return self.SKY[time_]

    def active_graphics(self, sg, ts, lt):
        out = []
        for g, el in self.GFX:
            if "role" in g:
                if sg["role"] == g["role"] and g["at"] <= lt < g["at"] + g["dur"]:
                    out.append((el, lt - g["at"], g["dur"]))
            elif sg["role"] is None and g["t0"] <= ts < g["t1"]:
                out.append((el, ts - g["t0"], g["t1"] - g["t0"]))
        return out

    def zoom_at(self, sg, ts, lf, auto_base):
        z = sg["spec"].get("zoom", 1.0)
        s = auto_base if z == "auto" else z
        if not sg["spec"].get("reverse"):
            for p in self.Z.get("punches", []):
                if sg["f0"] / self.FPS <= p["t"] < sg["f1"] / self.FPS and ts >= p["t"]:
                    k = smooth((ts - p["t"]) / p["ease"])
                    s = s * (1 + (p["mul"] - 1) * k) if "mul" in p else s + (p["to"] - s) * k
        s *= 1 + sg["spec"].get("push", self.Z.get("slow_push_per_sec", 0.012)) * lf / self.FPS
        if sg["spec"].get("transition_in") == "zoom_in":
            s *= 1 + 0.35 * (1 - smooth(lf / 7))
        return max(1.0, s)

    # ------------------------------------------------------------- captions
    def caption_img(self, ci, active):
        key = (ci, active)
        if key in self._cap: return self._cap[key]
        cp = self.P.E["captions"][ci]
        words, emph = cp["text"].split(" "), set(cp.get("emph", []))
        font, gap, lh = FONT("Black", 80), 24, 112
        lines, cur, cw = [], [], 0
        for w in words:
            ww = font.getlength(w, direction="rtl")
            if cur and cw + gap + ww > 900:
                lines.append(cur); cur, cw = [], 0
            cur.append((w, ww)); cw += (gap if len(cur) > 1 else 0) + ww
        if cur: lines.append(cur)
        CW, CH = 1040, len(lines) * lh + 60
        txt = Image.new("RGBA", (CW, CH), (0, 0, 0, 0)); shd = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        dt, ds = ImageDraw.Draw(txt), ImageDraw.Draw(shd)
        wi = 0
        for li, line in enumerate(lines):
            lw = sum(w for _, w in line) + gap * (len(line) - 1)
            x, y = (CW + lw) / 2, 30 + li * lh + lh / 2
            for word, ww in line:
                act, em = wi == active, word.strip("!؟،.") in emph
                if act and em:
                    dt.rounded_rectangle([x - ww - 16, y - 50, x + 16, y + 54], radius=18, fill=ACCENT + (255,))
                    dt.text((x, y), word, font=font, fill=(20, 20, 20, 255), anchor="rm", direction="rtl")
                    ds.rounded_rectangle([x - ww - 16, y - 50, x + 16, y + 54], radius=18, fill=(0, 0, 0, 200))
                else:
                    col = ACCENT + (255,) if act else ((255, 236, 160, 255) if em else (255, 255, 255, 255))
                    dt.text((x, y), word, font=font, fill=col, anchor="rm", direction="rtl", stroke_width=7, stroke_fill=(0, 0, 0, 255))
                    ds.text((x, y + 6), word, font=font, fill=(0, 0, 0, 255), anchor="rm", direction="rtl", stroke_width=12, stroke_fill=(0, 0, 0, 255))
                x -= ww + gap; wi += 1
        sh = np.array(shd.filter(ImageFilter.GaussianBlur(9))).astype(np.float32); sh[..., 3] *= 0.55
        arr = np.array(Image.alpha_composite(Image.fromarray(sh.astype(np.uint8)), txt))
        self._cap[key] = arr
        return arr

    def draw_caption(self, layer, ts):
        for ci, cp in enumerate(self.P.E.get("captions", [])):
            if cp["t0"] <= ts < cp["t1"]:
                words = cp["text"].split(" ")
                wts = np.array([len(w) + 2 for w in words], np.float32)
                bounds = cp["t0"] + np.cumsum(wts) / wts.sum() * (cp["t1"] - cp["t0"])
                # static text (on-screen text that nobody speaks) has no karaoke highlight
                active = -1 if cp.get("static") else min(int(np.searchsorted(bounds, ts, side="right")), len(words) - 1)
                p = (ts - cp["t0"]) / 0.12
                blit(layer, self.caption_img(ci, active), self.OW / 2, self.OH * 0.715, alpha=smooth(p * 1.5),
                     scale=0.82 + 0.18 * smooth(p) + 0.05 * math.sin(min(p, 1) * math.pi))
                return

    # ------------------------------------------------------------- background layer
    def scene_bg(self, idx, e, u, ts, cam_bg):
        """Background of a `scene` effect at progress u, with changes between places and in/out of the scene."""
        srcs = self.scene_sources(idx, e)
        n = len(srcs)
        dur = e["t1"] - e["t0"]
        tl = ts - e["t0"]
        part = min(n - 1, int(u * n))
        bnd = dur / n
        local = tl - part * bnd
        src = srcs[part]
        bg = src.frame(tl)
        mode = e.get("motion", "drift")
        if mode in ("drift", "sway"):
            if mode == "drift":
                s = 1.04 + 0.05 * (local / max(0.5, bnd)); ang = 0
                dx = 18 * math.sin(tl * 0.6)
            else:
                s = 1.03 + 0.006 * math.sin(tl * 1.3); ang = 0.8 * math.sin(tl * 1.7); dx = 0
            M = cv2.getRotationMatrix2D((self.OW / 2, self.OH / 2), ang, s); M[0, 2] += dx
            bg = cv2.warpAffine(bg, M, (self.OW, self.OH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        change = e.get("change", "fade")
        T = 0.3
        # change to the next place
        if part < n - 1 and bnd - local < T and change != "cut":
            nxt = srcs[part + 1].frame(tl)
            bg = self._blend_change(bg, nxt, 1 - (bnd - local) / T, change)
        # in / out of the scene (against the real background)
        if tl < T and change != "cut":
            bg = self._blend_change(cam_bg, bg, tl / T, change)
        elif dur - tl < T and change != "cut":
            bg = self._blend_change(bg, cam_bg, 1 - (dur - tl) / T, change)
        return bg, src

    def _blend_change(self, a, b, k, kind):
        k = float(np.clip(k, 0, 1))
        if kind == "wipe":   # right to left, like reading Persian
            x = int(self.OW * (1 - smooth(k)))
            out = a.copy(); out[:, x:] = b[:, x:]
            if 0 < x < self.OW: out[:, max(0, x - 6):x + 6] = 255
            return out
        if kind == "flash":
            base = a if k < 0.5 else b
            return np.clip(base.astype(np.float32) + 230 * (1 - abs(k - 0.5) * 2), 0, 255).astype(np.uint8)
        if kind == "glitch":
            base = (a if k < 0.5 else b).copy()
            amt = int(40 * (1 - abs(k - 0.5) * 2))
            if amt > 2:
                base[..., 0] = np.roll(base[..., 0], amt, axis=1); base[..., 2] = np.roll(base[..., 2], -amt, axis=1)
            return base
        return (a.astype(np.float32) * (1 - smooth(k)) + b.astype(np.float32) * smooth(k)).astype(np.uint8)

    # ------------------------------------------------------------- one frame
    def compose(self, sg, lf, rgb, m, face, hw_s, layer_only=False):
        """Returns (scene RGB, graphics RGBA layer, head in screen space) for one output frame."""
        P, OW, OH, FPS = self.P, self.OW, self.OH, self.FPS
        spec = sg["spec"]
        fi = sg["frames"][lf]
        oi = sg["out0"] + lf
        ts, lt = fi / FPS, lf / FPS
        auto_base = min(self.AZ["max"], max(1.0, self.AZ["target_head_px"] / hw_s)) if hw_s else 1.0
        SW, SH = self.SW, self.SH

        # ---- camera
        s = self.zoom_at(sg, ts, lf, auto_base)
        fly = self.in_fx("sky_fly", ts)
        oy = 0.0
        if fly:
            s = max(s, 1.10)
            oy = 22 * math.sin(2 * math.pi * (ts - fly[0]["t0"]) / 1.15)
        cw, ch = SW / s, SH / s
        k = min(1.0, (s - 1.0) * 5)
        cx = SW / 2 * (1 - k) + face[0] * k
        cy = SH / 2 * (1 - k) + (face[1] + ch * 0.10) * k + oy
        cx = min(max(cx, cw / 2), SW - cw / 2); cy = min(max(cy, ch / 2), SH - ch / 2)
        sc = OW / cw
        M = np.float32([[sc, 0, -(cx - cw / 2) * sc], [0, sc, -(cy - ch / 2) * sc]])
        cam = cv2.warpAffine(rgb, M, (OW, OH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        mk = cv2.warpAffine(m, M, (OW, OH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)[..., None]
        head = ((face[0] - (cx - cw / 2)) * sc, (face[1] - (cy - ch / 2)) * sc, (hw_s or 180) * sc)

        gfx = self.active_graphics(sg, ts, lt)
        raw = any(el.raw_look for el, _, _ in gfx)
        scene = cam if raw else self.grade(cam)

        # ---- background layer
        subj = scene
        bg = None            # None = the real background (unchanged)
        rim = None
        fg_layer = None
        own_bg_look = False
        sc_a = self.active("scene", ts)
        if sc_a:
            idx, e, u = sc_a
            bg, src = self.scene_bg(idx, e, u, ts, scene)
            rim, fg_layer = src.rim, src.fg
            own_bg_look = bool(e.get("style")) and e.get("style") != "natural"
            sn = self.in_fx("sun", ts)
            if sn and self.SUN is not None: self.draw_sun(bg, sn[0], ts)
            if e.get("places", [{}])[0].get("id") == "jungle":
                subj = np.clip(scene.astype(np.float32) * np.array([1.05, 1.0, 0.93], np.float32), 0, 255).astype(np.uint8)
        if fly:
            e, u = fly
            S = self.sky(e.get("time", "day"))
            L = S.shape[0]
            row = int((L - OH - (ts - e["t0"]) * 1100) % (L - OH))
            sky = S[row:row + OH].copy()
            sky += fx.speed_lines(OW, OH, ts - e["t0"])[..., None] * 255 * 0.45
            kin = smooth((ts - e["t0"]) / 0.12) * smooth((e["t1"] - ts) / 0.12)
            base = (bg if bg is not None else scene).astype(np.float32)
            bg = np.clip(base * (1 - kin) + sky * kin + max(0.0, 1 - (ts - e["t0"]) / 0.12) * 120, 0, 255).astype(np.uint8)
            rim = {"night": (120, 140, 255), "sunset": (255, 170, 120)}.get(e.get("time"), (150, 200, 255))
        fl = self.active("flyover", ts)
        if fl:
            idx, e, u = fl
            if idx not in self._fly:
                self._fly[idx] = Flyover(e.get("object", "dinosaur"), e.get("direction", "rtl"), e.get("size", "big"), e.get("y"))
            bg = (bg if bg is not None else scene).copy()
            self._fly[idx].draw(bg, ts - e["t0"], u)
        behind = [(i, e) for i, e in enumerate(self.EFX) if e["type"] == "particles" and e.get("layer") == "behind" and e["t0"] <= ts < e["t1"]]
        if behind:
            bg = (bg if bg is not None else scene).copy()
            for i, e in behind: self._particles(i, e).draw(bg, ts - e["t0"], self._fade(e, ts))
        fo = self.in_fx("focus", ts)
        if fo:
            e, u = fo
            base = bg if bg is not None else scene
            kf = self._fade(e, ts)
            mode = e.get("mode", "blur")
            if mode == "blur":
                alt = cv2.GaussianBlur(cv2.resize(base, (OW // 4, OH // 4)), (0, 0), 5)
                alt = cv2.resize(alt, (OW, OH))
            elif mode == "bw":
                g = cv2.cvtColor(base, cv2.COLOR_RGB2GRAY); alt = np.dstack([g, g, g])
            elif mode == "dark":
                yy, xx = np.mgrid[0:OH:4, 0:OW:4].astype(np.float32)
                spot = np.clip(1 - np.sqrt(((xx - head[0]) / (OW * 0.55)) ** 2 + ((yy - head[1] - 260) / (OH * 0.42)) ** 2), 0, 1)
                spot = cv2.resize(spot, (OW, OH))[..., None]
                alt = (base.astype(np.float32) * (0.12 + 0.5 * spot)).astype(np.uint8)
                subj = np.clip(subj.astype(np.float32) * (0.7 + 0.45 * spot), 0, 255).astype(np.uint8)
            else:
                col = np.array(COLORS.get(e.get("color", "yellow"), COLORS["yellow"]), np.float32)
                yy = np.linspace(0, 1, OH, dtype=np.float32)[:, None, None]
                alt = np.broadcast_to(np.clip(col * (1.04 - 0.22 * yy), 0, 255), (OH, OW, 3)).astype(np.uint8)
            bg = (base.astype(np.float32) * (1 - kf) + alt.astype(np.float32) * kf).astype(np.uint8)
        cl = self.in_fx("clones", ts)
        if cl:
            e, u = cl
            base = (bg if bg is not None else scene).astype(np.float32)
            kf = self._fade(e, ts)
            offs = [-0.34, 0.34] if (e.get("mode", "side") == "side" and str(e.get("count", "3")) == "3") else [0.34]
            for j, dxr in enumerate(offs):
                dx = dxr * OW
                img, mm = subj, mk[..., 0]
                if e.get("mode") == "mirror":
                    img, mm = img[:, ::-1], mm[:, ::-1]
                Mt = np.float32([[0.9, 0, dx + OW * 0.05], [0, 0.9, OH * 0.08]])
                ci = cv2.warpAffine(img, Mt, (OW, OH), borderMode=cv2.BORDER_CONSTANT)
                cm = cv2.warpAffine(mm, Mt, (OW, OH), borderMode=cv2.BORDER_CONSTANT)[..., None] * kf
                base = base * (1 - cm) + ci.astype(np.float32) * 0.92 * cm
            bg = np.clip(base, 0, 255).astype(np.uint8)

        # ---- look on one part only
        lk, scope = self.look, self.look_scope
        if lk != "natural" and not raw:
            if own_bg_look:
                if scope in ("whole", "subject"): subj = looks.apply(subj, lk)
            elif scope == "subject":
                subj = looks.apply(subj, lk)
            elif scope == "background":
                bg = looks.apply(bg if bg is not None else scene, lk)

        # ---- person over background
        if bg is not None:
            f = subj.astype(np.float32) * mk + bg.astype(np.float32) * (1 - mk)
            if rim is not None:
                edge = np.clip(cv2.GaussianBlur(mk[..., 0], (0, 0), 14) * 1.5 - mk[..., 0], 0, 1)[..., None]
                f += edge * np.array(rim, np.float32) * 0.5
            scene = np.clip(f, 0, 255).astype(np.uint8)
        elif subj is not scene:
            scene = subj
        gl = self.in_fx("glow", ts)
        if gl:
            scene = self._glow(scene, mk, gl[0], ts, head)
        if fg_layer is not None:
            e = sc_a[1]
            tl_s = ts - e["t0"]
            Mf = cv2.getRotationMatrix2D((OW / 2, OH / 2), 0.7 * math.sin(tl_s * 1.7), 1.0 + 0.004 * math.sin(tl_s * 1.3))
            fgl = cv2.warpAffine(fg_layer, Mf, (OW, OH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            kin = smooth(tl_s / 0.3) * smooth((e["t1"] - ts) / 0.3)
            af = fgl[..., 3:4].astype(np.float32) / 255 * kin
            scene = np.clip(scene * (1 - af) + fgl[..., :3].astype(np.float32) * af, 0, 255).astype(np.uint8)
        for i, e in enumerate(self.EFX):
            if e["type"] == "particles" and e.get("layer") != "behind" and e["t0"] <= ts < e["t1"]:
                self._particles(i, e).draw(scene, ts - e["t0"], self._fade(e, ts))

        # ---- look on the whole picture
        if lk != "natural" and not raw and scope == "whole" and not own_bg_look:
            scene = looks.apply(scene, lk)

        # ---- camera shake / tilt
        sa = self.shake_amount(ts)
        ang = self.tilt_angle(ts)
        if sa > 0 or ang:
            dx, dy = sa * 10 * math.sin(ts * 91), sa * 15 * math.cos(ts * 77)
            Mr = cv2.getRotationMatrix2D((OW / 2, OH / 2), ang, 1.02 + abs(ang) * 0.012)
            Mr[0, 2] += dx; Mr[1, 2] += dy
            scene = cv2.warpAffine(scene, Mr, (OW, OH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

        for el, tl, dur in gfx:
            if hasattr(el, "process"):
                scene = el.process(scene, tl, {"src_t": ts})
        if self.GRAIN:
            scene = np.clip(scene.astype(np.float32) + self.GRAIN[oi % len(self.GRAIN)], 0, 255).astype(np.uint8)

        # ---- graphics + captions in one layer, restyled to match the look
        layer = np.zeros((OH, OW, 4), np.uint8)
        ctx = {"src_t": ts, "shake": sa, "level": self.LEVEL, "head": head}
        for el, tl, dur in gfx:
            el.draw(layer, tl, dur, ctx)
        if spec.get("captions", True):
            self.draw_caption(layer, ts)
        if self.skin != "clean":
            layer = looks.skin(layer, self.skin, oi)
        return scene, layer, head

    def _fade(self, e, ts):
        return smooth((ts - e["t0"]) / 0.25) * smooth((e["t1"] - ts) / 0.25)

    def _particles(self, i, e):
        if i not in self._parts:
            self._parts[i] = Particles(e.get("kind", "confetti"), e.get("amount", "normal"), seed=3 + i)
        return self._parts[i]

    def _glow(self, scene, mk, e, ts, head):
        OW, OH = self.OW, self.OH
        kf = self._fade(e, ts)
        mode = e.get("mode", "glow")
        m = mk[..., 0]
        f = scene.astype(np.float32)
        if mode == "sticker":
            mb = (m > 0.5).astype(np.uint8)
            ring = cv2.dilate(mb, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))).astype(np.float32)
            ring = np.clip(cv2.GaussianBlur(ring, (0, 0), 1.5) - m, 0, 1)[..., None] * kf
            return np.clip(f * (1 - ring) + 255 * ring, 0, 255).astype(np.uint8)
        name = e.get("color", "yellow")
        if name == "rainbow":
            yy, xx = np.mgrid[0:OH:4, 0:OW:4].astype(np.float32)
            hue = ((np.arctan2(yy - head[1], xx - head[0]) / (2 * math.pi) + 0.5 + ts * 0.3) % 1.0) * 180
            hsv = np.dstack([hue, np.full_like(hue, 230), np.full_like(hue, 255)]).astype(np.uint8)
            col = cv2.resize(cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB), (OW, OH)).astype(np.float32)
        else:
            col = np.array(COLORS.get(name, COLORS["yellow"]), np.float32)
        if mode == "outline":
            mb = (m > 0.5).astype(np.uint8)
            ring = cv2.dilate(mb, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))).astype(np.float32) - mb
            ring = cv2.GaussianBlur(ring, (0, 0), 1.2)[..., None] * kf
            return np.clip(f * (1 - ring) + col * ring, 0, 255).astype(np.uint8)
        pulse = 0.85 + 0.15 * math.sin(ts * 4)
        edge = np.clip(cv2.GaussianBlur(m, (0, 0), 22) * 1.8 - m, 0, 1)[..., None] * kf * pulse
        return np.clip(f + edge * col * 0.95, 0, 255).astype(np.uint8)

    # ------------------------------------------------------------- transitions
    def transition(self, frame, tr, lf, prev, head):
        n = TR_FRAMES.get(tr, 0)
        if not tr or tr == "cut" or lf >= n:
            return frame
        OW, OH = self.OW, self.OH
        kk = 1 - lf / n              # 1 at the cut -> 0
        u = smooth(lf / n)           # 0 at the cut -> 1
        if tr == "whip":
            k2 = kk * kk
            nn = int(k2 * 90)
            if nn >= 3:
                frame = cv2.filter2D(frame, -1, np.ones((1, nn), np.float32) / nn, borderType=cv2.BORDER_REFLECT)
            return np.roll(frame, int(k2 * 240), axis=1)
        if tr == "glitch":
            amt = int(30 * kk)
            g2 = frame.copy()
            g2[..., 0] = np.roll(frame[..., 0], amt, axis=1); g2[..., 2] = np.roll(frame[..., 2], -amt, axis=1)
            rng = np.random.default_rng(lf + 99)
            for _ in range(8):
                y0 = int(rng.random() * OH); hh = int(20 + rng.random() * 100)
                g2[y0:y0 + hh] = np.roll(g2[y0:y0 + hh], int((rng.random() - 0.5) * 160 * kk), axis=1)
            return np.clip(g2.astype(np.int16) + int(90 * kk), 0, 255).astype(np.uint8)
        if tr == "flash":
            return np.clip(frame.astype(np.int16) + int(190 * kk), 0, 255).astype(np.uint8)
        if tr == "zoom_out":
            s = 0.72 + 0.28 * u
            small = cv2.resize(frame, (int(OW * s), int(OH * s)), interpolation=cv2.INTER_AREA)
            out = cv2.GaussianBlur(cv2.resize(frame, (OW // 6, OH // 6)), (0, 0), 3)
            out = (cv2.resize(out, (OW, OH)).astype(np.float32) * 0.6).astype(np.uint8)
            y0, x0 = (OH - small.shape[0]) // 2, (OW - small.shape[1]) // 2
            out[y0:y0 + small.shape[0], x0:x0 + small.shape[1]] = small
            return out
        if tr == "spin":
            M = cv2.getRotationMatrix2D((OW / 2, OH / 2), -80 * kk ** 2, 1 + 0.5 * kk ** 2)
            out = cv2.warpAffine(frame, M, (OW, OH), borderMode=cv2.BORDER_REFLECT)
            return cv2.GaussianBlur(out, (0, 0), 1 + 10 * kk) if kk > 0.2 else out
        if tr == "blur":
            return cv2.GaussianBlur(frame, (0, 0), 0.5 + 24 * kk ** 1.5)
        if tr == "light_leak":
            yy = np.linspace(0, 1, OH, dtype=np.float32)[:, None]
            xx = np.linspace(0, 1, OW, dtype=np.float32)[None, :]
            r = np.exp(-(((xx - 0.2 - 0.6 * u) * 1.5) ** 2 + ((yy - 0.35) * 0.9) ** 2) * 3)[..., None]
            amt = math.sin(math.pi * (lf + 1) / (n + 1)) * 0.8
            # screen blend: bright warm light without burning the face to white
            f = frame.astype(np.float32) / 255
            leak = r * np.array([1.0, 0.62, 0.3], np.float32) * amt
            return np.clip((1 - (1 - f) * (1 - leak)) * 255, 0, 255).astype(np.uint8)
        if prev is None:
            return frame
        if tr == "dissolve":
            return (prev.astype(np.float32) * (1 - u) + frame.astype(np.float32) * u).astype(np.uint8)
        if tr == "slide":   # the new shot pushes the old one out to the right (RTL reading)
            x = int(OW * (1 - u))
            out = np.empty_like(frame)
            out[:, :OW - x] = frame[:, x:]
            out[:, OW - x:] = prev[:, :x] if x else out[:, OW - x:]
            return out
        if tr == "circle":
            yy, xx = np.ogrid[0:OH, 0:OW]
            r = u * math.hypot(OW, OH)
            msk = ((xx - head[0]) ** 2 + (yy - head[1]) ** 2 <= r * r)[..., None]
            out = np.where(msk, frame, prev)
            ring = (np.abs(np.sqrt((xx - head[0]) ** 2 + (yy - head[1]) ** 2) - r) < 6)
            out[ring] = 255
            return out
        return frame

    def prev_shot(self, si):
        """Last finished frame of the segment before si (for dissolve / slide / circle)."""
        if si == 0: return None
        sg = self.P.segs[si - 1]
        lf = len(sg["frames"]) - 1
        fi = sg["frames"][lf]
        rgb = media.read_frames(self.P.source, self.FPS, self.SW, self.SH, fi, fi).get(fi)
        if rgb is None: return None
        m = self.seg(rgb)
        hi = head_info(m)
        face = (hi[0], hi[1]) if hi else (self.SW / 2, self.SH * 0.33)
        hw = hi[2] if hi and hi[2] else None
        scene, layer, _ = self.compose(sg, lf, rgb, m, face, hw)
        return looks.over(np.ascontiguousarray(scene), layer)

    # ------------------------------------------------------------- one segment
    def render_segment(self, si, out_path, lf0=0, lf1=None, warm=45):
        """Render frames lf0..lf1 of segment si. Chunks start `warm` frames early (tracking only, not encoded)
        so zoom/tracking state is identical to a single uninterrupted pass."""
        P, OW, OH, FPS = self.P, self.OW, self.OH, self.FPS
        sg = P.segs[si]
        spec = sg["spec"]
        lf1 = len(sg["frames"]) if lf1 is None else lf1
        start = max(0, lf0 - warm)
        enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{OW}x{OH}",
                                "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                                "-pix_fmt", "yuv420p", "-r", str(FPS), out_path], stdin=subprocess.PIPE)
        sub = sg["frames"][start:lf1]
        frames = media.read_frames(P.source, FPS, self.SW, self.SH, min(sub), max(sub))
        face, hw_s, prev = (self.SW / 2, self.SH * 0.33), None, None
        tr = spec.get("transition_in")
        prev_frame = self.prev_shot(si) if (tr in PREV_TR and lf0 < TR_FRAMES.get(tr, 0)) else None
        loop_first = None
        if P.E.get("loop_end") and si == len(P.segs) - 1:
            loop_n = int(FPS * 0.45)
        else:
            loop_n = 0
        for lf in range(start, lf1):
            fi = sg["frames"][lf]
            oi = sg["out0"] + lf
            ts = fi / FPS
            rgb = frames.get(fi)
            if rgb is None:
                rgb = frames[max(k for k in frames if k <= fi)] if any(k <= fi for k in frames) else next(iter(frames.values()))
            m = self.seg(rgb)
            warming = lf < lf0
            if (not warming or lf >= lf0 - 2) and self.needs_matte(ts):   # precise cut-out only where it shows
                m = self.plate.refine(rgb, m)
            hi = head_info(m)
            if hi:
                cxh, cyh, hw = hi
                face = (cxh, cyh) if lf == start else (face[0] * 0.85 + cxh * 0.15, face[1] * 0.85 + cyh * 0.15)
                if hw:
                    hw_s = hw if (lf == start or hw_s is None) else hw_s * 0.93 + hw * 0.07
            if warming:
                prev = m
                continue
            if prev is not None and not spec.get("reverse") and not spec.get("hold"):
                m = m * 0.6 + prev * 0.4
            prev = m
            scene, layer, head = self.compose(sg, lf, rgb, m, face, hw_s)
            scene = self.transition(scene, tr, lf, prev_frame, head)
            if self.texture.k:
                scene = self.texture.apply(scene, oi / FPS, oi)
            frame = looks.over(np.ascontiguousarray(scene), layer)
            if loop_n and len(sg["frames"]) - lf <= loop_n:
                if loop_first is None: loop_first = self.first_frame()
                k = smooth(1 - (len(sg["frames"]) - lf - 1) / loop_n)
                frame = (frame.astype(np.float32) * (1 - k) + loop_first.astype(np.float32) * k).astype(np.uint8)
            if P.E.get("progress_bar"):
                pw = int(OW * (oi + 1) / P.total)
                frame[OH - 12:OH] = (frame[OH - 12:OH] * 0.6).astype(np.uint8)
                frame[OH - 12:OH, :pw] = ACCENT
            enc.stdin.write(frame.tobytes())
        enc.stdin.close(); enc.wait()
        return out_path

    def first_frame(self):
        sg = self.P.segs[0]
        fi = sg["frames"][0]
        rgb = media.read_frames(self.P.source, self.FPS, self.SW, self.SH, fi, fi).get(fi)
        m = self.seg(rgb)
        hi = head_info(m)
        face = (hi[0], hi[1]) if hi else (self.SW / 2, self.SH * 0.33)
        scene, layer, head = self.compose(sg, 0, rgb, m, face, hi[2] if hi else None)
        scene = self.transition(scene, sg["spec"].get("transition_in"), 0, None, head)
        if self.texture.k: scene = self.texture.apply(scene, 0, 0)
        return looks.over(np.ascontiguousarray(scene), layer)


# =================================================================== orchestration
_ENGINE = None


def _init_worker(plan_path, plate_path, level_path):
    global _ENGINE
    cv2.setNumThreads(1)
    _ENGINE = Engine(Plan(plan_path), plate_path, level_path, threads=1)


def _work(args):
    si, a, b, out = args
    t = time.time()
    _ENGINE.render_segment(si, out, a, b)
    return si, a, b, time.time() - t


def prepare(plan, log=print):
    """Clean plate + voice-level envelope, cached per source video."""
    st = os.stat(plan.source)
    key = hashlib.sha1(f"{plan.source}:{st.st_size}:{st.st_mtime}".encode()).hexdigest()[:12]
    cache = os.path.join(os.path.dirname(plan.output), ".work", "cache_" + key)
    os.makedirs(cache, exist_ok=True)
    plate_path, level_path = os.path.join(cache, "plate.npz"), os.path.join(cache, "level.npy")
    if not os.path.exists(level_path):
        np.save(level_path, media.level_envelope(media.read_audio(plan.source)))
    E = plan.E
    lk = E.get("look") or {}
    use_plate = E.get("matting", {}).get("clean_plate", True) and (
        any(e["type"] in COMP_FX or (e["type"] == "particles" and e.get("layer") == "behind") for e in E.get("effects", []))
        or (lk.get("style", "natural") != "natural" and lk.get("scope", "whole") != "whole"))
    if use_plate and not os.path.exists(plate_path):
        t = time.time()
        info = media.probe(plan.source)
        seg = Segmenter(info["width"], info["height"])
        CleanPlate.build(plan.source, seg, plan.FPS, info["width"], info["height"]).save(plate_path)
        log(f"  clean plate built ({time.time() - t:.0f}s)")
    return (plate_path if use_plate else None), level_path


def render(plan_path, workers=1, log=print):
    from .audio import build_audio
    t0 = time.time()
    plan = Plan(plan_path)
    plate_path, level_path = prepare(plan, log)
    # split long segments into chunks so every worker stays busy
    chunk = len(plan.segs) and max(30, math.ceil(plan.total / (workers * 3))) if workers > 1 else 10 ** 9
    jobs = []
    for i, sg in enumerate(plan.segs):
        n = len(sg["frames"])
        for a in range(0, n, chunk):
            b = min(n, a + chunk)
            if n - b < 15: b = n  # don't leave a tiny tail
            jobs.append((i, a, b, os.path.join(plan.work, f"seg_{i:03d}_{a:05d}.mp4")))
            if b == n: break
    order = sorted(jobs, key=lambda j: -(j[2] - j[1]))  # longest first
    done = [0]
    def report(r):
        si, a, b, dt = r
        done[0] += 1
        log(f"  segment {si} frames {a}-{b} {dt:.0f}s")
        log(f"progress {done[0]}/{len(jobs)}")
    if workers <= 1:
        _init_worker(plan_path, plate_path, level_path)
        for j in order: report(_work(j))
    else:
        with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker,
                                 initargs=(plan_path, plate_path, level_path)) as ex:
            for r in ex.map(_work, order): report(r)
    lst = os.path.join(plan.work, "concat.txt")
    with open(lst, "w") as f:
        for j in jobs:
            f.write(f"file '{j[3]}'\n")
    video = os.path.join(plan.work, "video.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", video], check=True)
    build_audio(plan, video, plan.output)
    log(f"done: {plan.output} ({plan.duration:.2f}s video, {time.time() - t0:.0f}s total)")
    return plan.output
