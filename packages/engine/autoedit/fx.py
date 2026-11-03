"""Procedural assets: sky background, original dinosaur sprite, sound effects, music bed.
Everything is generated in code so there are no licensing questions."""
import math
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter

RNG = np.random.default_rng(7)


# ---------------------------------------------------------------- sky
def _noise(h, w, octaves=5, seed=1):
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        sh, sw = max(2, h // (2 ** (octaves - o + 2))), max(2, w // (2 ** (octaves - o + 2)))
        n = rng.random((sh, sw)).astype(np.float32)
        acc += amp * cv2.resize(n, (w, h), interpolation=cv2.INTER_CUBIC)
        tot += amp
        amp *= 0.5
    return acc / tot


def make_sky(w, h, tall=2.0):
    """Returns an RGB float32 sky texture of size (h*tall, w) for vertical scrolling."""
    H = int(h * tall)
    y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    top = np.array([40, 110, 210], np.float32)
    bot = np.array([175, 220, 255], np.float32)
    grad = top * (1 - y[..., None]) + bot * y[..., None]
    grad = np.repeat(grad, w, axis=1)
    n = _noise(H, w, 6, seed=3)
    clouds = np.clip((n - 0.52) * 4.0, 0, 1)
    clouds = cv2.GaussianBlur(clouds, (0, 0), 6)
    shade = np.clip(_noise(H, w, 4, seed=9) * 1.2, 0.75, 1.0)
    cloud_rgb = np.stack([shade * 238, shade * 244, shade * 255], -1)
    clouds = clouds * 0.85
    sky = grad * (1 - clouds[..., None]) + cloud_rgb * clouds[..., None]
    # make it seamless vertically by mirroring the bottom half blend
    return np.concatenate([sky, sky[::-1]], 0).astype(np.float32)


def speed_lines(w, h, t, n=26, seed=5):
    """Additive white streak layer (float 0..1) suggesting upward flight."""
    rng = np.random.default_rng(seed)
    layer = np.zeros((h, w), np.float32)
    for i in range(n):
        x = int(rng.random() * w)
        L = int(h * (0.12 + rng.random() * 0.25))
        speed = h * (1.2 + rng.random() * 1.6)
        y = int((rng.random() * h + t * speed) % (h + L)) - L
        cv2.line(layer, (x, y), (x, y + L), 0.5 + 0.5 * rng.random(), 2 + int(rng.random() * 3))
    return cv2.GaussianBlur(layer, (0, 0), 1.2)


# ---------------------------------------------------------------- dinosaur
def _bezier(p0, p1, p2, n):
    for i in range(n):
        t = i / (n - 1)
        yield ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0],
               (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1], t)


def dino_sprite(phase, scale=1.0):
    """Original long-neck sauropod, side view facing left. phase in [0,1) drives the walk cycle.
    Returns RGBA uint8 array."""
    S = 2  # supersample
    W, H = 900 * S, 720 * S
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    body = (78, 138, 74, 255)
    far = (56, 104, 54, 255)
    belly = (156, 196, 122, 255)
    spot = (60, 112, 62, 255)
    line = (30, 58, 30, 255)
    a = 2 * math.pi * phase
    bob = 6 * math.sin(2 * a)

    def leg(x, y, ang, col, length=175, wdt=58):
        # pillar leg rotated about hip (x,y)
        ca, sa = math.cos(ang), math.sin(ang)
        pts = []
        for px, py in [(-wdt / 2, 0), (wdt / 2, 0), (wdt / 2 + 4, length), (-wdt / 2 - 4, length)]:
            pts.append(((x + px * ca - py * sa) * S, (y + bob + px * sa + py * ca) * S))
        d.polygon(pts, fill=col, outline=line, width=3 * S)
        fx = x - length * sa
        fy = y + bob + length * ca
        d.ellipse([(fx - wdt / 2 - 6) * S, (fy - 14) * S, (fx + wdt / 2 + 6) * S, (fy + 12) * S], fill=col, outline=line, width=3 * S)

    sw = math.radians(17)
    # far legs (behind body)
    leg(370, 450, sw * math.sin(a + math.pi), far)
    leg(580, 450, sw * math.sin(a), far)
    # tail
    for x, y, t in _bezier((620, 400 + bob), (780, 470), (885, 330 + 10 * math.sin(a + 1)), 40):
        r = 62 * (1 - t) + 5
        d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=body)
    # neck
    hx, hy = 112 + 4 * math.sin(a), 120 + bob + 8 * math.sin(a + 0.6)
    for x, y, t in _bezier((330, 380 + bob), (215, 330), (hx + 30, hy + 20), 46):
        r = 60 * (1 - t) + 26 * t
        d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=body)
    # body
    d.ellipse([255 * S, (285 + bob) * S, 665 * S, (520 + bob) * S], fill=body, outline=line, width=3 * S)
    d.chord([290 * S, (380 + bob) * S, 640 * S, (520 + bob) * S], 20, 160, fill=belly)
    for cx, cy, r in [(420, 320, 22), (500, 312, 18), (570, 335, 15), (350, 335, 14), (460, 350, 12)]:
        d.ellipse([(cx - r) * S, (cy + bob - r) * S, (cx + r) * S, (cy + bob + r) * S], fill=spot)
    # head
    d.ellipse([(hx - 62) * S, (hy - 34) * S, (hx + 48) * S, (hy + 34) * S], fill=body, outline=line, width=3 * S)
    d.ellipse([(hx - 20) * S, (hy - 18) * S, (hx - 4) * S, (hy - 2) * S], fill=(25, 30, 25, 255))
    d.ellipse([(hx - 15) * S, (hy - 15) * S, (hx - 10) * S, (hy - 10) * S], fill=(255, 255, 255, 255))
    d.arc([(hx - 58) * S, (hy - 6) * S, (hx - 18) * S, (hy + 20) * S], 20, 120, fill=line, width=3 * S)
    # near legs (in front of body)
    leg(400, 455, sw * math.sin(a), body)
    leg(610, 455, sw * math.sin(a + math.pi), body)
    out = im.resize((int(900 * scale), int(720 * scale)), Image.LANCZOS)
    arr = np.array(out)
    # match camera softness
    arr = cv2.GaussianBlur(arr, (0, 0), 0.8)
    return arr


# ---------------------------------------------------------------- audio
SR = 48000


def _env(n, a, r):
    e = np.ones(n, np.float32)
    na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e


def sfx_whoosh(dur=0.45):
    n = int(dur * SR)
    noise = RNG.standard_normal(n).astype(np.float32)
    # sweeping band-pass via moving average of differing widths
    out = np.zeros(n, np.float32)
    k = np.linspace(40, 4, n).astype(int)
    cs = np.cumsum(np.concatenate([[0], noise]))
    idx = np.arange(n)
    lo = np.clip(idx - k, 0, n)
    out = (cs[idx + 1] - cs[lo]) / (k + 1)
    out -= np.convolve(out, np.ones(200) / 200, mode="same")
    env = np.sin(np.linspace(0, np.pi, n)) ** 1.5
    return (out / (np.abs(out).max() + 1e-6) * env * 0.55).astype(np.float32)


def sfx_pop():
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = 900 * np.exp(-t * 18) + 300
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 35)
    return (s * 0.5).astype(np.float32)


def sfx_thud():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 70 * np.exp(-t * 6) + 38
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)
    s += 0.15 * RNG.standard_normal(n) * np.exp(-t * 60)
    return (s * 0.9).astype(np.float32)


def sfx_rise(dur=1.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 180 + 900 * (t / dur) ** 2
    s = 0.35 * np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.25 * sfx_whoosh(dur)[:n]
    return (s * _env(n, 0.3, 0.25) * 0.6).astype(np.float32)


def sfx_glitch():
    n = int(0.25 * SR)
    s = np.sign(np.sin(2 * np.pi * np.cumsum(RNG.choice([220, 440, 880, 1760], n)) / SR))
    gate = (RNG.random(n // 600 + 1) > 0.4).repeat(600)[:n]
    return (s * gate * 0.18 * _env(n, 0.005, 0.05)).astype(np.float32)


def music_bed(dur, bpm=96):
    """Soft original chord pad + light hats. Mono float32."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    beat = 60 / bpm
    bar = beat * 4
    chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
    out = np.zeros(n, np.float32)
    for i in range(int(dur / bar) + 1):
        a, b = int(i * bar * SR), min(n, int((i + 1) * bar * SR))
        if a >= n: break
        tt = t[a:b] - t[a]
        seg = np.zeros(b - a, np.float32)
        for m in chords[i % 4]:
            f = 440 * 2 ** ((m - 69) / 12)
            seg += 0.16 * np.sin(2 * np.pi * f * tt) + 0.05 * np.sin(2 * np.pi * 2 * f * tt + 0.3)
        e = np.minimum(1, tt / 0.4) * np.minimum(1, (bar - tt) / 0.3)
        out[a:b] += seg * e
    # sub bass on beat 1 & 3
    for k in range(int(dur / (beat * 2)) + 1):
        a = int(k * beat * 2 * SR)
        if a >= n: break
        m = int(0.3 * SR); b = min(n, a + m)
        tt = np.arange(b - a) / SR
        out[a:b] += 0.35 * np.sin(2 * np.pi * 55 * tt) * np.exp(-tt * 9)
    # hats on off-beats
    for k in range(int(dur / (beat / 2)) + 1):
        if k % 2 == 0: continue
        a = int(k * beat / 2 * SR); b = min(n, a + int(0.04 * SR))
        if a >= n: break
        out[a:b] += 0.05 * RNG.standard_normal(b - a) * np.linspace(1, 0, b - a)
    out *= _env(n, 1.0, 1.5)
    return (out / (np.abs(out).max() + 1e-6) * 0.7).astype(np.float32)


# ---------------------------------------------------------------- v2 sound design
def _tone(f, dur, decay, amp=0.5, harm=(1.0,)):
    n = int(dur * SR); t = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * f * (i + 1) * t) for i, a in enumerate(harm))
    return (amp * s * np.exp(-t * decay)).astype(np.float32)


def sfx_impact():
    n = int(0.9 * SR); t = np.arange(n) / SR
    f = 120 * np.exp(-t * 5) + 35
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5)
    s += 0.5 * RNG.standard_normal(n) * np.exp(-t * 25)
    s = np.convolve(s, np.ones(6) / 6, mode="same")
    return (s / np.abs(s).max() * 0.9).astype(np.float32)


def sfx_stamp():
    n = int(0.3 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * np.cumsum(90 * np.exp(-t * 20) + 60) / SR) * np.exp(-t * 18)
    s += 0.6 * RNG.standard_normal(n) * np.exp(-t * 70)
    return (s / np.abs(s).max() * 0.85).astype(np.float32)


def sfx_click():
    n = int(0.05 * SR); t = np.arange(n) / SR
    s = RNG.standard_normal(n) * np.exp(-t * 220) + 0.6 * np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 120)
    return (s / np.abs(s).max() * 0.45).astype(np.float32)


def sfx_ding():
    return _tone(1318, 0.9, 5, 0.28, (1.0, 0.35, 0.15))


def sfx_beep():
    n = int(0.12 * SR); t = np.arange(n) / SR
    return (0.22 * np.sin(2 * np.pi * 1000 * t) * _env(n, 0.005, 0.02)).astype(np.float32)


def sfx_shutter():
    a = sfx_click() * 1.4
    gap = np.zeros(int(0.07 * SR), np.float32)
    return np.concatenate([a, gap, a * 0.8]).astype(np.float32)


def sfx_ticks(dur):
    n = int(dur * SR); out = np.zeros(n, np.float32)
    t = 0.0
    while t < dur - 0.05:
        c = sfx_click() * (0.35 + 0.3 * RNG.random())
        a = int(t * SR); out[a:a + len(c)] += c[:n - a]
        t += 0.06 + RNG.random() * 0.07
    return out


def sfx_riser(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 300 + 1500 * (t / dur) ** 2
    s = 0.25 * np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.35 * sfx_whoosh(dur)[:n]
    return (s * (t / dur) ** 1.5).astype(np.float32)


def sfx_rewind(dur=0.75):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 900 + 500 * np.sin(2 * np.pi * 9 * t) - 600 * t / dur
    s = 0.22 * np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) + 0.3 * RNG.standard_normal(n)
    s = np.convolve(s, np.ones(8) / 8, mode="same")
    return (s * _env(n, 0.02, 0.08) * 0.7).astype(np.float32)


def sfx_swish():
    return sfx_whoosh(0.25) * 0.8


SFX = {"pop": sfx_pop, "whoosh": sfx_whoosh, "glitch": sfx_glitch, "thud": sfx_thud, "impact": sfx_impact,
       "stamp": sfx_stamp, "click": sfx_click, "ding": sfx_ding, "beep": sfx_beep, "shutter": sfx_shutter,
       "swish": sfx_swish}


# ---------------------------------------------------------------- jungle scene (original illustration)
def _leaf(d, cx, cy, length, width, angle, fill, rib):
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for i in range(41):
        t = i / 40
        w = width * math.sin(math.pi * t) ** 0.8
        pts.append((t * length, w))
    for i in range(40, -1, -1):
        t = i / 40
        w = width * math.sin(math.pi * t) ** 0.8
        pts.append((t * length, -w * 0.9))
    poly = [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]
    d.polygon(poly, fill=fill)
    d.line([(cx, cy), (cx + length * 0.95 * ca, cy + length * 0.95 * sa)], fill=rib, width=max(2, int(width * 0.08)))


def make_jungle(w=1080, h=1920, seed=21):
    """Returns (background RGB float32, foreground RGBA uint8). Flat illustrated jungle, sky open in the middle."""
    rng = np.random.default_rng(seed)
    S = 1
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    top, mid = np.array([110, 195, 215], np.float32), np.array([252, 236, 185], np.float32)
    sky = top * (1 - np.clip(y / 0.6, 0, 1)) + mid * np.clip(y / 0.6, 0, 1)
    bg = Image.fromarray(np.repeat(sky, w, axis=1).astype(np.uint8)).convert("RGBA")

    def layer():
        return Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # far hills
    for base, amp, col, blur in [(1150, 70, (130, 180, 150, 255), 4), (1270, 55, (95, 155, 115, 255), 2)]:
        L = layer(); d = ImageDraw.Draw(L)
        ph = rng.random() * 6
        pts = [(x, base + amp * math.sin(x / 160 + ph) + amp * 0.5 * math.sin(x / 57 + ph * 2)) for x in range(0, w + 20, 20)]
        d.polygon(pts + [(w, h), (0, h)], fill=col)
        bg = Image.alpha_composite(bg, L.filter(ImageFilter.GaussianBlur(blur)))
    # trunks
    L = layer(); d = ImageDraw.Draw(L)
    for x, tw in [(-20, 110), (150, 70), (905, 80), (1030, 120)]:
        d.rounded_rectangle([x, 520, x + tw, 1720], radius=30, fill=(96, 68, 46, 255))
        d.rectangle([x + tw * 0.6, 540, x + tw * 0.72, 1700], fill=(78, 54, 36, 255))
    bg = Image.alpha_composite(bg, L.filter(ImageFilter.GaussianBlur(1)))
    # canopy clusters (leave the centre sky open)
    L = layer(); d = ImageDraw.Draw(L)
    for _ in range(140):
        side = rng.random() < 0.5
        cx = rng.normal(80 if side else w - 80, 150)
        cy = rng.uniform(-120, 760) if abs(cx - w / 2) > 330 else rng.uniform(-150, 140)
        r = rng.uniform(70, 150)
        g = rng.integers(0, 3)
        col = [(38, 112, 62), (30, 92, 52), (52, 132, 72)][g]
        d.ellipse([cx - r, cy - r * 0.8, cx + r, cy + r * 0.8], fill=col + (255,))
    bg = Image.alpha_composite(bg, L)
    # vines
    L = layer(); d = ImageDraw.Draw(L)
    for vx in [210, 300, 780, 860, 120, 960]:
        x0, y0 = vx + rng.uniform(-20, 20), rng.uniform(120, 300)
        length = rng.uniform(350, 650)
        prev = (x0, y0)
        for i in range(1, 31):
            t = i / 30
            pt = (x0 + 25 * math.sin(t * 5 + vx), y0 + length * t)
            d.line([prev, pt], fill=(48, 120, 64, 255), width=5)
            if i % 3 == 0:
                _leaf(d, pt[0], pt[1], 38, 14, 30 if i % 2 else 150, (60, 150, 80, 255), (40, 110, 60, 255))
            prev = pt
    bg = Image.alpha_composite(bg, L)
    # bushes along the ground line + ground
    L = layer(); d = ImageDraw.Draw(L)
    d.rectangle([0, 1640, w, h], fill=(72, 140, 70, 255))
    for _ in range(60):
        cx, r = rng.uniform(-40, w + 40), rng.uniform(60, 130)
        cy = rng.uniform(1560, 1680)
        col = [(56, 136, 72), (44, 118, 60), (70, 152, 80)][rng.integers(0, 3)]
        d.ellipse([cx - r, cy - r * 0.7, cx + r, cy + r * 0.7], fill=col + (255,))
    for _ in range(260):
        gx, gy = rng.uniform(0, w), rng.uniform(1660, h)
        d.line([(gx, gy), (gx + rng.uniform(-8, 8), gy - rng.uniform(15, 40))], fill=(96, 170, 88, 255), width=3)
    bg = Image.alpha_composite(bg, L)
    bgarr = np.array(bg.convert("RGB")).astype(np.float32)

    # foreground leaves in the corners (drawn over the speaker)
    fg = layer(); d = ImageDraw.Draw(fg)
    for (cx, cy, ang, ln, wd) in [(-60, 1960, -55, 520, 120), (40, 1990, -80, 480, 110), (-80, 1700, -20, 420, 95),
                                  (1140, 1960, -125, 520, 120), (1040, 2000, -100, 470, 105), (1160, 1720, -160, 420, 95),
                                  (-60, -40, 40, 430, 100), (1140, -40, 140, 430, 100), (-40, 260, 10, 300, 70), (1120, 300, 170, 300, 70)]:
        col = (34, 118, 56, 255) if rng.random() < 0.5 else (52, 140, 66, 255)
        _leaf(d, cx, cy, ln, wd, ang, col, (24, 90, 42, 255))
    fg = fg.filter(ImageFilter.GaussianBlur(2.2))  # closer to camera = softer
    return bgarr, np.array(fg)


def sun_sprite(r=95):
    """Returns (disc+rays RGBA, glow float map) for a stylised sun."""
    size = int(r * 5)
    c = size / 2
    rays = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(rays)
    for i in range(12):
        a = 2 * math.pi * i / 12
        L = r * (2.0 if i % 2 == 0 else 1.65)
        p1 = (c + L * math.cos(a), c + L * math.sin(a))
        p2 = (c + r * 1.15 * math.cos(a + 0.13), c + r * 1.15 * math.sin(a + 0.13))
        p3 = (c + r * 1.15 * math.cos(a - 0.13), c + r * 1.15 * math.sin(a - 0.13))
        d.polygon([p1, p2, p3], fill=(255, 214, 96, 230))
    rays = rays.filter(ImageFilter.GaussianBlur(1.2))
    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(disc)
    d.ellipse([c - r, c - r, c + r, c + r], fill=(255, 206, 70, 255))
    d.ellipse([c - r * 0.78, c - r * 0.82, c + r * 0.7, c + r * 0.66], fill=(255, 226, 120, 255))
    yy, xx = np.mgrid[0:size * 2, 0:size * 2].astype(np.float32)
    dist = np.sqrt((xx - size) ** 2 + (yy - size) ** 2) / (r * 4.2)
    glow = np.clip(1 - dist, 0, 1) ** 2.2
    return np.array(rays), np.array(disc), glow


def sfx_birds(dur):
    n = int(dur * SR); out = np.zeros(n, np.float32)
    t = 0.2
    while t < dur - 0.3:
        f0 = RNG.uniform(2200, 4200)
        m = int(RNG.uniform(0.06, 0.16) * SR)
        tt = np.arange(m) / SR
        f = f0 + RNG.uniform(-1200, 1200) * tt / tt[-1] + 300 * np.sin(2 * np.pi * RNG.uniform(20, 45) * tt)
        s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * tt / tt[-1]) ** 2 * RNG.uniform(0.04, 0.1)
        for k in range(RNG.integers(1, 4)):
            a = int((t + k * 0.12) * SR)
            if a + m < n: out[a:a + m] += s
        t += RNG.uniform(0.25, 0.9)
    wind = np.convolve(RNG.standard_normal(n), np.ones(400) / 400, mode="same") * 0.6
    out += wind * (0.6 + 0.4 * np.sin(np.linspace(0, 6, n)))[:n] * 0.08
    return out * _env(n, 0.3, 0.4)
