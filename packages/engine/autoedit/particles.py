"""Particles (confetti, snow, rain, hearts, ...) and things that pass behind the speaker.
Everything is a pure function of time: any frame can be drawn in any render process."""
import math, os
import numpy as np
import cv2
from PIL import Image, ImageDraw
from .config import asset
from . import fx

W, H = 1080, 1920
_EMOJI = {}


def emoji(name, size):
    """Noto emoji (assets/emoji/<name>.png) as RGBA at `size` px; None when the asset is missing."""
    k = (name, size)
    if k not in _EMOJI:
        p = asset("emoji", f"{name}.png")
        if not os.path.exists(p):
            _EMOJI[k] = None
        else:
            im = Image.open(p).convert("RGBA").resize((size, size), Image.LANCZOS)
            _EMOJI[k] = np.array(im)
    return _EMOJI[k]


def _sprite(kind, s, rng):
    """Small RGBA sprite for one particle."""
    if kind in ("hearts",):
        e = emoji("heart", s)
        if e is not None: return e
    if kind == "money":
        e = emoji("bill", s)
        if e is not None: return e
    if kind == "leaves":
        e = emoji("leaf", s)
        if e is not None: return e
    S = 3
    im = Image.new("RGBA", (s * S, s * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = s * S / 2
    if kind == "confetti":
        col = [(255, 210, 31), (108, 76, 255), (232, 52, 52), (38, 190, 110), (60, 170, 255), (255, 120, 190)][int(rng.random() * 6)]
        d.rectangle([c - s * S * 0.22, c - s * S * 0.42, c + s * S * 0.22, c + s * S * 0.42], fill=col + (255,))
    elif kind == "snow":
        d.ellipse([c - c * 0.8, c - c * 0.8, c + c * 0.8, c + c * 0.8], fill=(255, 255, 255, 235))
    elif kind in ("stars", "sparkles"):
        pts = []
        n = 5 if kind == "stars" else 4
        for i in range(n * 2):
            r = c * (0.95 if i % 2 == 0 else (0.42 if kind == "stars" else 0.18))
            a = math.pi * i / n - math.pi / 2
            pts.append((c + r * math.cos(a), c + r * math.sin(a)))
        col = (255, 214, 60, 255) if kind == "stars" else (255, 255, 240, 255)
        d.polygon(pts, fill=col)
    elif kind == "embers":
        d.ellipse([c - c * 0.5, c - c * 0.5, c + c * 0.5, c + c * 0.5], fill=(255, 170, 60, 255))
    elif kind == "bubbles":
        d.ellipse([c - c * 0.9, c - c * 0.9, c + c * 0.9, c + c * 0.9], outline=(230, 250, 255, 230), width=max(2, s * S // 12))
        d.ellipse([c - c * 0.5, c - c * 0.6, c - c * 0.2, c - c * 0.3], fill=(255, 255, 255, 220))
    elif kind == "hearts":
        d.ellipse([c - c * 0.9, c - c * 0.7, c, c * 0.9], fill=(240, 60, 90, 255))
        d.ellipse([c, c - c * 0.7, c + c * 0.9, c * 0.9], fill=(240, 60, 90, 255))
        d.polygon([(c - c * 0.86, c - c * 0.1), (c + c * 0.86, c - c * 0.1), (c, c + c * 0.85)], fill=(240, 60, 90, 255))
    else:  # rain handled as lines
        pass
    return np.array(im.resize((s, s), Image.LANCZOS))


# per kind: count (normal), size range px, fall speed px/s, sway, spin
KINDS = {
    "confetti": (70, (22, 34), (380, 620), 60, 360), "snow": (110, (8, 22), (90, 200), 40, 0),
    "rain": (160, (0, 0), (1600, 2200), 0, 0), "hearts": (24, (50, 90), (-260, -140), 50, 25),
    "stars": (30, (30, 60), (120, 240), 30, 90), "sparkles": (40, (18, 40), (0, 0), 0, 0),
    "embers": (60, (6, 14), (-320, -160), 45, 0), "bubbles": (34, (24, 70), (-260, -120), 35, 0),
    "leaves": (22, (50, 80), (160, 260), 120, 140), "money": (26, (70, 110), (300, 460), 90, 200),
}
AMOUNT = {"few": 0.5, "normal": 1.0, "many": 1.8}


class Particles:
    def __init__(self, kind="confetti", amount="normal", seed=3):
        self.kind = kind if kind in KINDS else "confetti"
        n, (s0, s1), (v0, v1), self.sway, spin = KINDS[self.kind]
        n = int(n * AMOUNT.get(amount, 1.0))
        rng = np.random.default_rng(seed)
        self.p = []
        for i in range(n):
            size = int(s0 + rng.random() * (s1 - s0)) if s1 else 0
            self.p.append(dict(x=rng.random() * W, y=rng.random() * H, v=v0 + rng.random() * (v1 - v0), ph=rng.random() * 6.28,
                               spin=(rng.random() - 0.5) * 2 * spin, size=size,
                               img=_sprite(self.kind, size, rng) if size and self.kind not in ("rain",) else None))

    def draw(self, layer, tl, alpha=1.0):
        """Draw at local time tl into an RGB frame or RGBA layer."""
        from .motion import blit
        if self.kind == "rain":
            for q in self.p:
                y = (q["y"] + tl * q["v"]) % (H + 120) - 60
                x = q["x"] - (y * 0.12)
                col = (200, 215, 235) + ((int(170 * alpha),) if layer.shape[2] == 4 else ())
                cv2.line(layer, (int(x), int(y)), (int(x - 6), int(y + 46)), col, 2, lineType=cv2.LINE_AA)
            return
        for q in self.p:
            if self.kind == "sparkles":
                k = 0.5 + 0.5 * math.sin(tl * 4 + q["ph"] * 3)
                if k < 0.35: continue
                blit(layer, q["img"], q["x"], q["y"], alpha=alpha * k, scale=0.4 + 0.8 * k)
                continue
            y = (q["y"] + tl * q["v"]) % (H + 200) - 100
            x = q["x"] + self.sway * math.sin(tl * 1.6 + q["ph"])
            ang = q["spin"] * tl
            sc = 1.0
            if self.kind == "confetti":
                sc = 0.55 + 0.45 * abs(math.cos(tl * 5 + q["ph"]))   # paper flipping
            blit(layer, q["img"], x, y, alpha=alpha, scale=sc, angle=ang)


# ------------------------------------------------------------------ things that pass behind the speaker
FLYOVER = {"dinosaur": None, "rocket": "rocket", "ufo": "ufo", "plane": "plane", "birds": "bird", "balloon": "balloon"}


class Flyover:
    """Crosses the frame once over the effect window. Drawn into the background layer."""

    def __init__(self, obj="dinosaur", direction="rtl", size="big", y=None):
        self.obj = obj if obj in FLYOVER else "dinosaur"
        self.dir = direction
        self.big = size != "small"
        self.y = y
        self._dino = {}
        px = {"rocket": 520, "ufo": 480, "plane": 520, "birds": 220, "balloon": 420}.get(self.obj, 0)
        if not self.big: px = int(px * 0.6)
        img = emoji(FLYOVER[self.obj], px) if FLYOVER.get(self.obj) else None
        if img is not None and self.obj in ("plane", "rocket"):
            # the Noto plane/rocket fly up-right: turn them to fly along the path
            img = _rotate(img, -45 if self.obj == "plane" else -45)
        if img is not None and self.dir == "rtl" and self.obj not in ("ufo", "balloon"):
            img = img[:, ::-1].copy()
        self.img = img

    def dino(self, phase):
        k = round(phase * 36) % 36
        if k not in self._dino:
            sp = fx.dino_sprite(k / 36, 1.05 if self.big else 0.7)
            self._dino[k] = sp if self.dir == "rtl" else sp[:, ::-1].copy()
        return self._dino[k]

    def draw(self, bg, tl, u):
        """u = progress 0..1 across the window."""
        from .motion import blit
        if self.obj == "dinosaur":
            sp = self.dino((tl / 1.24) % 1.0)
            h, w = sp.shape[:2]
        else:
            sp = self.img
            if sp is None: return
            h, w = sp.shape[:2]
        span = W + w + 60
        x = (W + 30 - u * span + w / 2) if self.dir == "rtl" else (-30 + u * span - w / 2)
        if self.obj == "dinosaur":
            y = self.y if self.y else H * 0.505
            blit(bg, sp, x, y)
            return
        base = self.y if self.y else {"birds": H * 0.2, "balloon": H * 0.28, "ufo": H * 0.22}.get(self.obj, H * 0.25)
        if self.obj == "rocket":
            y = base + 260 - u * 520
        elif self.obj == "balloon":
            y = base + 40 * math.sin(tl * 1.3)
        else:
            y = base + 30 * math.sin(tl * 2.2)
        if self.obj == "birds":
            for k, (dx, dy) in enumerate([(0, 0), (-150, 70), (150, 90), (-280, 150), (280, 170)]):
                flap = 1 + 0.12 * math.sin(tl * 12 + k)
                blit(bg, sp, x + dx * (1 if self.dir == "rtl" else -1), y + dy, scale=(0.8 if k else 1.0) * flap)
            return
        ang = 8 * math.sin(tl * 3) if self.obj == "ufo" else 0
        blit(bg, sp, x, y, angle=ang)
        if self.obj == "ufo":   # tractor beam
            pass


def _rotate(img, angle):
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
