"""Render engine: executes an edit plan (EDL JSON) on a raw talking-head video.
Segments of the output timeline are independent, so they render in parallel worker processes
and are joined at the end."""
import json, math, os, subprocess, sys, time, hashlib
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter

from . import fx, media
from . import motion as mo
from .motion import smooth, blit, FONT, ACCENT
from .matting import Segmenter, CleanPlate, head_info


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
            f1 = int(math.ceil(s["src"][1] * self.FPS - 1e-6))
            frames = list(range(f1 - 1, f0 - 1, -int(s.get("speed", 1)))) if s.get("reverse") else list(range(f0, f1))
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
            if sg["spec"].get("reverse") or sg["role"] not in roles:
                continue
            if sg["f0"] / self.FPS <= t < sg["f1"] / self.FPS:
                res.append((sg["out0"] + (t * self.FPS - sg["f0"])) / self.FPS)
        return res


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
        # grade
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
        # effects / assets
        self.FX = {e["type"]: e for e in E.get("effects", [])}
        self.SKY = fx.make_sky(self.OW, self.OH, 2.0) if "sky_fly" in self.FX else None
        self.JUNGLE = fx.make_jungle(self.OW, self.OH) if "jungle" in self.FX else None
        self.SUN = fx.sun_sprite(self.FX["sun"].get("r", 95)) if "sun" in self.FX else None
        self._dino = {}
        self.GFX = [(g, mo.build(g)) for g in E.get("graphics", [])]
        self._cap = {}
        self.Z = E.get("zoom", {"slow_push_per_sec": 0.012, "punches": []})
        self.AZ = E.get("auto_zoom", {"target_head_px": 185, "max": 1.4})

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

    def in_fx(self, name, ts):
        e = self.FX.get(name)
        if e and e["t0"] <= ts < e["t1"]:
            return e, (ts - e["t0"]) / (e["t1"] - e["t0"])
        return None

    def needs_matte(self, ts):
        return any(self.in_fx(n, ts) for n in ("sky_fly", "jungle", "dinosaur_walk"))

    def shake_amount(self, ts):
        a = 0.0
        for s in self.P.shakes:
            if 0 <= ts - s["t"] < s["dur"]:
                a = max(a, s["amp"] * (1 - (ts - s["t"]) / s["dur"]) ** 2)
        return a

    def dino(self, phase, scale=1.05, palette=None):
        q = (round(phase * 36) % 36, scale, palette)
        if q not in self._dino:
            sp = fx.dino_sprite(q[0] / 36, scale)
            if palette == "brown":
                sp = sp[..., [1, 0, 2, 3]].copy()
            self._dino[q] = sp
        return self._dino[q]

    def dino_place(self, e, u, sp):
        h, w = sp.shape[:2]
        x = self.OW + 30 - u * (self.OW + w + 60) + w / 2
        y = e["feet_y"] - 0.39 * h if "feet_y" in e else self.OH * 0.505
        return x, y

    def draw_sun(self, bg, e, ts):
        rays, disc, glow = self.SUN
        tl = ts - e["t0"]
        k = mo.back_out(tl / 0.35) if tl < 0.35 else 1.0
        cx, cy = e["x"], e["y"]
        gh, gw = glow.shape
        y0, x0 = int(cy - gh / 2), int(cx - gw / 2)
        ya, xa, yb, xb = max(0, y0), max(0, x0), min(self.OH, y0 + gh), min(self.OW, x0 + gw)
        f = bg[ya:yb, xa:xb].astype(np.float32)
        f += glow[ya - y0:yb - y0, xa - x0:xb - x0, None] * np.array([255, 196, 80], np.float32) * 0.6 * min(1, tl / 0.3)
        bg[ya:yb, xa:xb] = np.clip(f, 0, 255).astype(np.uint8)
        blit(bg, rays, cx, cy, scale=max(0.01, k), angle=tl * 14)
        blit(bg, disc, cx, cy, scale=max(0.01, k * (1 + 0.025 * math.sin(tl * 3))))

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
        return s

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

    def draw_caption(self, frame, ts):
        for ci, cp in enumerate(self.P.E.get("captions", [])):
            if cp["t0"] <= ts < cp["t1"]:
                words = cp["text"].split(" ")
                wts = np.array([len(w) + 2 for w in words], np.float32)
                bounds = cp["t0"] + np.cumsum(wts) / wts.sum() * (cp["t1"] - cp["t0"])
                active = min(int(np.searchsorted(bounds, ts, side="right")), len(words) - 1)
                p = (ts - cp["t0"]) / 0.12
                blit(frame, self.caption_img(ci, active), self.OW / 2, self.OH * 0.715, alpha=smooth(p * 1.5),
                     scale=0.82 + 0.18 * smooth(p) + 0.05 * math.sin(min(p, 1) * math.pi))
                return

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
        SW, SH = self.SW, self.SH
        for lf in range(start, lf1):
            fi = sg["frames"][lf]
            oi = sg["out0"] + lf
            ts, lt = fi / FPS, lf / FPS
            rgb = frames.get(fi)
            if rgb is None:
                rgb = frames[max(k for k in frames if k <= fi)] if any(k <= fi for k in frames) else next(iter(frames.values()))
            m = self.seg(rgb)
            warming = lf < lf0
            if (not warming or lf >= lf0 - 2) and self.needs_matte(ts):   # precise cut-out only where the background is replaced
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
            if prev is not None and not spec.get("reverse"):
                m = m * 0.6 + prev * 0.4
            prev = m
            auto_base = min(self.AZ["max"], max(1.0, self.AZ["target_head_px"] / hw_s)) if hw_s else 1.0

            # camera
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

            gfx = self.active_graphics(sg, ts, lt)
            raw = any(el.raw_look for el, _, _ in gfx)
            scene = cam if raw else self.grade(cam)

            if fly:
                e, u = fly
                kin = smooth((ts - e["t0"]) / 0.12) * smooth((e["t1"] - ts) / 0.12)
                L = self.SKY.shape[0]
                row = int((L - OH - (ts - e["t0"]) * 1100) % (L - OH))
                bg = self.SKY[row:row + OH].copy()
                bg += fx.speed_lines(OW, OH, ts - e["t0"])[..., None] * 255 * 0.45
                edge = np.clip(cv2.GaussianBlur(mk[..., 0], (0, 0), 22) * 1.6 - mk[..., 0], 0, 1)[..., None]
                bg = np.clip(bg + edge * np.array([150, 200, 255], np.float32) * 0.9, 0, 255)
                sf = scene.astype(np.float32)
                comp = sf * mk + bg * (1 - mk)
                comp = sf * (1 - kin) + comp * kin + max(0.0, 1 - (ts - e["t0"]) / 0.12) * 120
                scene = np.clip(comp, 0, 255).astype(np.uint8)

            dz = self.in_fx("dinosaur_walk", ts)
            jg = self.in_fx("jungle", ts)
            if jg:
                bgj = self.JUNGLE[0].astype(np.uint8)
                sn = self.in_fx("sun", ts)
                if sn: self.draw_sun(bgj, sn[0], ts)
                if dz:
                    e, u = dz
                    sp = self.dino(((ts - e["t0"]) / 1.24) % 1.0, e.get("scale", 1.05), e.get("palette"))
                    blit(bgj, sp, *self.dino_place(e, u, sp))
                sf = scene.astype(np.float32) * np.array([1.05, 1.0, 0.93], np.float32)
                edge = np.clip(cv2.GaussianBlur(mk[..., 0], (0, 0), 14) * 1.5 - mk[..., 0], 0, 1)[..., None]
                comp = sf * mk + bgj.astype(np.float32) * (1 - mk) + edge * np.array([255, 205, 130], np.float32) * 0.55
                tl_j = ts - jg[0]["t0"]
                Mf = cv2.getRotationMatrix2D((OW / 2, OH / 2), 0.7 * math.sin(tl_j * 1.7), 1.0 + 0.004 * math.sin(tl_j * 1.3))
                fgl = cv2.warpAffine(self.JUNGLE[1], Mf, (OW, OH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                af = fgl[..., 3:4].astype(np.float32) / 255
                scene = np.clip(comp * (1 - af) + fgl[..., :3].astype(np.float32) * af, 0, 255).astype(np.uint8)
            elif dz:
                e, u = dz
                sp = self.dino(((ts - e["t0"]) / 1.24) % 1.0, e.get("scale", 1.05), e.get("palette"))
                if spec.get("reverse"): sp = sp[:, ::-1]
                layer = scene.copy()
                blit(layer, sp, *self.dino_place(e, u, sp))
                scene = (scene.astype(np.float32) * mk + layer.astype(np.float32) * (1 - mk)).astype(np.uint8)

            sa = self.shake_amount(ts)
            if sa > 0:
                dx, dy = sa * 10 * math.sin(ts * 91), sa * 15 * math.cos(ts * 77)
                M2 = np.float32([[1.02, 0, -OW * 0.01 + dx], [0, 1.02, -OH * 0.01 + dy]])
                scene = cv2.warpAffine(scene, M2, (OW, OH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

            tr = spec.get("transition_in")
            if tr == "whip" and lf < 6:
                kk = 1 - lf / 6
                n = int(kk * kk * 90)
                if n >= 3:
                    scene = cv2.filter2D(scene, -1, np.ones((1, n), np.float32) / n, borderType=cv2.BORDER_REFLECT)
                scene = np.roll(scene, int(kk ** 2 * 240), axis=1)
            if tr == "glitch" and lf < 7:
                kk = 1 - lf / 7
                amt = int(30 * kk)
                g2 = scene.copy()
                g2[..., 0] = np.roll(scene[..., 0], amt, axis=1); g2[..., 2] = np.roll(scene[..., 2], -amt, axis=1)
                rng = np.random.default_rng(lf + 99)
                for _ in range(8):
                    y0 = int(rng.random() * OH); hh = int(20 + rng.random() * 100)
                    g2[y0:y0 + hh] = np.roll(g2[y0:y0 + hh], int((rng.random() - 0.5) * 160 * kk), axis=1)
                scene = np.clip(g2.astype(np.int16) + int(90 * kk), 0, 255).astype(np.uint8)
            if tr == "flash" and lf < 5:
                scene = np.clip(scene.astype(np.int16) + int(190 * (1 - lf / 5)), 0, 255).astype(np.uint8)

            for el, tl, dur in gfx:
                if hasattr(el, "process"):
                    scene = el.process(scene, tl, {"src_t": ts})
            if self.GRAIN:
                scene = np.clip(scene.astype(np.float32) + self.GRAIN[oi % len(self.GRAIN)], 0, 255).astype(np.uint8)
            frame = np.ascontiguousarray(scene)
            ctx = {"src_t": ts, "shake": sa, "level": self.LEVEL}
            for el, tl, dur in gfx:
                el.draw(frame, tl, dur, ctx)
            if spec.get("captions", True):
                self.draw_caption(frame, ts)
            if P.E.get("progress_bar"):
                pw = int(OW * (oi + 1) / P.total)
                frame[OH - 12:OH] = (frame[OH - 12:OH] * 0.6).astype(np.uint8)
                frame[OH - 12:OH, :pw] = ACCENT
            enc.stdin.write(frame.tobytes())
        enc.stdin.close(); enc.wait()
        return out_path


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
    comp_fx = {"sky_fly", "jungle", "dinosaur_walk"}
    use_plate = plan.E.get("matting", {}).get("clean_plate", True) and any(e["type"] in comp_fx for e in plan.E.get("effects", []))
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
