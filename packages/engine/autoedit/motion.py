"""Motion-graphics library. Every element is driven by (local_time, duration) so the director (Claude)
can place it on the timeline from the edit plan. Elements are drawn into screen space (1080x1920)."""
import math, os
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from .config import asset

OW, OH = 1080, 1920
MAX_TEXT_W = 960  # safe width for any text block (layout rule)
ACCENT = (255, 210, 31)
PURPLE = (108, 76, 255)
RED = (232, 52, 52)
GREEN = (38, 190, 110)
WHITE = (255, 255, 255)
INK = (18, 18, 22)
FA_DIGITS = str.maketrans("0123456789%", "۰۱۲۳۴۵۶۷۸۹٪")
_fonts = {}


def FONT(weight, size):
    k = (weight, size)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype(asset("fonts", f"Vazirmatn-{weight}.ttf"), size,
                                       layout_engine=ImageFont.Layout.RAQM)
    return _fonts[k]


def color(c):
    if isinstance(c, (list, tuple)): return tuple(c)
    return {"accent": ACCENT, "white": WHITE, "red": RED, "green": GREEN, "purple": PURPLE, "ink": INK}[c]


# ------------------------------------------------------------------ easing
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def smooth(x): x = clamp(x); return x * x * (3 - 2 * x)
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_in(x): x = clamp(x); return x ** 3


def back_out(x, s=1.9):
    x = clamp(x); c3 = s + 1
    return 1 + c3 * (x - 1) ** 3 + s * (x - 1) ** 2


def fade(tl, dur, fin=0.15, fout=0.15):
    return smooth(tl / fin if fin else 1) * smooth((dur - tl) / fout if fout else 1)


# ------------------------------------------------------------------ raster helpers
def blit(dst, rgba, cx, cy, alpha=1.0, scale=1.0, angle=0.0):
    if alpha <= 0.003 or scale <= 0.01:
        return
    if scale != 1.0 or angle:
        h, w = rgba.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, scale)
        cos, sin = abs(M[0, 0]), abs(M[0, 1])
        nw, nh = int(h * sin + w * cos) + 2, int(h * cos + w * sin) + 2
        M[0, 2] += nw / 2 - w / 2
        M[1, 2] += nh / 2 - h / 2
        rgba = cv2.warpAffine(rgba, M, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    h, w = rgba.shape[:2]
    H, W = dst.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if xa >= xb or ya >= yb:
        return
    src = rgba[ya - y0:yb - y0, xa - x0:xb - x0].astype(np.float32)
    a = src[..., 3:4] / 255.0 * alpha
    roi = dst[ya:yb, xa:xb].astype(np.float32)
    dst[ya:yb, xa:xb] = (roi * (1 - a) + src[..., :3] * a).astype(np.uint8)


def with_shadow(im, blur=10, offset=(0, 8), strength=0.5):
    """Add a soft drop shadow under an RGBA PIL image (canvas grows)."""
    pad = blur * 2 + max(abs(offset[0]), abs(offset[1]))
    W, H = im.size[0] + 2 * pad, im.size[1] + 2 * pad
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    a = im.split()[3].point(lambda v: int(v * strength))
    blk = Image.new("RGBA", im.size, (0, 0, 0, 255)); blk.putalpha(a)
    sh.paste(blk, (pad + offset[0], pad + offset[1]), blk)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    sh.alpha_composite(im, (pad, pad))
    return sh


def text_rgba(text, font, fill, stroke=0, stroke_fill=(0, 0, 0, 255), shadow=True):
    tmp = ImageDraw.Draw(Image.new("RGBA", (4, 4)))
    l, t, r, b = tmp.textbbox((0, 0), text, font=font, anchor="lt", direction="rtl", stroke_width=stroke)
    pad = 6
    im = Image.new("RGBA", (r - l + 2 * pad, b - t + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((pad - l, pad - t), text, font=font, fill=fill, anchor="lt", direction="rtl",
                            stroke_width=stroke, stroke_fill=stroke_fill)
    if shadow:
        im = with_shadow(im, blur=8, offset=(0, 6), strength=0.55)
    return im


def check_mark(d, cx, cy, s, fill, width):
    d.line([(cx - s * 0.45, cy), (cx - s * 0.12, cy + s * 0.32), (cx + s * 0.48, cy - s * 0.36)],
           fill=fill, width=width, joint="curve")


def pill_rgba(text, bg, fg=WHITE, size=54, pad_x=48, h=None, icon=None):
    f = FONT("ExtraBold", size)
    w = f.getlength(text, direction="rtl")
    while w + 2 * pad_x + (size * 1.5 if icon else 0) > MAX_TEXT_W + 40 and size > 28:  # auto-fit
        size -= 2
        f = FONT("ExtraBold", size)
        w = f.getlength(text, direction="rtl")
    H = h or int(size * 2.0)
    icon_w = H * 0.75 if icon else 0
    W = int(w + 2 * pad_x + icon_w)
    S = 2
    im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, W * S - 1, H * S - 1], radius=H * S // 2, fill=tuple(bg) + (245,))
    tx = (W - pad_x) * S
    if icon == "check":
        cx, cy = (W - pad_x * 0.5 - icon_w * 0.5) * S, H * S / 2
        check_mark(d, cx, cy, H * 0.42 * S, fg + (255,), int(H * 0.09 * S))
        tx = (W - pad_x * 0.6 - icon_w) * S
    if icon == "dot":
        cx, cy, r = (W - pad_x * 0.5 - icon_w * 0.5) * S, H * S / 2, H * 0.17 * S
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fg + (255,))
        tx = (W - pad_x * 0.6 - icon_w) * S
    d.text((tx, H * S / 2 + 2 * S), text, font=FONT("ExtraBold", size * S), fill=fg + (255,), anchor="rm",
           direction="rtl")
    im = im.resize((W, H), Image.LANCZOS)
    return np.array(with_shadow(im, blur=10, offset=(0, 8), strength=0.45))


# ------------------------------------------------------------------ elements
class Element:
    raw_look = False

    def __init__(self, **p): self.p = p
    def draw(self, frame, tl, dur, ctx): pass


class KineticText(Element):
    """Big words that slam in one by one (RTL reading order)."""

    def __init__(self, **p):
        super().__init__(**p)
        self.words = []  # (img, cx, cy, delay)
        y = p.get("y", 300)
        stagger = p.get("stagger", 0.08)
        k = 0
        for line in p["lines"]:
            size = line.get("size", 96)
            f = FONT(line.get("weight", "Black"), size)
            ws = line["text"].split(" ")
            while (sum(f.getlength(w, direction="rtl") for w in ws) + size * 0.28 * (len(ws) - 1) > MAX_TEXT_W
                   and size > 40):  # auto-fit
                size -= 4
                f = FONT(line.get("weight", "Black"), size)
            imgs = [np.array(text_rgba(w, f, color(line.get("color", "white")) + (255,), stroke=int(size * 0.09)))
                    for w in ws]
            gap = size * 0.28
            widths = [f.getlength(w, direction="rtl") for w in ws]
            total = sum(widths) + gap * (len(ws) - 1)
            xr = OW / 2 + total / 2
            for img, ww in zip(imgs, widths):
                self.words.append((img, xr - ww / 2, y, k * stagger))
                xr -= ww + gap
                k += 1
            y += size * 1.22
        self.band = p.get("band", True)

    def draw(self, frame, tl, dur, ctx):
        out = smooth((dur - tl) / 0.18)
        if self.band and self.words:
            ys = [w[2] for w in self.words]
            y1 = min(OH, int(max(ys) + 260))
            a = 0.62 * smooth(tl / 0.2) * out
            prof = (1 - np.linspace(0, 1, y1, dtype=np.float32)) ** 1.3 * a
            frame[:y1] = (frame[:y1].astype(np.float32) * (1 - prof[:, None, None])).astype(np.uint8)
        for img, cx, cy, dl in self.words:
            x = (tl - dl) / 0.16
            if x <= 0: continue
            sc = 1.9 - 0.9 * ease_out(x) + 0.06 * math.sin(clamp(x) * math.pi)
            blit(frame, img, cx, cy, alpha=smooth(x * 1.6) * out, scale=sc * (1 + 0.04 * (1 - out)))


class SpeechBubble(Element):
    def __init__(self, **p):
        super().__init__(**p)
        f = FONT("Black", p.get("size", 70))
        tw = f.getlength(p["text"], direction="rtl")
        W, H, S = int(tw + 110), 150, 2
        im = Image.new("RGBA", ((W + 20) * S, (H + 70) * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([10 * S, 10 * S, (W + 10) * S, (H + 10) * S], radius=60 * S, fill=(255, 255, 255, 255))
        tail = p.get("tail", "left")
        bx = 60 if tail == "left" else W - 40
        d.polygon([((bx) * S, (H) * S), ((bx + 50) * S, (H) * S), ((bx - 15 if tail == "left" else bx + 75) * S, (H + 60) * S)],
                  fill=(255, 255, 255, 255))
        d.text(((W / 2 + 10) * S, (H / 2 + 14) * S), p["text"], font=FONT("Black", p.get("size", 70) * S),
               fill=INK + (255,), anchor="mm", direction="rtl")
        im = im.resize((W + 20, H + 70), Image.LANCZOS)
        self.img = np.array(with_shadow(im, 12, (0, 10), 0.4))

    def draw(self, frame, tl, dur, ctx):
        sc = back_out(tl / 0.28) if tl < 0.28 else 1 + 0.015 * math.sin(tl * 6)
        blit(frame, self.img, self.p["x"], self.p["y"] - 6 * math.sin(tl * 4), alpha=fade(tl, dur, 0.08, 0.15),
             scale=max(0.01, sc), angle=self.p.get("angle", 4))


class Stamp(Element):
    def __init__(self, **p):
        super().__init__(**p)
        S = 2
        f1 = FONT("Black", 104 * S); f2 = FONT("ExtraBold", 40 * S)
        w = max(f1.getlength(p["text"], direction="rtl"), f2.getlength(p.get("sub", ""), direction="rtl"))
        W, H = int(w + 120 * S), int(250 * S)
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        col = RED + (255,)
        d.rounded_rectangle([6 * S, 6 * S, W - 6 * S, H - 6 * S], radius=28 * S, outline=col, width=12 * S)
        d.rounded_rectangle([24 * S, 24 * S, W - 24 * S, H - 24 * S], radius=18 * S, outline=col, width=4 * S)
        d.text((W / 2, H * 0.42), p["text"], font=f1, fill=col, anchor="mm", direction="rtl")
        if p.get("sub"):
            d.text((W / 2, H * 0.76), p["sub"], font=f2, fill=col, anchor="mm", direction="rtl")
        arr = np.array(im)
        rng = np.random.default_rng(11)
        speck = cv2.GaussianBlur((rng.random(arr.shape[:2]) > 0.82).astype(np.float32), (0, 0), 1.6)
        arr[..., 3] = (arr[..., 3] * (1 - np.clip(speck * 1.8, 0, 0.85))).astype(np.uint8)
        arr = cv2.resize(arr, (W // S, H // S), interpolation=cv2.INTER_AREA)
        self.img = arr

    def draw(self, frame, tl, dur, ctx):
        x = tl / 0.12
        sc = 2.4 - 1.4 * ease_in(x) if x < 1 else 1.0 + 0.03 * math.exp(-(tl - 0.12) * 10) * math.sin((tl - 0.12) * 40)
        blit(frame, self.img, self.p["x"], self.p["y"], alpha=smooth(x * 1.5) * smooth((dur - tl) / 0.15) * 0.95,
             scale=sc, angle=self.p.get("angle", 10))


class AppCard(Element):
    def __init__(self, **p):
        super().__init__(**p)
        S = 2
        W, rows = 880, p["rows"]
        H = 210 + 92 * len(rows)
        self.W, self.H = W, H
        base = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(base)
        d.rounded_rectangle([0, 0, W * S - 1, H * S - 1], radius=44 * S, fill=(22, 22, 30, 238))
        # app icon (right side, RTL)
        ix0 = (W - 40 - 110) * S
        d.rounded_rectangle([ix0, 40 * S, ix0 + 110 * S, 150 * S], radius=28 * S, fill=PURPLE + (255,))
        cx, cy = ix0 + 57 * S, 95 * S
        d.polygon([(cx - 18 * S, cy - 26 * S), (cx - 18 * S, cy + 26 * S), (cx + 26 * S, cy)], fill=(255, 255, 255, 255))
        d.text(((W - 175) * S, 76 * S), p["title"], font=FONT("Black", 50 * S), fill=(255, 255, 255, 255), anchor="rm", direction="rtl")
        d.text(((W - 175) * S, 128 * S), p.get("subtitle", ""), font=FONT("Medium", 32 * S), fill=(170, 170, 190, 255), anchor="rm", direction="rtl")
        d.line([(40 * S, 182 * S), ((W - 40) * S, 182 * S)], fill=(255, 255, 255, 40), width=2 * S)
        self.base = np.array(base.resize((W, H), Image.LANCZOS))
        self.row_off, self.row_on = [], []
        for i, r in enumerate(rows):
            for on in (False, True):
                im = Image.new("RGBA", (W * S, 92 * S), (0, 0, 0, 0))
                d = ImageDraw.Draw(im)
                cx, cy, rad = (W - 80) * S, 46 * S, 26 * S
                if on:
                    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=GREEN + (255,))
                    check_mark(d, cx, cy, rad * 1.2, (255, 255, 255, 255), 6 * S)
                else:
                    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=(120, 120, 140, 255), width=4 * S)
                d.text(((W - 130) * S, cy + 2 * S), r, font=FONT("Bold", 42 * S),
                       fill=(255, 255, 255, 255) if on else (140, 140, 160, 255), anchor="rm", direction="rtl")
                arr = np.array(im.resize((W, 92), Image.LANCZOS))
                (self.row_on if on else self.row_off).append(arr)
        self.img = np.array(with_shadow(Image.fromarray(self.base), 16, (0, 12), 0.5))

    def draw(self, frame, tl, dur, ctx):
        y_t = self.p["y"]
        y = -self.H + (y_t + self.H) * back_out(tl / 0.38, 1.4)
        a = smooth((dur - tl) / 0.2)
        card = self.img.copy()
        pad = (card.shape[1] - self.W) // 2
        for i, rt in enumerate(self.p["row_times"]):
            on = tl >= rt
            row = self.row_on[i] if on else self.row_off[i]
            ry = pad + 200 + i * 92
            sub = card[ry:ry + 92, pad:pad + self.W]
            al = row[..., 3:4].astype(np.float32) / 255
            sub[..., :3] = (sub[..., :3] * (1 - al) + row[..., :3] * al).astype(np.uint8)
            sub[..., 3] = np.maximum(sub[..., 3], row[..., 3])
        blit(frame, card, OW / 2, y + self.H / 2, alpha=a, scale=1.0 - 0.05 * (1 - a))


class RingCounter(Element):
    def draw(self, frame, tl, dur, ctx):
        S, R = 2, self.p.get("r", 150)
        v = ease_out(tl / self.p.get("fill", 0.7))
        size = int(R * 2 + 60)
        im = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        c = size * S / 2
        d.ellipse([c - R * S, c - R * S, c + R * S, c + R * S], fill=(15, 15, 22, 215))
        d.arc([c - (R - 14) * S, c - (R - 14) * S, c + (R - 14) * S, c + (R - 14) * S], 0, 360, fill=(255, 255, 255, 60), width=22 * S)
        if v > 0.002:
            d.arc([c - (R - 14) * S, c - (R - 14) * S, c + (R - 14) * S, c + (R - 14) * S], -90, -90 + 360 * v,
                  fill=ACCENT + (255,), width=22 * S)
        num = f"{int(round(v * 100))}%".translate(FA_DIGITS)
        d.text((c, c - 8 * S), num, font=FONT("Black", 96 * S), fill=(255, 255, 255, 255), anchor="mm", direction="rtl")
        if self.p.get("label"):
            d.text((c, c + 62 * S), self.p["label"], font=FONT("Bold", 34 * S), fill=ACCENT + (255,), anchor="mm", direction="rtl")
        arr = np.array(im.resize((size, size), Image.LANCZOS))
        sc = back_out(tl / 0.25) if tl < 0.25 else 1.0 + (0.08 * math.exp(-(tl - 0.7) * 8) if tl > 0.7 else 0)
        blit(frame, arr, self.p["x"], self.p["y"], alpha=fade(tl, dur, 0.08, 0.15), scale=max(0.01, sc))


class Viewfinder(Element):
    raw_look = True

    def __init__(self, **p):
        super().__init__(**p)
        im = Image.new("RGBA", (OW, OH), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        m, L, w = 70, 110, 8
        for (x, y, sx, sy) in [(m, m + 60, 1, 1), (OW - m, m + 60, -1, 1), (m, OH - m - 60, 1, -1), (OW - m, OH - m - 60, -1, -1)]:
            d.line([(x, y), (x + sx * L, y)], fill=(255, 255, 255, 230), width=w)
            d.line([(x, y), (x, y + sy * L)], fill=(255, 255, 255, 230), width=w)
        cx, cy = OW / 2, OH * 0.47
        d.line([(cx - 30, cy), (cx + 30, cy)], fill=(255, 255, 255, 160), width=4)
        d.line([(cx, cy - 30), (cx, cy + 30)], fill=(255, 255, 255, 160), width=4)
        # battery
        bx, by = OW - m - 150, m + 110
        d.rounded_rectangle([bx, by, bx + 100, by + 46], radius=8, outline=(255, 255, 255, 230), width=5)
        d.rectangle([bx + 100, by + 14, bx + 110, by + 32], fill=(255, 255, 255, 230))
        d.rectangle([bx + 10, by + 10, bx + 70, by + 36], fill=(255, 255, 255, 230))
        d.text((OW / 2, m + 133), p.get("label", "فیلم خام"), font=FONT("ExtraBold", 44), fill=(255, 255, 255, 235),
               anchor="mm", direction="rtl", stroke_width=3, stroke_fill=(0, 0, 0, 160))
        self.static = np.array(im)
        self.recs = [np.array(text_rgba("REC", FONT("Black", 50), (255, 255, 255, 255), shadow=True))]

    def draw(self, frame, tl, dur, ctx):
        a = fade(tl, dur, 0.06, 0.1)
        blit(frame, self.static, OW / 2, OH / 2, alpha=a)
        if (tl % 1.0) < 0.6:
            cv2.circle(frame, (110, 202), 20, RED, -1, lineType=cv2.LINE_AA)
        blit(frame, self.recs[0], 210, 200, alpha=a)
        fr = int((ctx["src_t"] % 1) * 30)
        tc = f"00:00:{int(ctx['src_t']):02d}:{fr:02d}"
        img = np.array(text_rgba(tc, FONT("Bold", 44), (255, 255, 255, 255)))
        blit(frame, img, 260, OH - 180, alpha=a)


class NoHuman(Element):
    def draw(self, frame, tl, dur, ctx):
        S, R = 2, self.p.get("r", 120)
        size = int(R * 2 + 40)
        im = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        c = size * S / 2
        slash = ease_out((tl - self.p.get("slash_at", 0.5)) / 0.18)
        ring = RED if slash > 0 else (255, 255, 255)
        d.ellipse([c - R * S, c - R * S, c + R * S, c + R * S], fill=(18, 18, 26, 225), outline=ring + (255,), width=12 * S)
        # person icon
        d.ellipse([c - 34 * S, c - 70 * S, c + 34 * S, c - 2 * S], fill=(255, 255, 255, 255))
        d.pieslice([c - 66 * S, c + 6 * S, c + 66 * S, c + 130 * S], 180, 360, fill=(255, 255, 255, 255))
        if slash > 0:
            r2 = (R - 14) * S / math.sqrt(2)
            x0, y0 = c - r2, c - r2
            d.line([(x0, y0), (x0 + 2 * r2 * slash, y0 + 2 * r2 * slash)], fill=RED + (255,), width=18 * S)
        arr = np.array(with_shadow(im.resize((size, size), Image.LANCZOS), 10, (0, 8), 0.45))
        sc = back_out(tl / 0.3) if tl < 0.3 else 1.0 + (0.1 * math.exp(-(tl - self.p.get('slash_at', .5)) * 9) if slash > 0 else 0)
        a = fade(tl, dur, 0.08, 0.15)
        blit(frame, arr, self.p["x"], self.p["y"], alpha=a, scale=max(0.01, sc))
        if self.p.get("label") and slash > 0:
            if not hasattr(self, "_pill"):
                self._pill = pill_rgba(self.p["label"], RED, size=48)
            k = (tl - self.p.get("slash_at", .5)) / 0.25
            blit(frame, self._pill, self.p["label_x"], self.p["label_y"], alpha=smooth(k * 2) * a, scale=max(0.01, back_out(k)))


class NLETimeline(Element):
    """Mini editing-software timeline that fills itself in."""

    def draw(self, frame, tl, dur, ctx):
        W, H, S = 960, 360, 1
        prog = clamp(tl / self.p.get("work", dur * 0.85))
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([0, 0, W - 1, H - 1], radius=36, fill=(20, 20, 28, 236))
        done = prog >= 1
        if done:
            d.text((W - 40, 52), "ادیت شد", font=FONT("Black", 44), fill=GREEN + (255,), anchor="rm", direction="rtl")
            check_mark(d, W - 245, 52, 40, GREEN + (255,), 9)
        else:
            d.text((W - 40, 52), "در حال ادیت خودکار...", font=FONT("Bold", 40), fill=(255, 255, 255, 255), anchor="rm", direction="rtl")
        pct = f"{int(prog * 100)}%".translate(FA_DIGITS)
        d.text((40, 52), pct, font=FONT("Black", 46), fill=ACCENT + (255,), anchor="lm", direction="rtl")
        tracks = [("ویدیو", PURPLE, [(0.0, .22), (.24, .5), (.52, .8), (.82, 1.0)]),
                  ("متن", ACCENT, [(.05, .3), (.34, .55), (.6, .9)]),
                  ("صدا", GREEN, None)]
        x0, x1 = 40, W - 150
        for i, (name, col, clips) in enumerate(tracks):
            y = 110 + i * 78
            d.text((W - 40, y + 30), name, font=FONT("Bold", 30), fill=(190, 190, 210, 255), anchor="rm", direction="rtl")
            d.rounded_rectangle([x0, y, x1, y + 60], radius=10, fill=(255, 255, 255, 18))
            if clips:
                for j, (a, b) in enumerate(clips):
                    appear = clamp((prog * 1.15 - a) / 0.12)
                    if appear <= 0: continue
                    cx0 = x0 + (x1 - x0) * a + 3
                    cx1 = x0 + (x1 - x0) * (a + (b - a) * ease_out(appear)) - 3
                    d.rounded_rectangle([cx0, y + 4, max(cx0 + 6, cx1), y + 56], radius=9, fill=col + (255,))
            else:
                rng = np.random.default_rng(3)
                n = 70
                for k in range(n):
                    fx_ = k / n
                    if fx_ > prog: break
                    hh = 6 + 22 * abs(math.sin(k * 0.7)) * (0.5 + rng.random() * 0.5)
                    xx = x0 + (x1 - x0) * fx_
                    d.line([(xx, y + 30 - hh), (xx, y + 30 + hh)], fill=col + (255,), width=4)
        ph = x0 + (x1 - x0) * prog
        d.line([(ph, 96), (ph, H - 20)], fill=(255, 80, 80, 255), width=5)
        d.polygon([(ph - 12, 92), (ph + 12, 92), (ph, 108)], fill=(255, 80, 80, 255))
        arr = np.array(with_shadow(im, 14, (0, 10), 0.5))
        y = self.p["y"] - 40 * (1 - ease_out(tl / 0.3))
        blit(frame, arr, OW / 2, y, alpha=fade(tl, dur, 0.15, 0.2))


class Burst(Element):
    def __init__(self, **p):
        super().__init__(**p)
        S, R = 2, p.get("r", 190)
        size = int(R * 2.3)
        im = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        c = size * S / 2
        pts = []
        n = 14
        for i in range(n * 2):
            rr = (R if i % 2 == 0 else R * 0.68) * S
            a = math.pi * i / n
            pts.append((c + rr * math.cos(a), c + rr * math.sin(a)))
        d.polygon(pts, fill=ACCENT + (255,), outline=INK + (255,), width=8 * S)
        d.text((c, c + 6 * S), p["text"], font=FONT("Black", p.get("size", 84) * S), fill=INK + (255,), anchor="mm", direction="rtl")
        self.img = np.array(with_shadow(im.resize((size, size), Image.LANCZOS), 12, (0, 10), 0.45))

    def draw(self, frame, tl, dur, ctx):
        sc = back_out(tl / 0.25, 2.4) if tl < 0.25 else 1 + 0.04 * math.sin(tl * 14)
        blit(frame, self.img, self.p["x"], self.p["y"], alpha=fade(tl, dur, 0.05, 0.12), scale=max(0.01, sc),
             angle=self.p.get("angle", -8) + 3 * math.sin(tl * 5))


class WarningSign(Element):
    def __init__(self, **p):
        super().__init__(**p)
        S, A = 2, p.get("size", 220)
        im = Image.new("RGBA", (A * S, int(A * 0.92) * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        h = A * 0.88 * S
        tri = [(A * S / 2, 8 * S), (A * S - 8 * S, h), (8 * S, h)]
        d.polygon(tri, fill=INK + (255,))
        inset = 22 * S
        tri2 = [(A * S / 2, 8 * S + inset * 1.6), (A * S - 8 * S - inset * 1.4, h - inset * 0.7), (8 * S + inset * 1.4, h - inset * 0.7)]
        d.polygon(tri2, fill=ACCENT + (255,))
        d.text((A * S / 2, h * 0.66), "!", font=FONT("Black", int(A * 0.5) * S), fill=INK + (255,), anchor="mm")
        self.img = np.array(with_shadow(im.resize((A, int(A * 0.92)), Image.LANCZOS), 10, (0, 8), 0.45))
        self.pill = pill_rgba(p["label"], RED, size=44) if p.get("label") else None

    def draw(self, frame, tl, dur, ctx):
        a = fade(tl, dur, 0.05, 0.15)
        sc = back_out(tl / 0.3) if tl < 0.3 else 1 + 0.06 * ctx.get("shake", 0)
        ang = 9 * math.sin(tl * 9) * (0.4 + ctx.get("shake", 0))
        blit(frame, self.img, self.p["x"], self.p["y"], alpha=a, scale=max(0.01, sc), angle=ang)
        if self.pill is not None:
            k = (tl - 0.15) / 0.25
            blit(frame, self.pill, self.p["x"], self.p["y"] + 165, alpha=smooth(k * 2) * a, scale=max(0.01, back_out(k)))


class Pill(Element):
    def __init__(self, **p):
        super().__init__(**p)
        self.img = pill_rgba(p["text"], color(p.get("bg", "purple")), color(p.get("fg", "white")),
                             size=p.get("size", 54), icon=p.get("icon"))

    def draw(self, frame, tl, dur, ctx):
        k = tl / 0.28
        blit(frame, self.img, self.p["x"], self.p["y"], alpha=fade(tl, dur, 0.1, 0.15), scale=max(0.01, back_out(k)))


class VHSRewind(Element):
    """Tape-rewind look: chroma split, scanlines, tracking noise, rewind icon and backwards timecode."""
    raw_look = True

    def __init__(self, **p):
        super().__init__(**p)
        sl = np.ones((OH, 1, 1), np.float32)
        sl[::4] = 0.78
        self.scan = sl
        im = Image.new("RGBA", (420, 120), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        for i in range(2):
            x = 18 + i * 52
            d.polygon([(x + 50, 22), (x + 50, 98), (x, 60)], fill=(255, 255, 255, 255))
        d.text((410, 62), p.get("text", "برگشت"), font=FONT("Black", 64), fill=(255, 255, 255, 255), anchor="rm", direction="rtl")
        self.icon = np.array(with_shadow(im, 6, (0, 4), 0.6))

    def process(self, frame, tl, ctx):
        f = frame.astype(np.float32)
        l = f.mean(axis=2, keepdims=True)
        f = l + (f - l) * 0.55
        out = f.copy()
        out[..., 0] = np.roll(f[..., 0], 14, axis=1)
        out[..., 2] = np.roll(f[..., 2], -14, axis=1)
        out *= self.scan
        rng = np.random.default_rng(int(tl * 1000) + 7)
        y = int((tl * 2600) % OH)
        hh = 120
        band = out[y:y + hh]
        out[y:y + hh] = np.roll(band, int(rng.integers(-60, 60)), axis=1) * 0.7 + 255 * 0.3 * rng.random(band.shape[:2])[..., None]
        out += rng.normal(0, 10, out.shape[:2])[..., None]
        return np.clip(out, 0, 255).astype(np.uint8)

    def draw(self, frame, tl, dur, ctx):
        if (tl % 0.4) < 0.28:
            blit(frame, self.icon, 270, 220)
        fr = int((ctx["src_t"] % 1) * 30)
        tc = f"00:00:{int(ctx['src_t']):02d}:{fr:02d}"
        img = np.array(text_rgba(tc, FONT("Bold", 46), (255, 255, 255, 255)))
        blit(frame, img, 260, OH - 180)


class LiveVoice(Element):
    """'Live, right now' badge + an audio visualizer that follows the speaker's real voice level."""

    def __init__(self, **p):
        super().__init__(**p)
        self.pill = pill_rgba(p.get("text", "زنده · همین الان"), RED, size=50, icon="dot")
        self.n = p.get("bars", 23)
        rng = np.random.default_rng(4)
        self.w = 0.55 + 0.45 * rng.random(self.n)

    def draw(self, frame, tl, dur, ctx):
        a = fade(tl, dur, 0.1, 0.18)
        x, y = self.p.get("x", OW / 2), self.p.get("y", 170)
        k = tl / 0.3
        pulse = 1 + 0.035 * math.sin(tl * 2 * math.pi * 1.6)
        blit(frame, self.pill, x, y, alpha=a, scale=max(0.01, back_out(k)) * pulse)
        W, H = 620, 170
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([0, 0, W - 1, H - 1], radius=40, fill=(16, 16, 24, 210))
        lvl = ctx.get("level", lambda t: 0.3)
        mid = (self.n - 1) / 2
        bw = (W - 80) / self.n
        for i in range(self.n):
            v = lvl(ctx["src_t"] - abs(i - mid) * 0.025) * self.w[i] * (1 - 0.45 * abs(i - mid) / mid)
            h = 10 + (H - 50) * clamp(v)
            bx = 40 + i * bw + bw * 0.18
            col = ACCENT if abs(i - mid) < 3 else WHITE
            d.rounded_rectangle([bx, H / 2 - h / 2, bx + bw * 0.64, H / 2 + h / 2], radius=int(bw * 0.3), fill=col + (255,))
        arr = np.array(with_shadow(im, 12, (0, 8), 0.45))
        blit(frame, arr, x, y + 160 - 30 * (1 - ease_out(tl / 0.3)), alpha=a)


REGISTRY = {"kinetic_text": KineticText, "speech_bubble": SpeechBubble, "stamp": Stamp, "app_card": AppCard,
            "ring_counter": RingCounter, "viewfinder": Viewfinder, "no_human": NoHuman, "nle_timeline": NLETimeline,
            "burst": Burst, "warning_sign": WarningSign, "live_voice": LiveVoice, "pill": Pill, "vhs_rewind": VHSRewind}


def build(spec):
    kw = {k: v for k, v in spec.items() if k not in ("type",)}
    return REGISTRY[spec["type"]](**kw)
