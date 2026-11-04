"""More motion graphics (v0.3): lower thirds, lists, comparisons, numbers, phone notifications, chat,
search, timers, call-outs, emoji, call-to-action buttons, quotes, prices, places, freeze frames.
Same contract as motion.py: draw(frame, tl, dur, ctx) into screen space; `frame` may be RGB or an RGBA layer."""
import math, re
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter

from .motion import (Element, FONT, blit, with_shadow, text_rgba, pill_rgba, check_mark, smooth, ease_out, ease_in,
                     back_out, fade, clamp, color, OW, OH, ACCENT, PURPLE, RED, GREEN, WHITE, INK, FA_DIGITS, MAX_TEXT_W)
from .particles import emoji, Particles

BLUE = (52, 120, 246)
GREY = (232, 233, 238)
DIGITS_FA = "۰۱۲۳۴۵۶۷۸۹"


def fa(s):
    return str(s).translate(FA_DIGITS)


def to_number(s, default=80.0):
    """'۸۰٪' / '1,200' / '12k' -> (value, suffix)."""
    t = str(s or "").strip()
    for i, d in enumerate(DIGITS_FA):
        t = t.replace(d, str(i))
    t = t.replace("٬", "").replace(",", "").replace("٫", ".")
    m = re.search(r"-?\d+(\.\d+)?", t)
    if not m:
        return default, ""
    return float(m.group(0)), t[m.end():].strip()


def _fit(text, weight, size, max_w, min_size=28):
    f = FONT(weight, size)
    while f.getlength(text, direction="rtl") > max_w and size > min_size:
        size -= 2; f = FONT(weight, size)
    return f, size


def _wrap(text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if font.getlength(t, direction="rtl") > max_w and cur:
            lines.append(cur); cur = w
        else:
            cur = t
    if cur: lines.append(cur)
    return lines


def _card(W, H, fill=(255, 255, 255, 248), radius=40, S=2):
    im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([0, 0, W * S - 1, H * S - 1], radius=radius * S, fill=fill)
    return im


def _down(im, W, H, shadow=True):
    im = im.resize((W, H), Image.LANCZOS)
    return np.array(with_shadow(im, 14, (0, 10), 0.45)) if shadow else np.array(im)


# ------------------------------------------------------------------ kinetic text variants
class TypeText(Element):
    """Text typed letter by letter with a blinking cursor."""

    def __init__(self, **p):
        super().__init__(**p)
        line = p["lines"][0]
        self.text = " ".join(l["text"] for l in p["lines"])
        self.font, self.size = _fit(self.text, "Black", line.get("size", 96), MAX_TEXT_W)
        self.col = color(line.get("color", "white"))
        self._cache = {}

    def draw(self, frame, tl, dur, ctx):
        n = len(self.text)
        k = min(n, int(tl / max(0.04, min(0.09, dur * 0.5 / max(1, n)))) + 1)
        if k not in self._cache:
            self._cache[k] = np.array(text_rgba(self.text[:k], self.font, self.col + (255,), stroke=int(self.size * 0.08)))
        img = self._cache[k]
        a = smooth((dur - tl) / 0.18)
        full = self.font.getlength(self.text, direction="rtl")
        # RTL: the text grows to the left from a fixed right edge
        x_right = OW / 2 + full / 2
        blit(frame, img, x_right - img.shape[1] / 2, self.p.get("y", 300), alpha=a)
        if (tl % 0.5) < 0.3 and k < n + 1:
            cx = int(x_right - img.shape[1] + 6)
            y = int(self.p.get("y", 300))
            cv2.rectangle(frame, (cx - 4, y - int(self.size * 0.5)), (cx + 4, y + int(self.size * 0.5)),
                          ACCENT + ((255,) if frame.shape[2] == 4 else ()), -1)


# ------------------------------------------------------------------ lower third
class LowerThird(Element):
    def __init__(self, **p):
        super().__init__(**p)
        S, look = 2, p.get("look", "bar")
        name, role = p.get("name", ""), p.get("subtitle", "")
        f1, s1 = _fit(name, "Black", 64, 760)
        f2, s2 = _fit(role, "Bold", 38, 760)
        w = int(max(f1.getlength(name, direction="rtl"), f2.getlength(role, direction="rtl") if role else 0)) + 120
        H = 190 if role else 120
        self.w, self.h = w, H
        im = Image.new("RGBA", (w * S, H * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        if look == "card":
            d.rounded_rectangle([0, 0, w * S - 1, H * S - 1], radius=28 * S, fill=(255, 255, 255, 250))
            d.rounded_rectangle([w * S - 22 * S, 22 * S, w * S - 10 * S, H * S - 22 * S], radius=6 * S, fill=PURPLE + (255,))
            nc, rc = INK, (90, 90, 110)
        elif look == "minimal":
            d.line([(w * S - 6 * S, 10 * S), (w * S - 6 * S, H * S - 10 * S)], fill=ACCENT + (255,), width=10 * S)
            nc, rc = WHITE, (235, 235, 240)
        else:
            d.rectangle([0, 0, w * S, 120 * S], fill=PURPLE + (255,))
            if role: d.rectangle([0, 120 * S, int(w * 0.86) * S, H * S], fill=(20, 20, 28, 240))
            nc, rc = WHITE, ACCENT
        d.text(((w - 44) * S, 62 * S), name, font=FONT("Black", s1 * S), fill=nc + (255,), anchor="rm", direction="rtl",
               stroke_width=(3 * S if look == "minimal" else 0), stroke_fill=(0, 0, 0, 200))
        if role:
            d.text(((w - 44) * S, 156 * S), role, font=FONT("Bold", s2 * S), fill=rc + (255,), anchor="rm", direction="rtl",
                   stroke_width=(2 * S if look == "minimal" else 0), stroke_fill=(0, 0, 0, 200))
        self.img = _down(im, w, H, look != "minimal")

    def draw(self, frame, tl, dur, ctx):
        k = ease_out(tl / 0.35)
        a = smooth((dur - tl) / 0.2)
        x_end = OW - 60 - self.w / 2
        x = x_end + (1 - k) * (self.w + 120)
        blit(frame, self.img, x, self.p.get("y", 1650), alpha=a)


# ------------------------------------------------------------------ lists
class ListCard(Element):
    """checklist | steps | pros_cons. Rows appear one by one at row_times."""

    def __init__(self, **p):
        super().__init__(**p)
        S, kind = 2, p.get("kind", "checklist")
        items = [i for i in p.get("items", []) if i][:5] or ["مورد اول", "مورد دوم", "مورد سوم"]
        title = p.get("title", "")
        W = 900
        top = 130 if title else 40
        H = top + 96 * len(items) + 30
        self.W, self.H, self.items, self.kind = W, H, items, kind
        base = _card(W, H, (24, 24, 32, 240), 44)
        d = ImageDraw.Draw(base)
        if title:
            f, sz = _fit(title, "Black", 52, W - 100)
            d.text(((W - 50) * S, 72 * S), title, font=FONT("Black", sz * S), fill=WHITE + (255,), anchor="rm", direction="rtl")
            d.line([(40 * S, 122 * S), ((W - 40) * S, 122 * S)], fill=(255, 255, 255, 50), width=2 * S)
        self.base = np.array(with_shadow(base.resize((W, H), Image.LANCZOS), 16, (0, 12), 0.5))
        self.pad = (self.base.shape[1] - W) // 2
        self.top = top
        self.rows = []
        for i, it in enumerate(items):
            im = Image.new("RGBA", (W * S, 96 * S), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            cx, cy, r = (W - 84) * S, 48 * S, 30 * S
            good = not (kind == "pros_cons" and (it.startswith("-") or it.startswith("−") or i >= math.ceil(len(items) / 2)))
            txt = it.lstrip("+-− ").strip()
            if kind == "steps":
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PURPLE + (255,))
                d.text((cx, cy + 2 * S), fa(i + 1), font=FONT("Black", 36 * S), fill=WHITE + (255,), anchor="mm")
            elif kind == "pros_cons" and not good:
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED + (255,))
                q = r * 0.42
                d.line([(cx - q, cy - q), (cx + q, cy + q)], fill=WHITE + (255,), width=7 * S)
                d.line([(cx - q, cy + q), (cx + q, cy - q)], fill=WHITE + (255,), width=7 * S)
            else:
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN + (255,))
                check_mark(d, cx, cy, r * 1.2, WHITE + (255,), 6 * S)
            f, sz = _fit(txt, "Bold", 44, W - 200)
            d.text(((W - 136) * S, cy + 2 * S), txt, font=FONT("Bold", sz * S), fill=WHITE + (255,), anchor="rm", direction="rtl")
            self.rows.append(np.array(im.resize((W, 96), Image.LANCZOS)))
        n = len(items)
        self.times = p.get("row_times") or [0.45 + i * 0.5 for i in range(n)]

    def draw(self, frame, tl, dur, ctx):
        y_t = self.p.get("y", 330)
        y = -self.H + (y_t + self.H) * back_out(tl / 0.38, 1.4)
        a = smooth((dur - tl) / 0.2)
        card = self.base.copy()
        for i, rt in enumerate(self.times):
            k = (tl - rt) / 0.25
            if k <= 0: continue
            row = self.rows[i]
            ry = self.pad + self.top + i * 96
            off = int((1 - ease_out(k)) * 60)
            sub = card[ry:ry + 96, self.pad + off:self.pad + self.W]
            rr = row[:, :self.W - off]
            al = rr[..., 3:4].astype(np.float32) / 255 * smooth(k * 1.5)
            sub[..., :3] = (sub[..., :3] * (1 - al) + rr[..., :3] * al).astype(np.uint8)
        blit(frame, card, OW / 2, y + self.H / 2, alpha=a)


# ------------------------------------------------------------------ compare
class Compare(Element):
    def __init__(self, **p):
        super().__init__(**p)
        S, kind = 2, p.get("kind", "before_after")
        defaults = {"before_after": ("قبل", "بعد"), "versus": ("این", "اون"), "right_wrong": ("درست", "غلط")}[kind]
        right, left = p.get("right") or defaults[0], p.get("left") or defaults[1]
        self.kind = kind
        PW, PH = 430, 300
        self.pw, self.ph = PW, PH

        def panel(label, good, side):
            im = Image.new("RGBA", (PW * S, PH * S), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            if kind == "before_after":
                fill = (90, 90, 100, 245) if side == "right" else (108, 76, 255, 250)
            elif kind == "right_wrong":
                fill = (GREEN if good else RED) + (250,)
            else:
                fill = ((52, 120, 246) if side == "right" else (232, 52, 52)) + (250,)
            d.rounded_rectangle([0, 0, PW * S - 1, PH * S - 1], radius=36 * S, fill=fill)
            if kind == "right_wrong":
                cx, cy = PW * S / 2, 100 * S
                if good: check_mark(d, cx, cy, 90 * S, WHITE + (255,), 16 * S)
                else:
                    q = 42 * S
                    d.line([(cx - q, cy - q), (cx + q, cy + q)], fill=WHITE + (255,), width=16 * S)
                    d.line([(cx - q, cy + q), (cx + q, cy - q)], fill=WHITE + (255,), width=16 * S)
                ty = 220
            else:
                ty = PH / 2
            f, sz = _fit(label, "Black", 76, PW - 50)
            d.text((PW * S / 2, ty * S), label, font=FONT("Black", sz * S), fill=WHITE + (255,), anchor="mm", direction="rtl")
            return np.array(with_shadow(im.resize((PW, PH), Image.LANCZOS), 12, (0, 10), 0.45))

        self.right = panel(right, True, "right")
        self.left = panel(left, False, "left")
        vs = Image.new("RGBA", (150 * S, 150 * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(vs)
        d.ellipse([0, 0, 150 * S - 1, 150 * S - 1], fill=ACCENT + (255,), outline=INK + (255,), width=8 * S)
        if kind == "before_after":   # arrow pointing to the left: from «before» (right) to «after» (left)
            d.polygon([(38 * S, 75 * S), (80 * S, 40 * S), (80 * S, 62 * S), (114 * S, 62 * S), (114 * S, 88 * S), (80 * S, 88 * S), (80 * S, 110 * S)],
                      fill=INK + (255,))
        else:
            mid = "VS" if kind == "versus" else "یا"
            d.text((75 * S, 78 * S), mid, font=FONT("Black", (60 if mid == "VS" else 70) * S), fill=INK + (255,), anchor="mm", direction="rtl")
        self.vs = np.array(vs.resize((150, 150), Image.LANCZOS))

    def draw(self, frame, tl, dur, ctx):
        y = self.p.get("y", 380)
        a = smooth((dur - tl) / 0.2)
        k1, k2 = ease_out(tl / 0.35), ease_out((tl - 0.25) / 0.35)
        gap = 30
        xr = OW / 2 + gap / 2 + self.pw / 2
        xl = OW / 2 - gap / 2 - self.pw / 2
        blit(frame, self.right, xr + (1 - k1) * 600, y, alpha=a * smooth(tl / 0.15))
        if k2 > 0:
            blit(frame, self.left, xl - (1 - k2) * 600, y, alpha=a * smooth((tl - 0.25) / 0.15))
        kv = (tl - 0.55) / 0.3
        if kv > 0:
            blit(frame, self.vs, OW / 2, y, alpha=a, scale=max(0.01, back_out(kv, 2.4)), angle=-8 * (1 - smooth(kv)))


# ------------------------------------------------------------------ numbers
class CountUp(Element):
    def __init__(self, **p):
        super().__init__(**p)
        self.val, self.suffix = to_number(p.get("value"), 100)
        if "%" in str(p.get("value", "")) or "٪" in str(p.get("value", "")): self.suffix = "٪"
        self.label = p.get("label", "")
        self._lab = pill_rgba(self.label, PURPLE, size=44) if self.label else None

    def draw(self, frame, tl, dur, ctx):
        k = ease_out(tl / self.p.get("fill", 1.0))
        v = self.val * k
        s = f"{v:,.0f}" if abs(self.val) >= 10 or self.val == int(self.val) else f"{v:.1f}"
        s = fa(s.replace(",", "٬")) + self.suffix
        img = np.array(text_rgba(s, FONT("Black", 170), ACCENT + (255,), stroke=12))
        x, y = self.p.get("x", OW / 2), self.p.get("y", 380)
        a = fade(tl, dur, 0.08, 0.18)
        sc = back_out(tl / 0.25) if tl < 0.25 else 1 + (0.08 * math.exp(-(tl - 1.0) * 8) if tl > 1.0 else 0)
        blit(frame, img, x, y, alpha=a, scale=max(0.01, sc))
        if self._lab is not None:
            kk = (tl - 0.3) / 0.3
            blit(frame, self._lab, x, y + 150, alpha=a * smooth(kk * 2), scale=max(0.01, back_out(kk)))


class BarChart(Element):
    def __init__(self, **p):
        super().__init__(**p)
        v, _ = to_number(p.get("value"), 0)
        self.vals = p.get("values") or [0.32, 0.5, 0.66, 1.0]
        self.top_label = fa(p.get("value") or "")
        self.label = p.get("label", "")

    def draw(self, frame, tl, dur, ctx):
        W, H, S = 760, 520, 2
        im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([0, 0, W * S - 1, H * S - 1], radius=40 * S, fill=(20, 20, 28, 236))
        n = len(self.vals)
        bw = (W - 140) / n
        base = H - 70
        for i, v in enumerate(self.vals):
            k = ease_out((tl - 0.15 - i * 0.12) / 0.45)
            if k <= 0: continue
            h = (H - 190) * v * k
            # RTL: first bar on the right
            x1 = W - 70 - i * bw - bw * 0.15
            x0 = x1 - bw * 0.7
            col = ACCENT if i == n - 1 else (120, 110, 200)
            d.rounded_rectangle([x0 * S, (base - h) * S, x1 * S, base * S], radius=14 * S, fill=col + (255,))
            if i == n - 1 and self.top_label and k > 0.9:
                d.text(((x0 + x1) / 2 * S, (base - h - 34) * S), self.top_label, font=FONT("Black", 46 * S), fill=WHITE + (255,), anchor="mm", direction="rtl")
        d.line([(50 * S, base * S), ((W - 50) * S, base * S)], fill=(255, 255, 255, 90), width=3 * S)
        if self.label:
            d.text(((W - 50) * S, 56 * S), self.label, font=FONT("Black", 44 * S), fill=WHITE + (255,), anchor="rm", direction="rtl")
        arr = np.array(with_shadow(im.resize((W, H), Image.LANCZOS), 14, (0, 10), 0.5))
        y = self.p.get("y", 420) - 40 * (1 - ease_out(tl / 0.3))
        blit(frame, arr, OW / 2, y, alpha=fade(tl, dur, 0.12, 0.2))


class ProgressBar(Element):
    def draw(self, frame, tl, dur, ctx):
        to = to_number(self.p.get("value"), 100)[0] / 100 if self.p.get("value") else 1.0
        k = ease_out(tl / self.p.get("fill", 1.4)) * clamp(to, 0, 1)
        W, H, S = 880, 230, 2
        im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([0, 0, W * S - 1, H * S - 1], radius=36 * S, fill=(20, 20, 28, 236))
        label = self.p.get("label") or "در حال انجام..."
        d.text(((W - 44) * S, 62 * S), label, font=FONT("Bold", 40 * S), fill=WHITE + (255,), anchor="rm", direction="rtl")
        d.text((44 * S, 62 * S), fa(f"{int(k * 100)}%"), font=FONT("Black", 46 * S), fill=ACCENT + (255,), anchor="lm")
        d.rounded_rectangle([44 * S, 128 * S, (W - 44) * S, 178 * S], radius=25 * S, fill=(255, 255, 255, 30))
        if k > 0.01:
            # fills right to left (RTL)
            d.rounded_rectangle([(W - 44 - (W - 88) * k) * S, 128 * S, (W - 44) * S, 178 * S], radius=25 * S, fill=GREEN + (255,))
        arr = np.array(with_shadow(im.resize((W, H), Image.LANCZOS), 14, (0, 10), 0.5))
        blit(frame, arr, OW / 2, self.p.get("y", 380) - 40 * (1 - ease_out(tl / 0.3)), alpha=fade(tl, dur, 0.12, 0.2))


# ------------------------------------------------------------------ phone UI
NOTIF = {"message": ("speech", "پیام جدید", (52, 199, 89)), "email": ("mail", "ایمیل", (52, 120, 246)),
         "follow": ("heart", "اینستاگرام", (225, 48, 108)), "payment": ("bill", "بانک", (38, 160, 110)),
         "reminder": ("bell", "یادآوری", (255, 149, 0))}


class Notification(Element):
    def __init__(self, **p):
        super().__init__(**p)
        S = 2
        icon, app, col = NOTIF.get(p.get("kind", "message"), NOTIF["message"])
        default = {"message": "سلام! ویدیوت رو دیدم، عالی بود 😍", "email": "پیشنهاد همکاری برای پروژه‌ی جدید",
                   "follow": "۱۲۸ نفر جدید دنبالت کردن", "payment": "مبلغ ۲٬۵۰۰٬۰۰۰ تومان واریز شد",
                   "reminder": "همین الان شروع کن!"}[p.get("kind", "message")]
        text = (p.get("text") or default).replace("😍", "")
        W, H = 960, 200
        im = _card(W, H, (250, 250, 252, 246), 46)
        d = ImageDraw.Draw(im)
        ix = (W - 40 - 110) * S
        d.rounded_rectangle([ix, 45 * S, ix + 110 * S, 155 * S], radius=26 * S, fill=col + (255,))
        e = emoji(icon, 80)
        if e is not None:
            im.alpha_composite(Image.fromarray(e).resize((80 * S, 80 * S)), (ix + 15 * S, 60 * S))
        d.text(((W - 180) * S, 62 * S), app, font=FONT("Bold", 34 * S), fill=(120, 120, 130, 255), anchor="rm", direction="rtl")
        d.text((44 * S, 62 * S), "الان", font=FONT("Medium", 30 * S), fill=(150, 150, 160, 255), anchor="lm", direction="rtl")
        f, sz = _fit(text, "Bold", 42, W - 240)
        d.text(((W - 180) * S, 128 * S), text, font=FONT("Bold", sz * S), fill=INK + (255,), anchor="rm", direction="rtl")
        self.img = _down(im, W, H)
        self.h = H

    def draw(self, frame, tl, dur, ctx):
        y_t = self.p.get("y", 190)
        k = back_out(tl / 0.4, 1.3)
        out = ease_in((tl - (dur - 0.3)) / 0.3)
        y = -self.h + (y_t + self.h) * k - out * (y_t + self.h + 40)
        blit(frame, self.img, OW / 2, y)


class Chat(Element):
    def __init__(self, **p):
        super().__init__(**p)
        lines = [l for l in p.get("lines", []) if l][:4] or ["سلام! این ویدیو رو کی ادیت کرد؟", "هیچ‌کس! خودکار بود 😎", "جدی؟!"]
        S = 2
        self.bubbles = []
        for i, t in enumerate(lines):
            me = i % 2 == 1
            t = t.replace("😎", "")
            f = FONT("Bold", 44)
            rows = _wrap(t, f, 600)
            w = int(max(f.getlength(r, direction="rtl") for r in rows)) + 70
            h = 40 + 58 * len(rows)
            im = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            d.rounded_rectangle([0, 0, w * S - 1, h * S - 1], radius=34 * S, fill=(BLUE if me else GREY) + (255,))
            for j, r in enumerate(rows):
                d.text(((w - 35) * S, (20 + 29 + j * 58) * S), r, font=FONT("Bold", 44 * S),
                       fill=(WHITE if me else INK) + (255,), anchor="rm", direction="rtl")
            self.bubbles.append((np.array(with_shadow(im.resize((w, h), Image.LANCZOS), 10, (0, 6), 0.35)), me, w, h))
        self.times = [0.2 + i * 0.75 for i in range(len(self.bubbles))]

    def draw(self, frame, tl, dur, ctx):
        y = self.p.get("y", 260)
        a = smooth((dur - tl) / 0.2)
        for (img, me, w, h), t0 in zip(self.bubbles, self.times):
            k = (tl - t0) / 0.28
            if k <= 0:
                if tl > t0 - 0.5 and not me:   # typing dots before the other person's message
                    for j in range(3):
                        r = 9 + 4 * max(0, math.sin(tl * 9 - j))
                        cx = int(150 + 34 * (2 - j)); cy = int(y + 40)
                        cv2.circle(frame, (OW - cx, cy), int(r), (200, 200, 210) + ((int(255 * a),) if frame.shape[2] == 4 else ()), -1, cv2.LINE_AA)
                break
            # Persian chat: the other person on the right, me on the left
            x = (OW - 70 - w / 2) if not me else (70 + w / 2)
            blit(frame, img, x, y + h / 2, alpha=a * smooth(k * 2), scale=max(0.01, back_out(k, 1.6)))
            y += h + 26


class SearchBar(Element):
    def __init__(self, **p):
        super().__init__(**p)
        self.q = p.get("query") or "چطور ویدیو رو خودکار ادیت کنم؟"
        self._cache = {}

    def draw(self, frame, tl, dur, ctx):
        W, H, S = 940, 140, 2
        n = len(self.q)
        k = clamp(int((tl - 0.35) / 0.06), 0, n)
        if k not in self._cache:
            im = _card(W, H, (255, 255, 255, 250), 70)
            d = ImageDraw.Draw(im)
            cx, cy = (W - 70) * S, 70 * S
            d.ellipse([cx - 24 * S, cy - 24 * S, cx + 16 * S, cy + 16 * S], outline=(120, 120, 130, 255), width=7 * S)
            d.line([(cx - 18 * S, cy + 12 * S), (cx - 38 * S, cy + 32 * S)], fill=(120, 120, 130, 255), width=8 * S)
            txt = self.q[:k] if k else "جست‌وجو"
            f, sz = _fit(self.q, "Bold", 46, W - 200)
            d.text(((W - 130) * S, 72 * S), txt, font=FONT("Bold", sz * S), fill=(INK if k else (160, 160, 170)) + (255,), anchor="rm", direction="rtl")
            self._cache[k] = (_down(im, W, H), f.getlength(txt, direction="rtl") if k else 0)
        img, tw = self._cache[k]
        y = self.p.get("y", 330)
        a = fade(tl, dur, 0.15, 0.2)
        blit(frame, img, OW / 2, y - 40 * (1 - ease_out(tl / 0.3)), alpha=a)
        if k < n and (tl % 0.5) < 0.3:
            pad = (img.shape[1] - W) / 2
            cx = int(OW / 2 - img.shape[1] / 2 + pad + W - 130 - tw - 8)
            cv2.rectangle(frame, (cx - 3, int(y - 30)), (cx + 3, int(y + 30)), (52, 120, 246) + ((255,) if frame.shape[2] == 4 else ()), -1)


class Timer(Element):
    def draw(self, frame, tl, dur, ctx):
        total = float(self.p.get("seconds", 3))
        kind = self.p.get("kind", "countdown")
        el = clamp(tl - 0.2, 0, total)
        S, R = 2, 170
        size = R * 2 + 60
        im = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        c = size * S / 2
        d.ellipse([c - R * S, c - R * S, c + R * S, c + R * S], fill=(15, 15, 22, 225))
        frac = el / total
        rr = (R - 16) * S
        d.arc([c - rr, c - rr, c + rr, c + rr], 0, 360, fill=(255, 255, 255, 50), width=20 * S)
        if kind == "countdown":
            if frac < 1: d.arc([c - rr, c - rr, c + rr, c + rr], -90 + 360 * frac, 270, fill=RED + (255,), width=20 * S)
            v = math.ceil(total - el) if el < total else 0
            s = fa(v)
        else:
            d.arc([c - rr, c - rr, c + rr, c + rr], -90, -90 + 360 * (el % 1.0), fill=ACCENT + (255,), width=20 * S)
            s = fa(f"{el:04.1f}").replace(".", "٫")
        d.text((c, c + 4 * S), s, font=FONT("Black", (150 if kind == "countdown" else 96) * S), fill=WHITE + (255,), anchor="mm")
        arr = np.array(with_shadow(im.resize((size, size), Image.LANCZOS), 12, (0, 8), 0.45))
        pulse = 1 + (0.08 * math.exp(-((el % 1.0)) * 7) if kind == "countdown" else 0)
        sc = back_out(tl / 0.25) if tl < 0.25 else pulse
        blit(frame, arr, self.p.get("x", OW / 2), self.p.get("y", 400), alpha=fade(tl, dur, 0.06, 0.15), scale=max(0.01, sc))


# ------------------------------------------------------------------ call-outs around the speaker
CALL_COL = {"yellow": ACCENT, "red": RED, "white": WHITE, "cyan": (60, 220, 240)}


class Callout(Element):
    """Hand-drawn arrow / circle / scribble pointing at the speaker's head (ctx['head'] in screen space)."""

    def __init__(self, **p):
        super().__init__(**p)
        self.col = CALL_COL.get(p.get("color", "yellow"), ACCENT)
        self._lab = pill_rgba(p["label"], INK, self.col, size=44) if p.get("label") else None

    def draw(self, frame, tl, dur, ctx):
        hx, hy, hw = ctx.get("head", (OW / 2, OH * 0.33, 220))
        kind = self.p.get("kind", "arrow")
        k = ease_out(tl / 0.5)
        a = smooth((dur - tl) / 0.2)
        rng = np.random.default_rng(7)
        if kind == "arrow":
            side = 1 if hx < OW / 2 else -1   # come from the emptier side
            x0, y0 = hx + side * (hw * 1.7 + 120), hy - hw * 1.3
            x1, y1 = hx + side * hw * 0.75, hy - hw * 0.2
            cx, cy = (x0 + x1) / 2 + side * 60, (y0 + y1) / 2 - 90
            pts = [((1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1)
                   for t in np.linspace(0, 1, 40)]
            n = max(2, int(len(pts) * k))
            self._poly(frame, pts[:n], a)
            if k > 0.95:
                (ax, ay), (bx, by) = pts[-1], pts[-4]
                ang = math.atan2(ay - by, ax - bx)
                for s in (2.5, -2.5):
                    hx2, hy2 = ax - 60 * math.cos(ang + s * 0.25 * math.pi / 2.5), ay - 60 * math.sin(ang + s * 0.25 * math.pi / 2.5)
                    self._poly(frame, [(ax, ay), (hx2, hy2)], a)
            if self._lab is not None:
                kk = (tl - 0.4) / 0.3
                lx = min(max(x0, 240), OW - 240)
                blit(frame, self._lab, lx, y0 - 70, alpha=a * smooth(kk * 2), scale=max(0.01, back_out(kk)))
        else:
            rx, ry = hw * 1.25, hw * 1.55
            n = 70
            pts = []
            for i in range(int(n * k * (1.15 if kind == "circle" else 1.0))):
                t = i / n * 2 * math.pi - math.pi / 2
                wob = 1 + (0.04 * math.sin(t * 3) if kind == "circle" else 0.16 * math.sin(t * 17 + rng.random()))
                pts.append((hx + rx * wob * math.cos(t), hy + ry * wob * math.sin(t)))
            if len(pts) > 1:
                self._poly(frame, pts, a)

    def _poly(self, frame, pts, a):
        p = np.array(pts, np.int32).reshape(-1, 1, 2)
        if frame.shape[2] == 4:
            cv2.polylines(frame, [p], False, (0, 0, 0, int(140 * a)), 22, cv2.LINE_AA)
            cv2.polylines(frame, [p], False, self.col + (int(255 * a),), 13, cv2.LINE_AA)
        else:
            ov = frame.copy()
            cv2.polylines(ov, [p], False, (0, 0, 0), 22, cv2.LINE_AA)
            cv2.polylines(ov, [p], False, self.col, 13, cv2.LINE_AA)
            frame[:] = (frame.astype(np.float32) * (1 - a) + ov.astype(np.float32) * a).astype(np.uint8)


class EmojiPop(Element):
    """Big emoji that pop next to the head, one after another."""

    def __init__(self, **p):
        super().__init__(**p)
        self.names = [e for e in p.get("emojis", []) if emoji(e, 64) is not None][:4] or ["fire"]
        self.imgs = [emoji(n, 260) for n in self.names]

    def draw(self, frame, tl, dur, ctx):
        hx, hy, hw = ctx.get("head", (OW / 2, OH * 0.33, 220))
        spots = [(hx + hw * 1.9, hy - hw * 0.9), (hx - hw * 1.9, hy - hw * 1.1), (hx + hw * 1.6, hy + hw * 1.2), (hx - hw * 1.7, hy + hw * 1.0)]
        a = smooth((dur - tl) / 0.2)
        step = min(0.5, max(0.25, (dur - 0.6) / max(1, len(self.imgs))))
        for i, img in enumerate(self.imgs):
            k = (tl - i * step) / 0.3
            if k <= 0: continue
            x, y = spots[i % 4]
            x = min(max(x, 160), OW - 160); y = min(max(y, 200), OH * 0.62)
            blit(frame, img, x, y - 10 * math.sin(tl * 4 + i), alpha=a, scale=max(0.01, back_out(k, 2.2)), angle=10 * math.sin(tl * 3 + i))


class EmojiRain(Element):
    def __init__(self, **p):
        super().__init__(**p)
        names = [e for e in p.get("emojis", []) if emoji(e, 64) is not None][:4] or ["fire"]
        rng = np.random.default_rng(5)
        self.drops = [(names[i % len(names)], rng.random() * OW, rng.random() * OH, 380 + rng.random() * 300,
                       (rng.random() - 0.5) * 120, int(90 + rng.random() * 70)) for i in range(26)]

    def draw(self, frame, tl, dur, ctx):
        a = fade(tl, dur, 0.15, 0.3)
        for name, x, y, v, spin, s in self.drops:
            yy = (y + tl * v) % (OH + 240) - 120 - OH * 0.5 * (1 - min(1, tl / 0.6))
            blit(frame, emoji(name, s), x, yy, alpha=a, angle=spin * tl)


class Prohibit(Element):
    ICONS = {"phone": "phone", "money": "bill", "clock": "clock", "sugar": "candy"}

    def draw(self, frame, tl, dur, ctx):
        S, R = 2, self.p.get("r", 130)
        size = int(R * 2 + 40)
        im = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        c = size * S / 2
        slash_at = self.p.get("slash_at", 0.5)
        slash = ease_out((tl - slash_at) / 0.18)
        d.ellipse([c - R * S, c - R * S, c + R * S, c + R * S], fill=(255, 255, 255, 235), outline=RED + (255,), width=16 * S)
        icon = self.ICONS.get(self.p.get("icon", "person"))
        e = emoji(icon, int(R * 1.25)) if icon else None
        if e is not None:
            im.alpha_composite(Image.fromarray(e).resize((int(R * 1.25) * S, int(R * 1.25) * S)), (int(c - R * 0.625 * S), int(c - R * 0.625 * S)))
        else:
            d.ellipse([c - 34 * S, c - 70 * S, c + 34 * S, c - 2 * S], fill=INK + (255,))
            d.pieslice([c - 66 * S, c + 6 * S, c + 66 * S, c + 130 * S], 180, 360, fill=INK + (255,))
        if slash > 0:
            r2 = (R - 14) * S / math.sqrt(2)
            d.line([(c - r2, c - r2), (c - r2 + 2 * r2 * slash, c - r2 + 2 * r2 * slash)], fill=RED + (255,), width=18 * S)
        arr = np.array(with_shadow(im.resize((size, size), Image.LANCZOS), 10, (0, 8), 0.45))
        sc = back_out(tl / 0.3) if tl < 0.3 else 1.0 + (0.1 * math.exp(-(tl - slash_at) * 9) if slash > 0 else 0)
        a = fade(tl, dur, 0.08, 0.15)
        x, y = self.p.get("x", 840), self.p.get("y", 420)
        blit(frame, arr, x, y, alpha=a, scale=max(0.01, sc))
        if self.p.get("label") and slash > 0:
            if not hasattr(self, "_pill"): self._pill = pill_rgba(self.p["label"], RED, size=46)
            k = (tl - slash_at) / 0.25
            blit(frame, self._pill, min(max(x, 260), OW - 260), y + R + 80, alpha=smooth(k * 2) * a, scale=max(0.01, back_out(k)))


# ------------------------------------------------------------------ call to action
CTA = {"follow": ("فالو کن", "فالو شدی", PURPLE, "plus"), "like": ("لایک", "لایک شد", RED, "heart"),
       "save": ("ذخیره کن", "ذخیره شد", (20, 20, 28), "save"), "share": ("بفرست برای رفیقت", "فرستاده شد", BLUE, "send"),
       "comment": ("کامنت بذار", "منتظر نظرتم", GREEN, "speech")}


class CTAButton(Element):
    def __init__(self, **p):
        super().__init__(**p)
        a, b, col, icon = CTA.get(p.get("kind", "follow"), CTA["follow"])
        self.off = pill_rgba(a, col, size=60, icon="dot" if icon != "plus" else None)
        self.on = pill_rgba(b, GREEN if p.get("kind") != "like" else RED, size=60, icon="check")
        self.icon = emoji({"heart": "heart", "speech": "speech", "send": "plane", "save": "star", "plus": "like"}[icon], 150)

    def draw(self, frame, tl, dur, ctx):
        x, y = self.p.get("x", OW / 2), self.p.get("y", 1660)
        a = fade(tl, dur, 0.1, 0.2)
        tap = self.p.get("tap", 0.9)
        k = tl / 0.3
        on = tl >= tap
        img = self.on if on else self.off
        sc = back_out(k) if tl < 0.3 else (1 - 0.1 * math.exp(-((tl - tap) * 10) ** 2) if tl > tap - 0.15 else 1.0)
        blit(frame, img, x, y, alpha=a, scale=max(0.01, sc))
        # a finger-sized dot comes in and taps the button
        if tl < tap + 0.3:
            u = ease_out((tl - 0.3) / max(0.1, tap - 0.3))
            fx, fy = x + 260 * (1 - u) + 120, y + 260 * (1 - u) + 40
            r = 34 if tl < tap else 34 + (tl - tap) * 220
            al = 0.8 if tl < tap else 0.8 * (1 - (tl - tap) / 0.3)
            if frame.shape[2] == 4:
                cv2.circle(frame, (int(fx), int(fy)), int(r), (255, 255, 255, int(255 * al * a)), 6, cv2.LINE_AA)
                cv2.circle(frame, (int(fx), int(fy)), 22, (255, 255, 255, int(200 * al * a)), -1, cv2.LINE_AA)
            else:
                cv2.circle(frame, (int(fx), int(fy)), int(r), (255, 255, 255), 6, cv2.LINE_AA)
        if on and self.icon is not None:
            kk = (tl - tap) / 0.35
            blit(frame, self.icon, x, y - 170 - 60 * ease_out(kk), alpha=a * smooth((1.4 - kk) * 2), scale=max(0.01, back_out(kk, 2)))


# ------------------------------------------------------------------ quote / price / location
class Quote(Element):
    def __init__(self, **p):
        super().__init__(**p)
        S, W = 2, 920
        text = p.get("text") or "کاری که امروز می‌تونی انجام بدی رو به فردا نسپار."
        f = FONT("Black", 56)
        rows = _wrap(text, f, W - 140)[:4]
        H = 130 + 78 * len(rows) + (70 if p.get("author") else 20)
        im = _card(W, H, (255, 255, 255, 248), 44)
        d = ImageDraw.Draw(im)
        d.text(((W - 40) * S, 70 * S), "«", font=FONT("Black", 150 * S), fill=PURPLE + (255,), anchor="rm")
        for i, r in enumerate(rows):
            d.text(((W - 70) * S, (150 + i * 78) * S), r, font=FONT("Black", 56 * S), fill=INK + (255,), anchor="rm", direction="rtl")
        if p.get("author"):
            d.text(((W - 70) * S, (150 + len(rows) * 78 + 20) * S), "— " + p["author"], font=FONT("Bold", 40 * S),
                   fill=(110, 110, 125, 255), anchor="rm", direction="rtl")
        self.img = _down(im, W, H)

    def draw(self, frame, tl, dur, ctx):
        k = ease_out(tl / 0.4)
        blit(frame, self.img, OW / 2, self.p.get("y", 420) + 80 * (1 - k), alpha=fade(tl, dur, 0.2, 0.2))


class PriceTag(Element):
    def __init__(self, **p):
        super().__init__(**p)
        S = 2
        price, old = p.get("price") or "۴۹۰ هزار تومان", p.get("old_price", "")
        f, sz = _fit(price, "Black", 76, 640)
        W = int(f.getlength(price, direction="rtl")) + 210
        H = 220 if old else 170
        im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.polygon([(0, H * S / 2), (70 * S, 0), (W * S, 0), (W * S, H * S), (70 * S, H * S)], fill=ACCENT + (255,))
        d.ellipse([46 * S, (H / 2 - 16) * S, 78 * S, (H / 2 + 16) * S], fill=(0, 0, 0, 0))
        d.text(((W - 50) * S, (H - 70 if old else H / 2) * S), fa(price), font=FONT("Black", sz * S), fill=INK + (255,), anchor="rm", direction="rtl")
        self.old_w = 0
        if old:
            fo = FONT("Bold", 46 * S)
            d.text(((W - 50) * S, 58 * S), fa(old), font=fo, fill=(90, 70, 20, 255), anchor="rm", direction="rtl")
            self.old_w = fo.getlength(fa(old), direction="rtl") / S
        self.base = im
        self.W, self.H, self.has_old = W, H, bool(old)
        self.img = _down(im, W, H)

    def draw(self, frame, tl, dur, ctx):
        img = self.img
        if self.has_old:
            k = ease_out((tl - 0.45) / 0.25)
            if k > 0:
                im = self.base.copy(); d = ImageDraw.Draw(im); S = 2
                x1 = (self.W - 44) * 2; x0 = x1 - (self.old_w + 12) * 2 * k
                d.line([(x1, 62 * S), (x0, 50 * S)], fill=RED + (255,), width=9 * S)
                img = _down(im, self.W, self.H)
        sc = back_out(tl / 0.3, 2.0)
        blit(frame, img, self.p.get("x", OW / 2), self.p.get("y", 420), alpha=fade(tl, dur, 0.06, 0.15), scale=max(0.01, sc), angle=-6)


class LocationPin(Element):
    def __init__(self, **p):
        super().__init__(**p)
        self.pin = emoji("pin", 200)
        self.lab = pill_rgba(p.get("place") or "تهران", (20, 20, 28), size=52)

    def draw(self, frame, tl, dur, ctx):
        x, y = self.p.get("x", OW / 2), self.p.get("y", 400)
        a = fade(tl, dur, 0.05, 0.18)
        drop = 1 - ease_out(tl / 0.35)
        bounce = abs(math.sin(tl * 10)) * math.exp(-tl * 6) * 30
        r = 40 + (tl % 1.2) * 120
        al = max(0, 1 - (tl % 1.2) / 1.2) * a
        col = (255, 80, 80) + ((int(200 * al),) if frame.shape[2] == 4 else ())
        cv2.ellipse(frame, (int(x), int(y + 95)), (int(r), int(r * 0.35)), 0, 0, 360, col, 5, cv2.LINE_AA)
        if self.pin is not None:
            blit(frame, self.pin, x, y - drop * 500 - bounce, alpha=a)
        k = (tl - 0.35) / 0.3
        blit(frame, self.lab, x, y + 170, alpha=a * smooth(k * 2), scale=max(0.01, back_out(k)))


# ------------------------------------------------------------------ freeze frame + replay badge
class FreezeFrame(Element):
    """On a `freeze` segment: the still frame becomes a photo (white border) / comic panel / plain still."""

    def __init__(self, **p):
        super().__init__(**p)
        self.kind = p.get("frame", "photo")
        self._lab = None
        if p.get("label"):
            self._lab = pill_rgba(p["label"], ACCENT if self.kind != "photo" else INK, INK if self.kind != "photo" else WHITE, size=60)

    def process(self, frame, tl, ctx):
        if self.kind == "plain":
            return frame
        k = ease_out(tl / 0.25)
        bg = cv2.GaussianBlur(frame, (0, 0), 18).astype(np.float32) * 0.45
        s = 1 - 0.16 * k
        h, w = frame.shape[:2]
        pw, ph = int(w * s), int(h * s)
        photo = cv2.resize(frame, (pw, ph), interpolation=cv2.INTER_AREA)
        b = 26 if self.kind == "photo" else 14
        col = (255, 255, 255) if self.kind == "photo" else (15, 15, 15)
        card = np.full((ph + 2 * b + (60 if self.kind == "photo" else 0), pw + 2 * b, 3), col, np.uint8)
        card[b:b + ph, b:b + pw] = photo
        if self.kind == "comic":
            g = cv2.cvtColor(photo, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
            from .looks import _halftone
            dots = _halftone(ph, pw, 10, g)
            card[b:b + ph, b:b + pw] = (photo * (1 - 0.35 * dots[..., None])).astype(np.uint8)
        rgba = np.dstack([card, np.full(card.shape[:2], 255, np.uint8)])
        out = bg.astype(np.uint8)
        ang = (-3 if self.kind == "photo" else 2) * k
        blit(out, np.array(with_shadow(Image.fromarray(rgba), 18, (0, 14), 0.6)), w / 2, h / 2, angle=ang)
        flash = max(0.0, 1 - tl / 0.15)
        return np.clip(out.astype(np.float32) + flash * 200, 0, 255).astype(np.uint8)

    def draw(self, frame, tl, dur, ctx):
        if self._lab is not None:
            k = (tl - 0.25) / 0.3
            blit(frame, self._lab, OW / 2, OH * 0.82 if self.kind == "photo" else 230, alpha=smooth(k * 2), scale=max(0.01, back_out(k)), angle=-4)


class ReplayBadge(Element):
    def __init__(self, **p):
        super().__init__(**p)
        self.pill = pill_rgba(p.get("text") or "دوباره ببین", RED, size=52, icon="dot")

    def draw(self, frame, tl, dur, ctx):
        blit(frame, self.pill, OW / 2, 210, alpha=fade(tl, dur, 0.1, 0.15), scale=max(0.01, back_out(tl / 0.25)))


REGISTRY = {"type_text": TypeText, "lower_third": LowerThird, "list_card": ListCard, "compare": Compare,
            "count_up": CountUp, "bar_chart": BarChart, "progress": ProgressBar, "notification": Notification,
            "chat": Chat, "search_bar": SearchBar, "timer": Timer, "callout": Callout, "emoji_pop": EmojiPop,
            "emoji_rain": EmojiRain, "prohibit": Prohibit, "cta": CTAButton, "quote": Quote, "price_tag": PriceTag,
            "location": LocationPin, "freeze_frame": FreezeFrame, "replay_badge": ReplayBadge}
