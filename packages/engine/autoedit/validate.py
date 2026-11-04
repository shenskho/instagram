"""Plan validation. Catches mistakes before a slow render and returns machine-readable feedback
(the automatic director in step 3 reads this report and fixes its own plan)."""
import json, math, os
import numpy as np
from . import media, fx, looks, scenes
from . import motion as mo
from . import gfx as gx

OW, OH = 1080, 1920
KNOWN_FX = {"sky_fly", "jungle", "sun", "dinosaur_walk", "scene", "flyover", "particles", "focus", "glow", "clones"}
KNOWN_SFX = set(fx.SFX) | {"rise", "riser", "ticks", "rewind", "thuds", "birds"}
KNOWN_TR = {None, "cut", "whip", "flash", "zoom_in", "zoom_out", "glitch", "spin", "slide", "dissolve", "blur", "circle", "light_leak"}
KNOWN_ROLES = {None, "cold_open", "rewind", "freeze", "replay"}
KNOWN_GFX = set(mo.REGISTRY) | set(gx.REGISTRY)
FULLSCREEN = {"viewfinder", "vhs_rewind", "freeze_frame", "emoji_rain", "callout", "emoji_pop"}
CAPTION_BAND = (OH * 0.715 - 105, OH * 0.715 + 105)
MAX_DURATION = 90.0  # safe limit for Reels published through the Instagram API


class Report:
    def __init__(self): self.errors, self.warnings, self.fixes = [], [], []
    def err(self, where, msg): self.errors.append({"where": where, "msg": msg})
    def warn(self, where, msg): self.warnings.append({"where": where, "msg": msg})
    def fixed(self, where, msg): self.fixes.append({"where": where, "msg": msg})
    def as_dict(self): return {"ok": not self.errors, "errors": self.errors, "warnings": self.warnings, "fixes": self.fixes}


def _footprint(spec, tl, dur):
    """Bounding box of what a graphic draws at local time tl (drawn on black and on white, compared)."""
    spec = dict(spec)
    if spec.get("type") == "kinetic_text":
        spec["band"] = False  # the soft darkening behind kinetic text is meant to span the frame
    el = mo.build(spec)
    ctx = {"src_t": spec.get("t0", 0) + tl, "shake": 0.0, "level": lambda t: 0.5, "head": (OW / 2, OH * 0.3, 200)}
    a = np.zeros((OH, OW, 3), np.uint8); b = np.full((OH, OW, 3), 255, np.uint8)
    el.draw(a, tl, dur, ctx); el.draw(b, tl, dur, ctx)
    diff = (a.astype(np.int16) != 0).any(2) | (b.astype(np.int16) != 255).any(2)
    ys, xs = np.where(diff)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def _overlap(b1, b2):
    x0, y0, x1, y1 = max(b1[0], b2[0]), max(b1[1], b2[1]), min(b1[2], b2[2]), min(b1[3], b2[3])
    if x1 <= x0 or y1 <= y0: return 0.0
    inter = (x1 - x0) * (y1 - y0)
    small = min((b1[2] - b1[0]) * (b1[3] - b1[1]), (b2[2] - b2[0]) * (b2[3] - b2[1]))
    return inter / max(1, small)


def validate(plan_path, fix=False, check_layout=True):
    R = Report()
    plan_dir = os.path.dirname(os.path.abspath(plan_path))
    with open(plan_path, encoding="utf-8") as f:
        E = json.load(f)
    for k in ("source", "output", "timeline"):
        if k not in E: R.err(k, "missing")
    if R.errors: return R.as_dict(), E
    src = E["source"] if os.path.isabs(E["source"]) else os.path.join(plan_dir, E["source"])
    if not os.path.exists(src):
        R.err("source", f"file not found: {src}"); return R.as_dict(), E
    D = media.probe(src)["duration"]
    FPS = E["output"].get("fps", 30)

    # ---------------------------------------------------------- timeline
    main_ranges, total, out_events = [], 0.0, []
    seg_dur = {}
    for i, s in enumerate(E["timeline"]):
        w = f"timeline[{i}]"
        a, b = s["src"]
        if not (0 <= a < b <= D + 0.05): R.err(w, f"src {s['src']} outside video (0–{D:.2f}s) or empty")
        if s.get("transition_in") not in KNOWN_TR: R.err(w, f"unknown transition {s.get('transition_in')}")
        if s.get("role") not in KNOWN_ROLES: R.err(w, f"unknown role {s.get('role')}")
        z = s.get("zoom", 1.0)
        if not (z == "auto" or (isinstance(z, (int, float)) and 1.0 <= z <= 2.0)): R.err(w, f"zoom must be 'auto' or 1.0–2.0, got {z}")
        n = math.ceil(b * FPS) - math.ceil(a * FPS)
        d = (len(range(0, n, int(s.get("speed", 1))))) / FPS if s.get("reverse") else n / FPS
        if s.get("hold"): d = max(1, round(s["hold"] * FPS)) / FPS
        if s.get("role") is None and not s.get("reverse"): main_ranges.append((a, b))
        seg_dur.setdefault(s.get("role"), d)
        out_events.append(total)
        total += d
    if total > MAX_DURATION: R.err("timeline", f"output is {total:.1f}s; keep it under {MAX_DURATION:.0f}s for API publishing")
    shown = lambda t: any(a <= t < b for a, b in main_ranges)

    def src_to_out(t):
        acc = 0.0
        for s in E["timeline"]:
            a, b = s["src"]
            n = (math.ceil(b * FPS) - math.ceil(a * FPS)) / FPS
            if s.get("role") is None and not s.get("reverse") and a <= t < b:
                return acc + (t - a)
            if s.get("hold"): acc += max(1, round(s["hold"] * FPS)) / FPS; continue
            acc += len(range(0, int(n * FPS), int(s.get("speed", 1)))) / FPS if s.get("reverse") else n
        return None

    # ---------------------------------------------------------- captions
    caps = E.get("captions", [])
    caps.sort(key=lambda c: c["t0"])
    for i, c in enumerate(caps):
        w = f"captions[{i}] «{c['text']}»"
        if c["t1"] <= c["t0"]: R.err(w, "t1 must be after t0")
        if i + 1 < len(caps) and c["t1"] > caps[i + 1]["t0"] + 1e-3:
            if fix:
                c["t1"] = caps[i + 1]["t0"]; R.fixed(w, "trimmed to avoid overlapping the next caption")
            else:
                R.warn(w, "overlaps the next caption")
        if len(c["text"].split()) > 7: R.warn(w, "more than 7 words; split it for readability")
        bad = [e for e in c.get("emph", []) if e not in c["text"].split() and e not in [x.strip("!؟،.") for x in c["text"].split()]]
        if bad:
            if fix:
                c["emph"] = [e for e in c["emph"] if e not in bad]; R.fixed(w, f"removed emphasis words not in text: {bad}")
            else:
                R.warn(w, f"emphasis words not in text: {bad}")
        if not any(shown(t) for t in np.linspace(c["t0"], c["t1"] - 1e-3, 5)) and not any(
                a <= c["t0"] < b for s in E["timeline"] if s.get("role") == "cold_open" for a, b in [s["src"]]):
            R.warn(w, "falls inside a cut; it will never be shown")

    # ---------------------------------------------------------- effects / sfx
    for i, e in enumerate(E.get("effects", [])):
        if e["type"] not in KNOWN_FX: R.err(f"effects[{i}]", f"unknown effect {e['type']}")
        if e.get("t1", 0) <= e.get("t0", 0): R.err(f"effects[{i}]", "t1 must be after t0")
        if e["type"] == "scene":
            for j, sp in enumerate(e.get("places", [])):
                if sp.get("kind", "drawn") == "drawn" and sp.get("id") not in scenes.DRAWN:
                    R.err(f"effects[{i}].places[{j}]", f"unknown drawn place {sp.get('id')}")
                if sp.get("kind") in ("image", "video"):
                    pth = sp.get("path", "")
                    pth = pth if os.path.isabs(pth) else os.path.join(plan_dir, pth)
                    if not os.path.exists(pth): R.err(f"effects[{i}].places[{j}]", f"file not found: {pth}")
            if e.get("style") and e["style"] not in looks.STYLES: R.err(f"effects[{i}]", f"unknown style {e['style']}")
    lk = E.get("look") or {}
    if lk and lk.get("style") not in looks.STYLES: R.err("look", f"unknown look {lk.get('style')}")
    for k in E.get("overlays", []):
        if k not in looks.Texture.KINDS: R.err("overlays", f"unknown overlay {k}")
    for i, s in enumerate(E.get("sfx", [])):
        if s["type"] not in KNOWN_SFX: R.err(f"sfx[{i}]", f"unknown sfx {s['type']}")
        if "role" in s and s["role"] not in seg_dur: R.warn(f"sfx[{i}]", f"role {s['role']} not in timeline")

    # ---------------------------------------------------------- graphics
    boxes = []
    for i, g in enumerate(E.get("graphics", [])):
        w = f"graphics[{i}] {g.get('type')}"
        if g.get("type") not in KNOWN_GFX:
            R.err(w, f"unknown graphic type {g.get('type')}"); continue
        if "role" in g:
            if g["role"] not in seg_dur: R.err(w, f"role {g['role']} not in timeline"); continue
            if g["at"] + g["dur"] > seg_dur[g["role"]] + 0.02:
                if fix:
                    g["dur"] = round(seg_dur[g["role"]] - g["at"], 2); R.fixed(w, "duration clamped to its segment")
                else:
                    R.warn(w, "runs past the end of its segment")
            dur = g["dur"]; t_out = None
        else:
            if g["t1"] <= g["t0"]: R.err(w, "t1 must be after t0"); continue
            dur = g["t1"] - g["t0"]
            if not any(shown(t) for t in np.linspace(g["t0"], g["t1"] - 1e-3, 6)):
                R.warn(w, "falls inside a cut; it will never be shown")
            t_out = src_to_out(g["t0"])
            if t_out is not None: out_events.append(t_out)
        if check_layout and g["type"] not in FULLSCREEN:
            try:
                bb = _footprint(g, min(dur * 0.6, max(0.5, dur * 0.5)), dur)
            except Exception as ex:
                R.err(w, f"failed to draw: {ex}"); continue
            if bb:
                if bb[0] <= 1 or bb[2] >= OW - 2 or bb[1] <= 1 or bb[3] >= OH - 2:
                    R.warn(w, f"touches the frame edge (box {bb}); it may be cut off")
                if "t0" in g and bb[3] > CAPTION_BAND[0] and bb[1] < CAPTION_BAND[1] and any(
                        c["t0"] < g["t1"] and g["t0"] < c["t1"] for c in caps):
                    R.warn(w, f"overlaps the caption area (box {bb})")
                boxes.append((w, g, bb))
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            (w1, g1, b1), (w2, g2, b2) = boxes[i], boxes[j]
            same_time = ("t0" in g1 and "t0" in g2 and g1["t0"] < g2["t1"] and g2["t0"] < g1["t1"]) or \
                        ("role" in g1 and g1.get("role") == g2.get("role"))
            if same_time and _overlap(b1, b2) > 0.15:
                R.warn(f"{w1} + {w2}", "shown at the same time and overlap on screen")

    # ---------------------------------------------------------- pacing heuristics (director feedback)
    for p in E.get("zoom", {}).get("punches", []):
        t = src_to_out(p["t"])
        if t is not None: out_events.append(t)
    for e in E.get("effects", []):
        for t in (e["t0"], e.get("t1", e["t0"])):
            to = src_to_out(t)
            if to is not None: out_events.append(to)
    ev = sorted(set(round(t, 2) for t in out_events if t is not None)) + [round(total, 2)]
    for a, b in zip(ev, ev[1:]):
        if b - a > 4.0:
            R.warn("pacing", f"{b - a:.1f}s without a visual change (output {a:.1f}–{b:.1f}s); add a graphic, punch or cut")
    first = E["timeline"][0]
    if first.get("role") != "cold_open" and not any(("t0" in g and src_to_out(g["t0"]) is not None and src_to_out(g["t0"]) < 1.5)
                                                     for g in E.get("graphics", [])):
        R.warn("hook", "nothing grabs attention in the first 1.5s (no cold open or graphic)")
    E["captions"] = caps
    return R.as_dict(), E
