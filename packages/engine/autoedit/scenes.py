"""Backgrounds for the `scene` effect: places the engine draws itself (flat illustration, original art),
the creator's own photos / videos, and images made by the local generator.

Every source gives `frame(t) -> RGB uint8 (H, W, 3)` plus an optional foreground layer (RGBA, drawn over
the person, e.g. leaves) and a rim-light colour that ties the person into the new light."""
import math, os
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter
from . import fx

W, H = 1080, 1920


# ------------------------------------------------------------------ drawing helpers
def _grad(h, w, stops):
    """Vertical gradient. stops = [(pos 0..1, (r,g,b)), ...]"""
    y = np.linspace(0, 1, h, dtype=np.float32)
    out = np.zeros((h, 3), np.float32)
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        m = (y >= p0) & (y <= p1)
        k = ((y[m] - p0) / max(1e-6, p1 - p0))[:, None]
        out[m] = np.array(c0, np.float32) * (1 - k) + np.array(c1, np.float32) * k
    return np.repeat(out[:, None, :], w, axis=1)


def _img(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert("RGBA")


def _layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def _ridge(d, base, amp, col, rng, step=20, f1=160, f2=57):
    ph = rng.random() * 6
    pts = [(x, base + amp * math.sin(x / f1 + ph) + amp * 0.5 * math.sin(x / f2 + ph * 2)) for x in range(-20, W + 40, step)]
    d.polygon(pts + [(W + 40, H), (-20, H)], fill=col)


def _glow(arr, cx, cy, r, col, amt):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    g = np.clip(1 - np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r, 0, 1) ** 2
    return arr + g[..., None] * np.array(col, np.float32) * amt


def _clouds(arr, rng, n, y0, y1, col=(255, 255, 255), alpha=0.9):
    L = _layer(); d = ImageDraw.Draw(L)
    for _ in range(n):
        cx, cy, s = rng.random() * W, y0 + rng.random() * (y1 - y0), 0.6 + rng.random() * 0.9
        for k in range(5):
            r = (60 + rng.random() * 50) * s
            d.ellipse([cx + (k - 2) * 55 * s - r, cy - r * (0.6 + rng.random() * 0.5), cx + (k - 2) * 55 * s + r, cy + r * 0.5],
                      fill=col + (int(255 * alpha),))
    L = L.filter(ImageFilter.GaussianBlur(3))
    return np.array(Image.alpha_composite(_img(arr), L).convert("RGB")).astype(np.float32)


def _palm(d, x, y, h, lean, rng, trunk=(120, 84, 52, 255), leaf=(42, 128, 70, 255)):
    pts = []
    for i in range(30):
        t = i / 29
        pts.append((x + lean * t ** 1.6, y - h * t))
    for i, (px, py) in enumerate(pts[:-1]):
        wdt = 34 - 18 * i / 29
        d.line([(px, py), pts[i + 1]], fill=trunk, width=int(wdt))
    tx, ty = pts[-1]
    for k in range(7):
        a = math.radians(-160 + k * 30 + rng.random() * 10)
        fx._leaf(d, tx, ty, 260 + rng.random() * 80, 46, math.degrees(a), leaf, (26, 90, 48, 255))


# ------------------------------------------------------------------ drawn places
def beach(seed=3):
    rng = np.random.default_rng(seed)
    a = _grad(H, W, [(0, (80, 170, 235)), (0.5, (200, 232, 250)), (0.62, (250, 240, 215)), (1, (250, 240, 215))])
    a = _clouds(a, rng, 4, 150, 600)
    a = _glow(a, 760, 520, 420, (255, 230, 160), 0.6)
    im = _img(a); d = ImageDraw.Draw(im)
    d.ellipse([690, 450, 830, 590], fill=(255, 240, 190, 255))
    sea_top = 1080
    d.rectangle([0, sea_top, W, 1420], fill=(30, 140, 200, 255))
    for i in range(14):
        y = sea_top + 12 + i * 24
        d.line([(0, y), (W, y)], fill=(70, 175, 225, 255), width=3)
    shore = [(x, 1400 + 40 * math.sin(x / 140) + 20 * math.sin(x / 47)) for x in range(-20, W + 40, 20)]
    d.polygon(shore + [(W + 40, H), (-20, H)], fill=(238, 214, 160, 255))
    d.line(shore, fill=(255, 255, 255, 255), width=10)
    fg = _layer(); f = ImageDraw.Draw(fg)
    _palm(f, -30, H + 40, 1350, 190, rng)
    _palm(f, W + 40, H + 40, 1200, -220, rng)
    return np.array(im.convert("RGB")), np.array(fg.filter(ImageFilter.GaussianBlur(1.5))), (255, 220, 160)


def space(seed=5):
    rng = np.random.default_rng(seed)
    a = _grad(H, W, [(0, (6, 6, 22)), (0.6, (20, 14, 52)), (1, (10, 8, 30))])
    neb = fx._noise(H, W, 5, seed=11)
    neb = np.clip((neb - 0.45) * 3, 0, 1)
    neb = cv2.GaussianBlur(neb, (0, 0), 30)
    a += neb[..., None] * np.array([120, 50, 160], np.float32) * 0.8
    neb2 = cv2.GaussianBlur(np.clip((fx._noise(H, W, 5, seed=17) - 0.5) * 3, 0, 1), (0, 0), 40)
    a += neb2[..., None] * np.array([30, 90, 170], np.float32) * 0.7
    im = _img(a); d = ImageDraw.Draw(im)
    for _ in range(420):
        x, y, r = rng.random() * W, rng.random() * H, rng.random() ** 3 * 3 + 0.6
        v = int(160 + rng.random() * 95)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(v, v, 255, 255))
    # planet with a ring
    cx, cy, R = 800, 420, 190
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(230, 140, 90, 255))
    for k in range(6):
        y = cy - R + 50 + k * 55
        d.chord([cx - R, cy - R, cx + R, cy + R], 0, 360, fill=None)
        d.line([(cx - R * 0.95, y), (cx + R * 0.95, y + 12)], fill=(200, 110, 70, 255), width=18)
    d.ellipse([cx - R * 1.8, cy - 38, cx + R * 1.8, cy + 38], outline=(250, 220, 180, 255), width=10)
    d.ellipse([190, 980, 300, 1090], fill=(180, 190, 210, 255))
    d.ellipse([210, 1000, 240, 1030], fill=(150, 160, 185, 255))
    stars = [(rng.random() * W, rng.random() * H, rng.random() * 6.28) for _ in range(40)]

    def anim(bg, t):
        for x, y, ph in stars:
            v = 0.5 + 0.5 * math.sin(t * 3 + ph)
            if v > 0.7:
                cv2.circle(bg, (int(x), int(y)), 2, (255, 255, 255), -1, lineType=cv2.LINE_AA)
                cv2.line(bg, (int(x) - 7, int(y)), (int(x) + 7, int(y)), (220, 220, 255), 1, cv2.LINE_AA)
        return bg
    return np.array(im.convert("RGB")), None, (150, 130, 255), anim


def city_night(seed=8):
    rng = np.random.default_rng(seed)
    a = _grad(H, W, [(0, (14, 16, 48)), (0.55, (70, 40, 110)), (0.75, (190, 80, 120)), (1, (40, 20, 50))])
    im = _img(a); d = ImageDraw.Draw(im)
    for _ in range(90):
        x, y = rng.random() * W, rng.random() * 800
        d.ellipse([x - 1.5, y - 1.5, x + 1.5, y + 1.5], fill=(230, 230, 255, 255))
    d.ellipse([140, 230, 300, 390], fill=(250, 245, 220, 255))
    d.ellipse([175, 225, 325, 375], fill=(30, 26, 70, 255))
    windows = []
    for layer, (base, col, wincol, hmin, hmax) in enumerate([(1250, (60, 46, 100), (190, 170, 120), 200, 520),
                                                                (1350, (32, 26, 60), (255, 214, 120), 300, 700)]):
        x = -30
        while x < W:
            bw = 90 + rng.random() * 120
            bh = hmin + rng.random() * (hmax - hmin)
            d.rectangle([x, base - bh, x + bw, H], fill=col + (255,))
            if rng.random() < 0.3:
                d.rectangle([x + bw / 2 - 4, base - bh - 60, x + bw / 2 + 4, base - bh], fill=col + (255,))
            for wy in np.arange(base - bh + 24, base + 300, 46):
                for wx in np.arange(x + 14, x + bw - 20, 30):
                    if rng.random() < 0.42:
                        d.rectangle([wx, wy, wx + 14, wy + 22], fill=wincol + (255,))
                        if layer == 1: windows.append((int(wx), int(wy)))
            x += bw + 6
    d.rectangle([0, 1600, W, H], fill=(20, 16, 36, 255))
    flick = [windows[i] for i in rng.choice(len(windows), min(30, len(windows)), replace=False)] if windows else []

    def anim(bg, t):
        for i, (wx, wy) in enumerate(flick):
            if math.sin(t * 2.3 + i * 1.7) > 0.6:
                bg[wy:wy + 22, wx:wx + 14] = (40, 32, 70)
        return bg
    return np.array(im.convert("RGB")), None, (255, 110, 200), anim


def desert(seed=4):
    rng = np.random.default_rng(seed)
    a = _grad(H, W, [(0, (250, 150, 80)), (0.45, (255, 214, 150)), (0.6, (255, 230, 180)), (1, (230, 170, 100))])
    a = _glow(a, 300, 700, 500, (255, 240, 180), 0.7)
    im = _img(a); d = ImageDraw.Draw(im)
    d.ellipse([200, 600, 400, 800], fill=(255, 246, 210, 255))
    d.polygon([(720, 1130), (880, 900), (1040, 1130)], fill=(214, 160, 100, 255))
    d.polygon([(880, 900), (1040, 1130), (930, 1130)], fill=(186, 130, 80, 255))
    for base, amp, col in [(1120, 40, (236, 170, 100)), (1230, 60, (222, 150, 86)), (1380, 80, (206, 132, 72)), (1560, 70, (190, 116, 62))]:
        _ridge(d, base, amp, col + (255,), rng, 20, 220, 90)
    fg = _layer(); f = ImageDraw.Draw(fg)
    for (cx, base, s) in [(90, 1900, 1.4), (990, 1850, 1.1)]:
        cg = (60, 130, 70, 255)
        f.rounded_rectangle([cx - 38 * s, base - 520 * s, cx + 38 * s, base + 40], radius=int(38 * s), fill=cg)
        f.rounded_rectangle([cx - 140 * s, base - 380 * s, cx - 90 * s, base - 220 * s], radius=int(25 * s), fill=cg)
        f.rectangle([cx - 140 * s, base - 250 * s, cx - 30 * s, base - 200 * s], fill=cg)
        f.rounded_rectangle([cx + 90 * s, base - 440 * s, cx + 140 * s, base - 300 * s], radius=int(25 * s), fill=cg)
        f.rectangle([cx + 30 * s, base - 330 * s, cx + 140 * s, base - 280 * s], fill=cg)
    return np.array(im.convert("RGB")), np.array(fg.filter(ImageFilter.GaussianBlur(1.6))), (255, 190, 120)


def snow(seed=6):
    rng = np.random.default_rng(seed)
    a = _grad(H, W, [(0, (120, 170, 225)), (0.55, (210, 230, 250)), (1, (235, 244, 252))])
    im = _img(a); d = ImageDraw.Draw(im)
    for (x0, peak, x1, col) in [(-200, 560, 640, (150, 170, 205)), (380, 420, 1300, (125, 148, 190)), (-100, 760, 900, (100, 124, 170))]:
        px = (x0 + x1) / 2 + rng.random() * 80 - 40
        d.polygon([(x0, 1250), (px, peak), (x1, 1250)], fill=col + (255,))
        cap = 0.32
        d.polygon([(px - (px - x0) * cap, peak + (1250 - peak) * cap), (px, peak), (px + (x1 - px) * cap, peak + (1250 - peak) * cap),
                   (px + (x1 - px) * cap * 0.5, peak + (1250 - peak) * cap * 0.8), (px, peak + (1250 - peak) * cap * 1.1),
                   (px - (px - x0) * cap * 0.5, peak + (1250 - peak) * cap * 0.85)], fill=(250, 252, 255, 255))
    _ridge(d, 1240, 30, (240, 246, 252, 255), rng, 20, 300, 120)

    def pine(dd, x, base, s, col=(34, 84, 70, 255)):
        dd.rectangle([x - 10 * s, base - 40 * s, x + 10 * s, base], fill=(90, 60, 40, 255))
        for k in range(4):
            yb = base - 30 * s - k * 70 * s
            ww = (130 - k * 26) * s
            dd.polygon([(x - ww, yb), (x, yb - 120 * s), (x + ww, yb)], fill=col)
            dd.polygon([(x - ww * 0.5, yb - 60 * s), (x, yb - 120 * s), (x + ww * 0.5, yb - 60 * s)], fill=(245, 250, 255, 255))
    for x in range(-40, W + 60, 110):
        pine(d, x + rng.random() * 40, 1300 + rng.random() * 30, 0.55 + rng.random() * 0.2, (60, 110, 100, 255))
    fg = _layer(); f = ImageDraw.Draw(fg)
    pine(f, 60, H + 30, 2.2); pine(f, W - 40, H + 50, 2.0)
    return np.array(im.convert("RGB")), np.array(fg.filter(ImageFilter.GaussianBlur(1.6))), (200, 230, 255)


def underwater(seed=9):
    rng = np.random.default_rng(seed)
    a = _grad(H, W, [(0, (60, 200, 210)), (0.45, (20, 120, 170)), (1, (8, 40, 90))])
    rays = _layer(); r = ImageDraw.Draw(rays)
    for k in range(7):
        x = 80 + k * 160 + rng.random() * 60
        r.polygon([(x, -10), (x + 70, -10), (x + 260, 1500), (x + 120, 1500)], fill=(255, 255, 255, 40))
    im = Image.alpha_composite(_img(a), rays.filter(ImageFilter.GaussianBlur(20)))
    d = ImageDraw.Draw(im)
    _ridge(d, 1640, 40, (200, 180, 130, 255), rng, 20, 200, 80)
    for k in range(9):
        x = rng.random() * W
        col = (40, 150, 90, 255) if k % 2 else (30, 120, 80, 255)
        pts = [(x + 26 * math.sin(i / 3 + k), 1700 - i * 34) for i in range(14 + int(rng.random() * 8))]
        d.line(pts, fill=col, width=18, joint="curve")
    for _ in range(9):
        x, y, s = rng.random() * W, 300 + rng.random() * 1100, 0.6 + rng.random() * 0.8
        col = [(255, 140, 60), (255, 210, 60), (240, 90, 120), (120, 200, 255)][int(rng.random() * 4)]
        d.ellipse([x - 40 * s, y - 20 * s, x + 40 * s, y + 20 * s], fill=col + (255,))
        d.polygon([(x + 34 * s, y), (x + 70 * s, y - 24 * s), (x + 70 * s, y + 24 * s)], fill=col + (255,))
        d.ellipse([x - 26 * s, y - 8 * s, x - 16 * s, y + 2 * s], fill=(20, 20, 30, 255))
    bub = [(rng.random() * W, rng.random() * H, 4 + rng.random() * 12, 80 + rng.random() * 120) for _ in range(28)]

    def anim(bg, t):
        for x, y, rr, sp in bub:
            yy = int((y - t * sp) % H)
            xx = int(x + 8 * math.sin(t * 2 + y))
            cv2.circle(bg, (xx, yy), int(rr), (220, 245, 255), 2, lineType=cv2.LINE_AA)
        return bg
    return np.array(im.convert("RGB")), None, (120, 230, 255), anim


def sky(seed=2):
    s = fx.make_sky(W, H, 1.0)
    return np.clip(s[:H], 0, 255).astype(np.uint8), None, (180, 220, 255)


def sunset(seed=7):
    rng = np.random.default_rng(seed)
    a = _grad(H, W, [(0, (60, 40, 120)), (0.35, (220, 90, 110)), (0.55, (255, 170, 90)), (0.6, (255, 200, 120)), (1, (80, 40, 70))])
    a = _glow(a, W / 2, 1100, 700, (255, 200, 120), 0.6)
    im = _img(a); d = ImageDraw.Draw(im)
    d.ellipse([W / 2 - 170, 930, W / 2 + 170, 1270], fill=(255, 220, 140, 255))
    d.rectangle([0, 1120, W, H], fill=(120, 60, 90, 255))
    for i in range(18):
        y = 1130 + i * 26
        half = 200 - i * 9
        if half > 10:
            d.line([(W / 2 - half, y), (W / 2 + half, y)], fill=(255, 200, 130, 255), width=6)
    _ridge(d, 1450, 60, (70, 34, 60, 255), rng, 20, 240, 90)
    for k in range(5):
        x, y = 200 + k * 70 + rng.random() * 30, 500 + rng.random() * 120
        d.line([(x - 18, y), (x, y + 8), (x + 18, y)], fill=(50, 30, 50, 255), width=5)
    return np.array(im.convert("RGB")), None, (255, 170, 110)


def jungle(seed=21):
    bg, fg = fx.make_jungle(W, H, seed)
    return bg.astype(np.uint8), fg, (255, 205, 130)


DRAWN = {"jungle": jungle, "beach": beach, "space": space, "city_night": city_night, "desert": desert,
         "snow": snow, "underwater": underwater, "sky": sky, "sunset": sunset}


# ------------------------------------------------------------------ sources
def cover(img, w=W, h=H):
    """Resize to fill w x h, centre crop."""
    ih, iw = img.shape[:2]
    s = max(w / iw, h / ih)
    nw, nh = int(math.ceil(iw * s)), int(math.ceil(ih * s))
    r = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4)
    x0, y0 = (nw - w) // 2, (nh - h) // 2
    return r[y0:y0 + h, x0:x0 + w]


class Source:
    """One background. style is applied once for still sources and per frame for videos."""

    def __init__(self, spec, base_dir, style_fn=None):
        self.kind = spec.get("kind", "drawn")
        self.fg, self.rim, self.anim, self.cap = None, (255, 255, 255), None, None
        self.style_fn = style_fn
        if self.kind == "drawn":
            res = DRAWN[spec.get("id", "jungle")]()
            self.still, self.fg, self.rim = res[0], res[1], res[2]
            self.anim = res[3] if len(res) > 3 else None
        else:
            path = spec["path"] if os.path.isabs(spec["path"]) else os.path.normpath(os.path.join(base_dir, spec["path"]))
            if self.kind == "video":
                self.cap = cv2.VideoCapture(path)
                self.n = max(1, int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT)))
                self.vfps = self.cap.get(cv2.CAP_PROP_FPS) or 30
                self.pos = -1
                self.still = None
            else:
                bgr = cv2.imread(path, cv2.IMREAD_COLOR)
                if bgr is None:
                    raise ValueError(f"cannot read background image: {path}")
                img = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                if max(img.shape[:2]) < 1400:   # generated images are small: upscale with a light sharpen
                    img = cover(img)
                    img = cv2.addWeighted(img, 1.35, cv2.GaussianBlur(img, (0, 0), 2), -0.35, 0)
                self.still = cover(img)
            self.rim = tuple(int(x) for x in (self.still if self.still is not None else np.full((4, 4, 3), 200)).reshape(-1, 3).mean(0) * 0.6 + 100)
        if self.still is not None and style_fn:
            self.still = style_fn(self.still)
            if self.fg is not None:
                rgb = style_fn(np.ascontiguousarray(self.fg[..., :3]))
                self.fg = np.dstack([rgb, self.fg[..., 3]])

    def frame(self, t):
        if self.still is not None:
            bg = self.still.copy()
            return self.anim(bg, t) if self.anim else bg
        idx = int(t * self.vfps) % self.n
        if idx != self.pos + 1:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, bgr = self.cap.read()
        if not ok:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0); ok, bgr = self.cap.read()
        self.pos = idx
        img = cover(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        return self.style_fn(img) if self.style_fn else img


def sky_texture(time="day"):
    """Tall sky for the flying effect (scrolls vertically)."""
    s = fx.make_sky(W, H, 2.0)
    if time == "sunset":
        y = np.linspace(0, 1, s.shape[0], dtype=np.float32)[:, None, None]
        tint = np.array([255, 150, 110], np.float32) * (0.5 + 0.5 * np.abs(np.sin(y * math.pi)))
        s = s * 0.55 + tint * 0.45
    elif time == "night":
        s = s * np.array([0.18, 0.2, 0.38], np.float32)
        rng = np.random.default_rng(4)
        for _ in range(900):
            x, y = int(rng.random() * W), int(rng.random() * s.shape[0])
            v = 150 + rng.random() * 105
            s[y, x] = (v, v, 255)
        s = cv2.GaussianBlur(s, (0, 0), 0.6)
    return s.astype(np.float32)
