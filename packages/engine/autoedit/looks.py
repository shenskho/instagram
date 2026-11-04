"""Whole-frame looks, graphic skins and textures. All local, CPU only, deterministic per frame
(no per-frame palettes), so a look does not flicker between frames or between render processes.

  apply(img, style)            -> RGB uint8, same size
  skin(rgba, skin, frame_i)    -> RGBA uint8 overlay restyled to match the look
  Texture(kinds, w, h).apply(frame, t, i)
"""
import math
import numpy as np
import cv2

STYLES = ("natural", "cinematic", "warm", "cool", "vivid", "pastel", "vintage", "bw", "cartoon", "comic", "anime",
          "sketch", "color_pencil", "watercolor", "oil", "pixel", "neon")
SKIN_OF = {"natural": "clean", "cinematic": "clean", "warm": "clean", "cool": "clean", "vivid": "clean", "pastel": "clean",
           "vintage": "retro", "bw": "mono", "cartoon": "cartoon", "anime": "cartoon", "comic": "comic",
           "sketch": "sketch", "color_pencil": "sketch", "watercolor": "paint", "oil": "paint", "pixel": "pixel", "neon": "neon"}
# looks that replace the camera grade (the others are applied on top of the normal grade)
REPLACES_GRADE = {"cinematic", "warm", "cool", "vivid", "pastel", "vintage", "bw"}

PAPER = np.array([245, 241, 232], np.float32)


# ------------------------------------------------------------------ helpers
def _half(img):
    h, w = img.shape[:2]
    return cv2.resize(img, (w // 2, h // 2), interpolation=cv2.INTER_AREA)


def _up(img, w, h, interp=cv2.INTER_LINEAR):
    return cv2.resize(img, (w, h), interpolation=interp)


def _sat(img, k, add=0.0):
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * k + add, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)


_VIGN = {}


def _vignette(h, w, strength):
    k = (h, w, strength)
    if k not in _VIGN:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
        _VIGN[k] = (1 - strength * np.clip(r - 0.2, 0, None) / 1.8)[..., None].astype(np.float32)
    return _VIGN[k]


def _posterize_lab(img, levels=7, ab_step=14):
    """Fixed-step colour quantisation in Lab: the same input colour always maps to the same output (no flicker)."""
    lab = cv2.cvtColor(img, cv2.COLOR_RGB2LAB).astype(np.float32)
    step = 255.0 / levels
    lab[..., 0] = np.clip((np.floor(lab[..., 0] / step) + 0.5) * step * 1.04, 0, 255)
    lab[..., 1:] = np.round((lab[..., 1:] - 128) / ab_step) * ab_step + 128
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)


def _ink_edges(img, block=9, c=4, blur=7):
    g = cv2.medianBlur(cv2.cvtColor(img, cv2.COLOR_RGB2GRAY), blur)
    e = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, block, c)
    # drop specks: lines must be at least a few pixels long
    e = 255 - cv2.morphologyEx(255 - e, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return e


# ------------------------------------------------------------------ colour grades (realistic family)
def _grade(img, style):
    f = img.astype(np.float32) / 255
    if style == "cinematic":
        lum = f.mean(-1, keepdims=True)
        teal, orange = np.array([0.0, 0.5, 0.55], np.float32), np.array([1.0, 0.62, 0.35], np.float32)
        f = f * 0.78 + 0.22 * (lum * orange + (1 - lum) * teal) * (0.6 + 0.4 * f)
        f = np.clip((f - 0.5) * 1.14 + 0.49, 0, 1) * _vignette(*f.shape[:2], 0.35)
    elif style == "warm":
        f = f * np.array([1.08, 1.0, 0.86], np.float32) + np.array([0.02, 0.01, 0.0], np.float32)
        f = np.clip((f - 0.5) * 1.06 + 0.5, 0, 1)
    elif style == "cool":
        f = f * np.array([0.9, 1.0, 1.1], np.float32) + np.array([0.0, 0.01, 0.03], np.float32)
        f = np.clip((f - 0.5) * 1.05 + 0.5, 0, 1)
    elif style == "vivid":
        f = np.clip((f - 0.5) * 1.22 + 0.5, 0, 1)
        return _sat((f * 255).astype(np.uint8), 1.45)
    elif style == "pastel":
        f = f * 0.82 + 0.17
        out = _sat((np.clip(f, 0, 1) * 255).astype(np.uint8), 0.75)
        return out
    elif style == "vintage":
        f = f * 0.84 + 0.08
        sep = np.array([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]], np.float32)
        f = 0.55 * f + 0.45 * np.clip(f @ sep.T, 0, 1)
        f = f * _vignette(*f.shape[:2], 0.55)
    elif style == "bw":
        g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
        g = np.clip((g - 0.5) * 1.45 + 0.48, 0, 1)[..., None] * _vignette(*g.shape[:2], 0.5)
        f = np.repeat(g, 3, axis=2)
    return (np.clip(f, 0, 1) * 255).astype(np.uint8)


# ------------------------------------------------------------------ drawn / painted / digital looks
def cartoon(img, lines=True):
    h, w = img.shape[:2]
    s = _half(img)
    for _ in range(2):
        s = cv2.bilateralFilter(s, 9, 38, 7)
    s = _posterize_lab(s, 7, 14)
    s = cv2.medianBlur(s, 3)
    s = _up(s, w, h)
    s = _sat(s, 1.3)
    if lines:
        e = _ink_edges(_half(img), 9, 4, 5)
        e = _up(e, w, h).astype(np.float32)[..., None] / 255
        s = (s.astype(np.float32) * (0.15 + 0.85 * e)).astype(np.uint8)
    return s


def comic(img):
    h, w = img.shape[:2]
    base = cartoon(img).astype(np.float32)
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_RGB2GRAY), (0, 0), 3).astype(np.float32) / 255
    dots = _halftone(h, w, 12, g)
    base *= 1 - 0.45 * dots[..., None]
    return np.clip(base, 0, 255).astype(np.uint8)


_HT = {}


def _halftone(h, w, step, g):
    if (h, w, step) not in _HT:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        _HT[(h, w, step)] = ((xx % step) - step / 2) ** 2 + ((yy % step) - step / 2) ** 2
    d2 = _HT[(h, w, step)]
    r = (1 - g) * step * 0.55
    return ((d2 < r * r) & (g < 0.6)).astype(np.float32)


def anime(img):
    h, w = img.shape[:2]
    s = cv2.edgePreservingFilter(_half(img), flags=1, sigma_s=50, sigma_r=0.35)
    hsv = cv2.cvtColor(s, cv2.COLOR_RGB2HSV).astype(np.float32)
    v = hsv[..., 2] / 255.0
    v = np.where(v < 0.33, 0.30, np.where(v < 0.68, 0.64, 0.94))
    hsv[..., 2] = v * 255
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.45 + 12, 0, 255)
    s = cv2.bilateralFilter(cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB), 7, 30, 5)
    s = _up(s, w, h)
    g = cv2.cvtColor(_half(img), cv2.COLOR_RGB2GRAY)
    lines = cv2.Canny(cv2.GaussianBlur(g, (5, 5), 0), 45, 115)
    lines = _up(cv2.dilate(lines, np.ones((2, 2), np.uint8)), w, h) > 80
    s[lines] = (s[lines] * 0.3).astype(np.uint8)
    return s


def sketch(img):
    h, w = img.shape[:2]
    g, _ = cv2.pencilSketch(_half(img), sigma_s=50, sigma_r=0.07, shade_factor=0.045)
    g = _up(g, w, h).astype(np.float32)[..., None] / 255
    return np.clip(PAPER * (0.08 + 0.92 * g), 0, 255).astype(np.uint8)


def color_pencil(img):
    h, w = img.shape[:2]
    g, col = cv2.pencilSketch(_half(img), sigma_s=50, sigma_r=0.08, shade_factor=0.05)
    soft = cv2.GaussianBlur(_half(img), (0, 0), 4).astype(np.float32)
    tint = PAPER * 0.55 + soft * 0.45
    out = tint * (g.astype(np.float32)[..., None] / 255) ** 1.3
    return _up(np.clip(out, 0, 255).astype(np.uint8), w, h)


_PAPER_TEX = {}


def _paper(h, w):
    if (h, w) not in _PAPER_TEX:
        rng = np.random.default_rng(3)
        n = cv2.GaussianBlur(rng.standard_normal((h // 2, w // 2)).astype(np.float32), (0, 0), 1.5)
        n += cv2.GaussianBlur(rng.standard_normal((h // 2, w // 2)).astype(np.float32), (0, 0), 6) * 2.5
        _PAPER_TEX[(h, w)] = _up(n, w, h)[..., None] * 5
    return _PAPER_TEX[(h, w)]


def watercolor(img):
    h, w = img.shape[:2]
    s = _half(img)
    s = cv2.bilateralFilter(cv2.bilateralFilter(s, 9, 50, 9), 9, 50, 9)
    s = _posterize_lab(s, 9, 10)
    # soft colour bleeding + darker pigment at the edges of each wash
    blur = cv2.GaussianBlur(s, (0, 0), 3)
    edge = cv2.Laplacian(cv2.cvtColor(s, cv2.COLOR_RGB2GRAY), cv2.CV_32F, ksize=3)
    out = blur.astype(np.float32) * 0.65 + s.astype(np.float32) * 0.35 - np.abs(edge)[..., None] * 0.35
    out = _up(np.clip(out, 0, 255).astype(np.uint8), w, h).astype(np.float32)
    out = out * 0.82 + PAPER * 0.18 + _paper(h, w)
    return _sat(np.clip(out, 0, 255).astype(np.uint8), 1.15)


def _kuwahara(img, r=5):
    f = img.astype(np.float32)
    g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32)
    k = (r + 1, r + 1)
    mean = cv2.blur(f, k, borderType=cv2.BORDER_REFLECT)
    gm = cv2.blur(g, k, borderType=cv2.BORDER_REFLECT)
    var = cv2.blur(g * g, k, borderType=cv2.BORDER_REFLECT) - gm * gm
    h, w = g.shape
    best = np.full((h, w), np.inf, np.float32)
    out = np.zeros_like(f)
    for dy, dx in ((-r // 2, -r // 2), (-r // 2, r // 2), (r // 2, -r // 2), (r // 2, r // 2)):
        M = np.float32([[1, 0, dx], [0, 1, dy]])
        v = cv2.warpAffine(var, M, (w, h), borderMode=cv2.BORDER_REFLECT)
        m = cv2.warpAffine(mean, M, (w, h), borderMode=cv2.BORDER_REFLECT)
        sel = v < best
        best[sel] = v[sel]; out[sel] = m[sel]
    return out.astype(np.uint8)


def oil(img):
    h, w = img.shape[:2]
    s = _kuwahara(_kuwahara(_half(img), 6), 4)
    s = _up(s, w, h).astype(np.float32)
    g = cv2.cvtColor(s.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    emb = cv2.filter2D(g, -1, np.array([[-1, -1, 0], [-1, 0, 1], [0, 1, 1]], np.float32)) * 0.35
    return _sat(np.clip(s + emb[..., None] + _paper(h, w) * 0.6, 0, 255).astype(np.uint8), 1.3)


# fixed 24-colour palette (bright, game-like) so pixel art never flickers
_PIX_PAL = np.array([
    [20, 12, 28], [68, 36, 52], [48, 52, 109], [78, 74, 78], [133, 76, 48], [52, 101, 36], [208, 70, 72], [117, 113, 97],
    [89, 125, 206], [210, 125, 44], [133, 149, 161], [109, 170, 44], [210, 170, 153], [109, 194, 202], [218, 212, 94],
    [222, 238, 214], [255, 255, 255], [0, 0, 0], [170, 52, 70], [38, 92, 66], [34, 32, 52], [244, 180, 27],
    [190, 120, 90], [160, 90, 60], [236, 236, 236], [200, 200, 204], [160, 160, 166], [118, 118, 124], [70, 70, 76],
    [40, 60, 150], [30, 40, 100], [240, 215, 190]], np.float32)


def pixel(img, cols=96):
    h, w = img.shape[:2]
    rows = int(round(cols * h / w))
    s = cv2.resize(cv2.bilateralFilter(_half(img), 7, 40, 7), (cols, rows), interpolation=cv2.INTER_AREA)
    s = _sat(s, 1.25).astype(np.float32)
    d = ((s.reshape(-1, 1, 3) - _PIX_PAL[None]) ** 2).sum(-1)
    s = _PIX_PAL[d.argmin(1)].reshape(rows, cols, 3).astype(np.uint8)
    return cv2.resize(s, (w, h), interpolation=cv2.INTER_NEAREST)


_NEON_COL = {}


def neon(img):
    h, w = img.shape[:2]
    small = _half(img)
    g = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    e = cv2.Canny(cv2.GaussianBlur(g, (5, 5), 0), 30, 90)
    e = cv2.dilate(e, np.ones((2, 2), np.uint8)).astype(np.float32) / 255
    if (h, w) not in _NEON_COL:
        yy = np.linspace(0, 1, h // 2, dtype=np.float32)[:, None]
        ones = np.ones((1, w // 2), np.float32)
        _NEON_COL[(h, w)] = np.dstack([(150 + 105 * np.sin(6.28 * yy)) * ones, 40 * np.ones((h // 2, w // 2), np.float32), (150 + 105 * np.cos(6.28 * yy)) * ones])
    col = _NEON_COL[(h, w)]
    glow = cv2.GaussianBlur(e, (0, 0), 4)[..., None] * col * 1.7 + e[..., None] * (col * 0.6 + 120)
    dark = small.astype(np.float32) * 0.25
    dark[..., 2] *= 1.3
    return _up(np.clip(dark + glow, 0, 255).astype(np.uint8), w, h)


FILTERS = {"cartoon": cartoon, "comic": comic, "anime": anime, "sketch": sketch, "color_pencil": color_pencil,
           "watercolor": watercolor, "oil": oil, "pixel": pixel, "neon": neon}


def apply(img, style):
    """Restyle one RGB frame. `natural` returns the input."""
    if not style or style == "natural":
        return img
    if style in FILTERS:
        return FILTERS[style](img)
    return _grade(img, style)


def apply_scoped(img, mask, style, scope):
    """scope: whole | background | subject. mask = person matte (H,W,1) float 0..1."""
    if not style or style == "natural":
        return img
    if scope == "whole" or mask is None:
        return apply(img, style)
    styled = apply(img, style).astype(np.float32)
    f = img.astype(np.float32)
    m = mask if scope == "subject" else 1 - mask
    return np.clip(styled * m + f * (1 - m), 0, 255).astype(np.uint8)


# ------------------------------------------------------------------ skins for graphics + captions
SKINS = ("clean", "retro", "mono", "cartoon", "comic", "sketch", "paint", "pixel", "neon")


def _bbox(a, pad):
    ys, xs = np.nonzero(a[::4, ::4])
    if not len(ys):
        return None
    h, w = a.shape
    return (max(0, ys.min() * 4 - pad), min(h, ys.max() * 4 + 4 + pad), max(0, xs.min() * 4 - pad), min(w, xs.max() * 4 + 4 + pad))


def skin(layer, name, i=0):
    """Restyle an RGBA overlay (graphics and captions) so it matches the look. Returns a new RGBA array."""
    if name in (None, "", "clean"):
        return layer
    bb = _bbox(layer[..., 3], 24)
    if bb is None:
        return layer
    y0, y1, x0, x1 = bb
    out = layer.copy()
    roi = layer[y0:y1, x0:x1]
    out[y0:y1, x0:x1] = _skin_roi(roi, name, i)
    return out


def _skin_roi(roi, name, i):
    rgb = roi[..., :3].astype(np.float32)
    a = roi[..., 3].astype(np.float32) / 255
    if name in ("cartoon", "comic"):
        # thick ink outline around every shape, brighter colours
        thick = cv2.dilate((a > 0.35).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))).astype(np.float32)
        thick = cv2.GaussianBlur(thick, (0, 0), 1.0)
        col = _sat(np.clip(rgb, 0, 255).astype(np.uint8), 1.35).astype(np.float32)
        if name == "comic":
            g = cv2.cvtColor(col.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
            col *= 1 - 0.35 * _halftone(*g.shape, 8, g)[..., None]
        ink = np.array([18, 14, 22], np.float32)
        rgb = col * a[..., None] + ink * (1 - a[..., None])
        a = np.maximum(a, thick)
    elif name == "sketch":
        g = cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
        ink = np.array([45, 42, 48], np.float32)
        rgb = PAPER * g[..., None] + ink * (1 - g[..., None])
        edge = cv2.morphologyEx((a > 0.4).astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)).astype(np.float32)
        rgb = rgb * (1 - edge[..., None]) + ink * edge[..., None]
        # hand-drawn "boil": the drawing wobbles a little, changing every 3 frames
        rng = np.random.default_rng(i // 3)
        dx, dy = rng.integers(-2, 3, 2)
        M = np.float32([[1, 0, dx], [0, 1, dy]])
        rgb = cv2.warpAffine(rgb, M, (rgb.shape[1], rgb.shape[0]), borderMode=cv2.BORDER_REPLICATE)
        a = cv2.warpAffine(a, M, (a.shape[1], a.shape[0]))
    elif name == "paint":
        rgb = cv2.GaussianBlur(rgb, (0, 0), 1.2)
        rgb = rgb * 0.88 + PAPER * 0.12
        h, w = a.shape
        rng = np.random.default_rng(5)
        tex = cv2.GaussianBlur(rng.random((h, w)).astype(np.float32), (0, 0), 2)
        a = cv2.GaussianBlur(a, (0, 0), 1.0) * (0.85 + 0.15 * tex)
    elif name == "pixel":
        h, w = a.shape
        f = 5
        sw, sh = max(1, w // f), max(1, h // f)
        rgb = cv2.resize(cv2.resize(rgb, (sw, sh), interpolation=cv2.INTER_AREA), (w, h), interpolation=cv2.INTER_NEAREST)
        a = cv2.resize(cv2.resize(a, (sw, sh), interpolation=cv2.INTER_AREA), (w, h), interpolation=cv2.INTER_NEAREST)
        a = (a > 0.45).astype(np.float32)
    elif name == "neon":
        glow_a = cv2.GaussianBlur(a, (0, 0), 9)
        bright = _sat(np.clip(rgb, 0, 255).astype(np.uint8), 1.6).astype(np.float32)
        glow_col = cv2.GaussianBlur(bright * a[..., None], (0, 0), 9) / np.maximum(glow_a[..., None], 1e-3)
        pulse = 0.85 + 0.15 * math.sin(i * 0.4)
        ga = np.clip(glow_a * 1.6 * pulse, 0, 1)
        rgb = (bright * a[..., None] + glow_col * ga[..., None] * (1 - a[..., None])) / np.maximum((a + ga * (1 - a))[..., None], 1e-3)
        a = np.clip(a + ga * (1 - a), 0, 1)
    elif name == "retro":
        sep = np.array([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]], np.float32)
        rgb = 0.5 * rgb + 0.5 * np.clip(rgb @ sep.T, 0, 255)
        rgb = cv2.GaussianBlur(rgb, (0, 0), 0.8)
    elif name == "mono":
        g = cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
        rgb = np.repeat(g[..., None], 3, axis=2)
    out = np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)]).astype(np.uint8)
    return out


def over(frame, layer):
    """Composite an RGBA layer over an RGB frame, in place."""
    bb = _bbox(layer[..., 3], 2)
    if bb is None:
        return frame
    y0, y1, x0, x1 = bb
    a = layer[y0:y1, x0:x1, 3:4].astype(np.float32) / 255
    roi = frame[y0:y1, x0:x1].astype(np.float32)
    frame[y0:y1, x0:x1] = (roi * (1 - a) + layer[y0:y1, x0:x1, :3].astype(np.float32) * a).astype(np.uint8)
    return frame


# ------------------------------------------------------------------ textures over the whole video
class Texture:
    KINDS = ("grain", "vhs", "light_leak", "bars", "dust", "vignette")

    def __init__(self, kinds, w, h, fps=30):
        self.k = [k for k in kinds if k in self.KINDS]
        self.w, self.h, self.fps = w, h, fps
        rng = np.random.default_rng(9)
        if "grain" in self.k:
            self.grain = [cv2.resize((rng.standard_normal((h // 2, w // 2)) * 9).astype(np.float32), (w, h))[..., None] for _ in range(8)]
        if "vhs" in self.k:
            sl = np.ones((h, 1, 1), np.float32); sl[::4] = 0.82; sl[1::4] = 0.92
            self.scan = sl
        if "vignette" in self.k:
            self.vig = _vignette(h, w, 0.75)

    def apply(self, frame, t, i):
        if not self.k:
            return frame
        f = frame.astype(np.float32)
        h, w = self.h, self.w
        if "vhs" in self.k:
            out = f.copy()
            out[..., 0] = np.roll(f[..., 0], 5, axis=1); out[..., 2] = np.roll(f[..., 2], -5, axis=1)
            f = out * self.scan
            y = int((t * 260) % (h + 200)) - 100
            if 0 <= y < h - 30:
                f[y:y + 30] = np.roll(f[y:y + 30], 18, axis=1) * 0.9 + 25
            l = f.mean(-1, keepdims=True); f = l + (f - l) * 0.8
        if "light_leak" in self.k:
            yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
            xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
            cx = 0.5 + 0.6 * math.sin(t * 0.7); cy = 0.3 + 0.4 * math.sin(t * 0.43 + 1)
            r = np.exp(-(((xx - cx) * 1.4) ** 2 + ((yy - cy) * 0.9) ** 2) * 3.5)
            amt = 0.3 + 0.2 * math.sin(t * 1.3)
            leak = r[..., None] * np.array([1.0, 0.55, 0.24], np.float32) * amt
            f = 255 * (1 - (1 - np.clip(f, 0, 255) / 255) * (1 - leak))   # screen blend
        if "dust" in self.k:
            rng = np.random.default_rng(i)
            for _ in range(int(rng.integers(3, 9))):
                x, y = int(rng.random() * w), int(rng.random() * h)
                cv2.circle(f, (x, y), int(rng.integers(1, 4)), (235, 235, 230), -1, lineType=cv2.LINE_AA)
            if rng.random() < 0.25:
                x = int(rng.random() * w)
                cv2.line(f, (x, 0), (x + int(rng.integers(-30, 30)), h), (220, 220, 215), 1, lineType=cv2.LINE_AA)
        if "grain" in self.k:
            f += self.grain[i % len(self.grain)]
        if "vignette" in self.k:
            f *= self.vig
        if "bars" in self.k:
            bh = int(h * 0.075)
            f[:bh] = 0; f[h - bh:] = 0
        return np.clip(f, 0, 255).astype(np.uint8)
