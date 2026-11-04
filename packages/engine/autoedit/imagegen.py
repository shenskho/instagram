"""Local image generator for backgrounds: stable-diffusion.cpp (`sd-cli`) + SD-Turbo, CPU only.

  status()                      -> {"available": bool, "reason": str, "model": path}
  prompt_for(text, style)       -> (english prompt, words it did not understand)
  generate(text, style, out)    -> out (PNG, 512x896)
  fetch_model(dest, url)        -> downloads the model with resume, printing progress lines

The generator is optional: without the binary or the model every call fails with a clear reason and the
director falls back to a drawn place."""
import hashlib, json, os, re, shutil, subprocess, sys, time, urllib.request

DEFAULT_MODEL_URL = "https://huggingface.co/Green-Sky/SD-Turbo-GGUF/resolve/main/sd_turbo-f16-q8_0.gguf"
MODEL_NAME = "sd_turbo-f16-q8_0.gguf"
MIN_MODEL_BYTES = 1_500_000_000


def sd_bin():
    return os.environ.get("AUTOEDIT_SD_BIN") or shutil.which("sd-cli") or "/usr/local/bin/sd-cli"


def model_path():
    if os.environ.get("AUTOEDIT_SD_MODEL"):
        return os.environ["AUTOEDIT_SD_MODEL"]
    from .config import asset
    return asset("models", MODEL_NAME)


def status():
    b, m = sd_bin(), model_path()
    if not (os.path.exists(b) and os.access(b, os.X_OK)):
        return {"available": False, "reason": "no-binary", "model": m}
    if not os.path.exists(m) or os.path.getsize(m) < MIN_MODEL_BYTES:
        part = m + ".part"
        got = os.path.getsize(part) if os.path.exists(part) else 0
        return {"available": False, "reason": "no-model", "model": m, "downloaded": got}
    return {"available": True, "reason": "", "model": m}


# ------------------------------------------------------------------ prompts
STYLE_PROMPTS = {
    "photo": "a photo of {place}, wide shot, natural light, highly detailed, sharp focus",
    "cinematic": "cinematic film still of {place}, dramatic lighting, wide angle, teal and orange",
    "cartoon": "cartoon illustration of {place}, flat colors, bold outlines, children's animation background",
    "anime": "anime background art of {place}, hand painted, studio ghibli style, soft clouds",
    "threed": "3d render of {place}, pixar style, soft global illumination, octane render, cute",
    "watercolor": "watercolor painting of {place}, soft washes, paper texture",
    "oil": "oil painting of {place}, thick brush strokes, impressionism",
    "sketch": "pencil sketch of {place}, black and white, hand drawn, cross hatching",
    "pixel": "pixel art of {place}, 16-bit video game background",
    "neon": "neon cyberpunk {place} at night, glowing lights, synthwave",
}
TAIL = ", empty scene, nobody, no people, vertical composition, background"

# Persian -> English for place prompts. Phrases first (longest match wins), then single words.
PHRASES = {
    "زیر آب": "underwater", "زیر دریا": "under the sea, coral reef", "شهر آینده": "futuristic city", "کوه برفی": "snowy mountains",
    "کوهستان برفی": "snowy mountains", "جنگل بارانی": "rainforest", "ساحل گرمسیری": "tropical beach", "سطح مریخ": "surface of mars",
    "فضای بیرون": "outer space", "کافه‌ی دنج": "cozy cafe", "کافه دنج": "cozy cafe", "دفتر کار": "office", "اتاق کار": "home office",
    "استادیوم فوتبال": "football stadium", "بازار سنتی": "traditional persian bazaar", "بازار قدیمی": "old persian bazaar",
    "قلعه‌ی قدیمی": "old castle", "قلعه قدیمی": "old castle", "کتابخانه‌ی قدیمی": "old library", "کتابخانه قدیمی": "old library",
    "شهر در شب": "city at night", "غروب آفتاب": "sunset", "طلوع آفتاب": "sunrise", "شب پرستاره": "starry night",
    "تخت جمشید": "persepolis ruins", "برج میلاد": "milad tower tehran", "برج آزادی": "azadi tower tehran",
    "میدان نقش جهان": "naqsh-e jahan square isfahan", "سی و سه پل": "si-o-se pol bridge isfahan", "دریای خزر": "caspian sea coast",
    "خلیج فارس": "persian gulf coast", "جزیره کیش": "kish island beach", "کویر لوت": "lut desert", "مزرعه گندم": "wheat field",
    "باغ ایرانی": "persian garden", "خانه قدیمی": "old persian house", "آشپزخانه مدرن": "modern kitchen",
}
WORDS = {
    "جنگل": "forest", "ساحل": "beach", "دریا": "sea", "اقیانوس": "ocean", "فضا": "outer space", "کهکشان": "galaxy", "ستاره": "stars",
    "سیاره": "planet", "ماه": "moon", "مریخ": "mars", "شهر": "city", "خیابان": "street", "کوچه": "alley", "کویر": "desert",
    "بیابان": "desert", "صحرا": "desert", "کوه": "mountain", "کوهستان": "mountains", "برف": "snow", "برفی": "snowy", "یخ": "ice",
    "آسمان": "sky", "ابر": "clouds", "ابری": "cloudy", "غروب": "sunset", "طلوع": "sunrise", "شب": "night", "روز": "day",
    "باران": "rain", "بارانی": "rainy", "مه": "fog", "مه‌آلود": "foggy", "رودخانه": "river", "دریاچه": "lake", "آبشار": "waterfall",
    "باغ": "garden", "پارک": "park", "مزرعه": "farm", "گل": "flowers", "درخت": "trees", "کافه": "cafe", "رستوران": "restaurant",
    "کتابخانه": "library", "مدرسه": "school", "کلاس": "classroom", "دانشگاه": "university", "دفتر": "office", "اداره": "office",
    "آشپزخانه": "kitchen", "اتاق": "room", "خانه": "house", "ویلا": "villa", "قلعه": "castle", "کاخ": "palace", "مسجد": "mosque",
    "بازار": "bazaar", "فروشگاه": "store", "مغازه": "shop", "باشگاه": "gym", "استادیوم": "stadium", "ورزشگاه": "stadium",
    "فرودگاه": "airport", "ایستگاه": "station", "قطار": "train", "مترو": "subway", "جاده": "road", "پل": "bridge", "برج": "tower",
    "آزمایشگاه": "laboratory", "بیمارستان": "hospital", "استودیو": "studio", "صحنه": "stage", "کنسرت": "concert", "سینما": "cinema",
    "موزه": "museum", "معبد": "temple", "غار": "cave", "آتشفشان": "volcano", "جزیره": "island", "زیر": "under", "آب": "water",
    "مرجان": "coral reef", "یخچال": "glacier", "قطب": "arctic", "دهکده": "village", "روستا": "village", "مرداب": "swamp",
    "قدیمی": "old", "باستانی": "ancient", "سنتی": "traditional", "مدرن": "modern", "آینده": "futuristic", "آینده‌نگر": "futuristic",
    "بزرگ": "big", "کوچک": "small", "زیبا": "beautiful", "تاریک": "dark", "روشن": "bright", "رنگی": "colorful", "رنگارنگ": "colorful",
    "جادویی": "magical", "شلوغ": "busy", "خلوت": "quiet", "دنج": "cozy", "گرمسیری": "tropical", "پاییزی": "autumn", "بهاری": "spring",
    "زمستانی": "winter", "تابستانی": "summer", "طلایی": "golden", "آبی": "blue", "سبز": "green", "قرمز": "red", "صورتی": "pink",
    "بنفش": "purple", "نئونی": "neon", "شیک": "elegant", "لوکس": "luxury", "ایرانی": "persian", "فارسی": "persian",
    "تهران": "tehran", "تبریز": "tabriz", "اصفهان": "isfahan", "شیراز": "shiraz", "مشهد": "mashhad", "یزد": "yazd", "کیش": "kish island",
    "کاشان": "kashan", "رشت": "rasht", "کرمان": "kerman", "قشم": "qeshm island", "شمال": "northern iran forest", "دبی": "dubai",
    "پاریس": "paris", "لندن": "london", "نیویورک": "new york", "توکیو": "tokyo", "استانبول": "istanbul", "رم": "rome",
    "و": "and", "در": "in", "با": "with", "کنار": "by the", "روی": "on", "پر": "full of",
}
ADJ = {"old", "ancient", "traditional", "modern", "futuristic", "big", "small", "beautiful", "dark", "bright", "colorful", "magical",
       "busy", "quiet", "cozy", "tropical", "autumn", "spring", "winter", "summer", "golden", "blue", "green", "red", "pink",
       "purple", "neon", "elegant", "luxury", "persian", "snowy", "rainy", "cloudy", "foggy"}


def _norm(s):
    s = s.replace("ي", "ی").replace("ك", "ک").replace("‌", " ").replace("ۀ", "ه").strip()
    s = re.sub(r"[«»\"'!؟?.,،]", " ", s)
    return re.sub(r"\s+", " ", s)


def to_english(text):
    """Returns (english, unknown persian words)."""
    if not re.search(r"[؀-ۿ]", text):
        return text.strip(), []
    s = _norm(text)
    out, unknown = [], []
    phrases = sorted(((_norm(k), v) for k, v in PHRASES.items()), key=lambda kv: -len(kv[0]))
    words = s.split(" ")
    i = 0
    while i < len(words):
        hit = None
        for k, v in phrases:
            n = len(k.split(" "))
            if " ".join(words[i:i + n]) == k:
                hit = (v, n); break
        if hit:
            out.append(hit[0]); i += hit[1]; continue
        w = words[i]
        cand = [w, re.sub(r"(ها|های|ی|ای|‌ی)$", "", w), w.rstrip("ی")]
        eng = next((WORDS[c] for c in cand if c in WORDS), None)
        if eng is None and re.search(r"[A-Za-z]", w):
            eng = w
        if eng is None:
            unknown.append(w)
        else:
            out.append(eng)
        i += 1
    # Persian puts the adjective after the noun (ezafe); English wants it before
    res = []
    for w in out:
        if w in ADJ and res and res[-1] not in ADJ and res[-1] not in ("and", "in", "with", "on", "by the"):
            res.insert(len(res) - 1, w)
        else:
            res.append(w)
    return " ".join(res), unknown


def prompt_for(text, style="photo"):
    place, unknown = to_english(text)
    tmpl = STYLE_PROMPTS.get(style, STYLE_PROMPTS["photo"])
    return tmpl.format(place=place or "a beautiful landscape") + TAIL, unknown


def cache_key(text, style, seed=0):
    return hashlib.sha1(f"v1|{_norm(text)}|{style}|{seed}".encode()).hexdigest()[:16]


def generate(text, style, out, seed=None, w=512, h=896, steps=4, threads=None, log=print):
    st = status()
    if not st["available"]:
        raise RuntimeError(f"image generator not available: {st['reason']}")
    prompt, unknown = prompt_for(text, style)
    if unknown:
        log(f"  imagegen: words not understood: {' '.join(unknown)}")
    seed = int(cache_key(text, style)[:6], 16) % 100000 if seed is None else seed
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = out + ".tmp.png"
    cmd = [sd_bin(), "-m", st["model"], "-p", prompt, "--cfg-scale", "1.0", "--steps", str(steps),
           "--sampling-method", "euler_a", "-W", str(w), "-H", str(h), "-s", str(seed), "-o", tmp,
           "-t", str(threads or max(1, (os.cpu_count() or 2) - 1)), "--disable-image-metadata"]
    t = time.time()
    log(f"  imagegen: «{text}» -> {prompt}")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(tmp):
        raise RuntimeError(f"sd-cli failed ({r.returncode}): {(r.stderr or r.stdout)[-800:]}")
    os.replace(tmp, out)
    with open(out + ".json", "w", encoding="utf-8") as f:
        json.dump({"text": text, "style": style, "prompt": prompt, "unknown": unknown, "seed": seed,
                   "seconds": round(time.time() - t, 1)}, f, ensure_ascii=False)
    log(f"  imagegen: done in {time.time() - t:.0f}s")
    return out


def fetch_model(dest=None, url=None, log=print):
    """Download the model with resume (dest.part). Prints `download <bytes> <total>` lines."""
    dest = dest or model_path()
    url = url or os.environ.get("IMAGEGEN_MODEL_URL") or DEFAULT_MODEL_URL
    if os.path.exists(dest) and os.path.getsize(dest) >= MIN_MODEL_BYTES:
        log(f"model already present: {dest}"); return dest
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    part = dest + ".part"
    have = os.path.getsize(part) if os.path.exists(part) else 0
    req = urllib.request.Request(url, headers={"User-Agent": "autoreel-worker", **({"Range": f"bytes={have}-"} if have else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        total = int(r.headers.get("Content-Range", "/0").split("/")[-1] or 0) or (have + int(r.headers.get("Content-Length", 0)))
        if r.status == 200 and have:   # server ignored the range: start over
            have = 0
        with open(part, "ab" if have else "wb") as f:
            last = 0
            while True:
                buf = r.read(1 << 20)
                if not buf: break
                f.write(buf); have += len(buf)
                if have - last > 50 << 20:
                    log(f"download {have} {total}"); last = have
    if have < MIN_MODEL_BYTES:
        raise RuntimeError(f"download incomplete ({have} bytes)")
    os.replace(part, dest)
    log(f"model ready: {dest}")
    return dest
