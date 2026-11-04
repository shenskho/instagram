/**
 * Edit options the creator can pick in the panel: option → type → details.
 * Every option the creator picks appears in the reel. One visual theme is resolved for the whole video
 * (see resolveTheme) so graphics, transitions and backgrounds match each other.
 */

export type OptionGroup = "look" | "scene" | "camera" | "graphic" | "transition" | "structure";
export const OPTION_GROUPS: Array<{ id: OptionGroup; label: string; hint: string }> = [
  { id: "look", label: "سبک کل ویدیو", hint: "ظاهر کلی تصویر. گرافیک‌ها و ترنزیشن‌ها با همین هماهنگ می‌شن." },
  { id: "scene", label: "محیط و پس‌زمینه", hint: "چیزهایی که پشت سرت یا دورت اتفاق می‌افته" },
  { id: "camera", label: "حرکت دوربین", hint: "زوم، لرزش و ایست تصویر" },
  { id: "graphic", label: "گرافیک و متن", hint: "چیزهایی که روی تصویر ظاهر می‌شن" },
  { id: "transition", label: "ترنزیشن", hint: "شکل برش بین دو تکه‌ی ویدیو" },
  { id: "structure", label: "ساختار ادیت", hint: "ترتیب و تکرار تکه‌ها" },
];

export type ParamValue = string | string[];
/** Show a param / choice only when another param of the same option has one of these values. */
export interface Cond { param: string; in: string[] }
export interface Choice {
  id: string;
  label: string;
  hint?: string;
  /** Preview clip name in /previews (without extension). */
  preview?: string;
  when?: Cond;
  /** Shown but not selectable; the text says why. */
  locked?: string;
  /** Needs an optional capability of the worker (e.g. the local image generator). */
  needs?: "imagegen";
}
interface ParamBase { id: string; label: string; hint?: string; when?: Cond }
export type Param =
  | (ParamBase & { kind: "one"; choices: Choice[]; default: string })
  | (ParamBase & { kind: "many"; choices: Choice[]; default: string[]; max: number; custom?: { placeholder: string; maxLength: number } })
  | (ParamBase & { kind: "text"; placeholder: string; maxLength: number; default: string; lines?: number })
  | (ParamBase & { kind: "files"; accept: string; max: number });

export interface EditOption {
  id: string;
  group: OptionGroup;
  label: string;
  hint: string;
  preview: string;
  params: Param[];
}

/** One picked option and the creator's choices for its details. */
export interface Selection { id: string; params: Record<string, ParamValue> }

// ------------------------------------------------------------------ looks
/** Whole-frame looks the engine can draw locally (packages/engine/autoedit/looks.py). */
export const LOOK_STYLES = {
  natural: "طبیعی", cinematic: "سینمایی", warm: "گرم", cool: "سرد", vivid: "پررنگ", pastel: "ملایم",
  vintage: "فیلم قدیمی", bw: "سیاه‌وسفید", cartoon: "کارتونی", comic: "کمیک", anime: "انیمه‌ای",
  sketch: "طراحی مدادی", color_pencil: "مداد رنگی", watercolor: "آبرنگ", oil: "رنگ روغن", pixel: "پیکسلی", neon: "نئون",
} as const;
export type LookStyle = keyof typeof LOOK_STYLES;
export const isLookStyle = (s: string): s is LookStyle => s in LOOK_STYLES;

/** How graphics, captions and transitions are drawn so they belong to the same world as the picture. */
export type Skin = "clean" | "retro" | "mono" | "cartoon" | "comic" | "sketch" | "paint" | "pixel" | "neon";
export const SKIN_OF: Record<LookStyle, Skin> = {
  natural: "clean", cinematic: "clean", warm: "clean", cool: "clean", vivid: "clean", pastel: "clean",
  vintage: "retro", bw: "mono", cartoon: "cartoon", anime: "cartoon", comic: "comic",
  sketch: "sketch", color_pencil: "sketch", watercolor: "paint", oil: "paint", pixel: "pixel", neon: "neon",
};
/** Transitions the director reaches for on its own, per skin (the creator's picks always come first). */
export const SKIN_TRANSITIONS: Record<Skin, string[]> = {
  clean: ["whip", "zoom_in", "slide", "flash"],
  retro: ["dissolve", "light_leak", "flash"],
  mono: ["dissolve", "flash", "blur"],
  cartoon: ["zoom_in", "spin", "circle", "flash"],
  comic: ["flash", "circle", "whip"],
  sketch: ["dissolve", "slide", "blur"],
  paint: ["dissolve", "blur", "slide"],
  pixel: ["glitch", "slide", "flash"],
  neon: ["glitch", "flash", "light_leak"],
};

/** Styles the local image generator can paint a background in, and the local look that matches each. */
export const GEN_STYLES: Record<string, { label: string; look: LookStyle; bgOnly?: boolean; prompt: string }> = {
  photo: { label: "واقعی (عکس)", look: "natural", bgOnly: true, prompt: "a photo of {place}, wide shot, natural light, highly detailed, sharp focus" },
  cinematic: { label: "سینمایی", look: "cinematic", bgOnly: true, prompt: "cinematic film still of {place}, dramatic lighting, wide angle, teal and orange" },
  cartoon: { label: "کارتونی", look: "cartoon", prompt: "cartoon illustration of {place}, flat colors, bold outlines, children's animation background" },
  anime: { label: "انیمه", look: "anime", prompt: "anime background art of {place}, hand painted, studio ghibli style, soft clouds" },
  threed: { label: "سه‌بعدی", look: "natural", bgOnly: true, prompt: "3d render of {place}, pixar style, soft global illumination, octane render, cute" },
  watercolor: { label: "آبرنگ", look: "watercolor", prompt: "watercolor painting of {place}, soft washes, paper texture" },
  oil: { label: "رنگ روغن", look: "oil", prompt: "oil painting of {place}, thick brush strokes, impressionism" },
  sketch: { label: "مدادی", look: "sketch", prompt: "pencil sketch of {place}, black and white, hand drawn, cross hatching" },
  pixel: { label: "پیکسلی", look: "pixel", prompt: "pixel art of {place}, 16-bit video game background" },
  neon: { label: "نئون", look: "neon", prompt: "neon cyberpunk {place} at night, glowing lights, synthwave" },
};

// ------------------------------------------------------------------ helpers to write the catalog
const pv = (opt: string, choice: string) => `${opt}-${choice}`;
const c = (opt: string, id: string, label: string, extra: Partial<Choice> = {}): Choice => ({ id, label, preview: pv(opt, id), ...extra });
const plain = (id: string, label: string, extra: Partial<Choice> = {}): Choice => ({ id, label, ...extra });
const text = (id: string, label: string, placeholder: string, maxLength = 60, extra: Partial<Param> = {}): Param =>
  ({ id, label, kind: "text", placeholder, maxLength, default: "", ...extra }) as Param;
const AUTO_TEXT = "خالی بذاری، کارگردان از حرف‌هات انتخاب می‌کنه";
const COLORS = (opt: string, ids: string[], withPreview = false): Choice[] => {
  const names: Record<string, string> = { yellow: "زرد", purple: "بنفش", red: "قرمز", green: "سبز", blue: "آبی", pink: "صورتی",
    black: "مشکی", white: "سفید", cyan: "فیروزه‌ای", rainbow: "رنگین‌کمانی" };
  return ids.map((id) => (withPreview ? c(opt, id, names[id]) : plain(id, names[id])));
};
const LOCK_3D = "تبدیل خود آدم به سه‌بعدی به مدل تصویری آنلاین نیاز داره. بعد از اتصال API فعال می‌شه. پس‌زمینه‌ی سه‌بعدی رو از «تغییر محیط» بساز.";

/** Built-in environments the engine draws itself (autoedit/scenes.py). */
export const DRAWN_PLACES: Record<string, string> = {
  jungle: "جنگل", beach: "ساحل", space: "فضا", city_night: "شهر در شب", desert: "کویر",
  snow: "کوه برفی", underwater: "زیر آب", sky: "آسمان", sunset: "غروب",
};
const PLACE_SUGGESTIONS = ["جنگل بارانی", "ساحل گرمسیری", "سطح مریخ", "شهر آینده", "کتابخانه‌ی قدیمی", "کافه‌ی دنج",
  "دفتر کار مدرن", "قلعه‌ی قدیمی", "زیر دریا", "کوهستان برفی", "استادیوم فوتبال", "بازار سنتی"];

export const EDIT_OPTIONS: EditOption[] = [
  // ---------------------------------------------------------------- look
  {
    id: "look", group: "look", label: "سبک تصویر", hint: "کل ویدیو با یک سبک: واقعی، کارتونی، طراحی، نقاشی یا دیجیتال", preview: "look-cartoon",
    params: [
      { id: "family", label: "نوع", kind: "one", default: "real", choices: [
        plain("real", "واقعی", { preview: "look-cinematic" }), plain("cartoon", "کارتونی", { preview: "look-cartoon" }),
        plain("drawing", "طراحی دستی", { preview: "look-sketch" }), plain("painting", "نقاشی", { preview: "look-watercolor" }),
        plain("digital", "دیجیتال", { preview: "look-neon" }), plain("threed", "سه‌بعدی", { locked: LOCK_3D }),
      ] },
      { id: "style", label: "سبک", kind: "one", default: "cinematic", choices: [
        ...(["natural", "cinematic", "warm", "cool", "vivid", "pastel", "vintage", "bw"] as const).map((s) => c("look", s, LOOK_STYLES[s], { when: { param: "family", in: ["real"] } })),
        ...(["cartoon", "comic", "anime"] as const).map((s) => c("look", s, LOOK_STYLES[s], { when: { param: "family", in: ["cartoon"] } })),
        ...(["sketch", "color_pencil"] as const).map((s) => c("look", s, LOOK_STYLES[s], { when: { param: "family", in: ["drawing"] } })),
        ...(["watercolor", "oil"] as const).map((s) => c("look", s, LOOK_STYLES[s], { when: { param: "family", in: ["painting"] } })),
        ...(["pixel", "neon"] as const).map((s) => c("look", s, LOOK_STYLES[s], { when: { param: "family", in: ["digital"] } })),
      ] },
      { id: "scope", label: "روی چه بخشی", kind: "one", default: "whole", choices: [
        plain("whole", "کل تصویر"), c("look", "scope_background", "فقط پس‌زمینه", { id: "background" }), c("look", "scope_subject", "فقط خودم", { id: "subject" }),
      ] },
    ],
  },
  {
    id: "overlay", group: "look", label: "بافت روی تصویر", hint: "دانه‌ی فیلم، خط‌های VHS، نشت نور یا نوار سینمایی روی کل ویدیو", preview: "overlay-grain",
    params: [{ id: "kinds", label: "کدوم‌ها", kind: "many", max: 3, default: [], hint: "اگه چیزی انتخاب نکنی، دانه‌ی فیلم میاد.", choices: [
      c("overlay", "grain", "دانه‌ی فیلم"), c("overlay", "vhs", "نوار VHS"), c("overlay", "light_leak", "نشت نور"),
      c("overlay", "bars", "نوار سینمایی"), c("overlay", "dust", "گردوغبار و خش"), c("overlay", "vignette", "تیرگی لبه‌ها"),
    ] }],
  },

  // ---------------------------------------------------------------- scene
  {
    id: "scene", group: "scene", label: "تغییر محیط پشت سر", hint: "پشت سرت یک یا چند محیط دیگه می‌شه، به ترتیبی که انتخاب می‌کنی", preview: "scene-beach",
    params: [
      { id: "source", label: "محیط از کجا بیاد", kind: "one", default: "drawn", choices: [
        plain("drawn", "محیط آماده", { hint: "خود برنامه می‌کشه" }),
        plain("generate", "ساختن با هوش مصنوعی", { hint: "هر محیطی که اسمش رو بنویسی", needs: "imagegen" }),
        plain("upload", "عکس یا ویدیوی خودم"),
      ] },
      { id: "places", label: "محیط‌ها (به ترتیب نمایش)", kind: "many", max: 4, default: [], when: { param: "source", in: ["drawn"] },
        hint: "یکی یا چندتا رو انتخاب کن. اگه چیزی انتخاب نکنی، جنگل میاد.",
        choices: Object.entries(DRAWN_PLACES).map(([id, label]) => c("scene", id, label)) },
      { id: "prompts", label: "اسم محیط‌ها (به ترتیب نمایش)", kind: "many", max: 4, default: [], when: { param: "source", in: ["generate"] },
        hint: "فارسی یا انگلیسی بنویس. هر محیط حدود یک دقیقه طول می‌کشه تا ساخته بشه.",
        choices: PLACE_SUGGESTIONS.map((p) => plain(p, p)), custom: { placeholder: "مثلاً «بازار قدیمی تبریز»", maxLength: 60 } },
      { id: "files", label: "عکس‌ها یا ویدیوهای محیط", kind: "files", accept: "image/*,video/*", max: 4, when: { param: "source", in: ["upload"] } },
      { id: "gen_style", label: "سبک محیط", kind: "one", default: "auto", when: { param: "source", in: ["generate"] }, choices: [
        plain("auto", "هم‌سبک کل ویدیو"),
        ...Object.entries(GEN_STYLES).map(([id, s]) => plain(id, s.label, { preview: `gen-${id}` })),
      ] },
      { id: "style", label: "سبک محیط", kind: "one", default: "auto", when: { param: "source", in: ["drawn", "upload"] }, choices: [
        plain("auto", "هم‌سبک کل ویدیو"),
        ...(["cartoon", "comic", "anime", "sketch", "color_pencil", "watercolor", "oil", "pixel", "neon", "vintage", "bw"] as const)
          .map((s) => c("scene", `style_${s}`, LOOK_STYLES[s], { id: s })),
      ] },
      { id: "scope", label: "این سبک روی چه بخشی", kind: "one", default: "whole",
        hint: "اگه محیط کارتونی بشه و «کل ویدیو» رو بزنی، خودت هم کارتونی می‌شی تا همه‌چیز با هم جور باشه.",
        choices: [plain("whole", "کل ویدیو همین سبک بشه"), plain("background", "فقط پس‌زمینه")] },
      { id: "change", label: "رفتن از یک محیط به محیط بعدی", kind: "one", default: "fade", choices: [
        c("scene", "change_fade", "محو", { id: "fade" }), c("scene", "change_flash", "فلش", { id: "flash" }), c("scene", "change_wipe", "کرکره", { id: "wipe" }),
        c("scene", "change_glitch", "گلیچ", { id: "glitch" }), plain("cut", "برش ساده"),
      ] },
      { id: "motion", label: "حرکت پس‌زمینه", kind: "one", default: "drift", choices: [
        plain("drift", "حرکت آرام"), plain("sway", "تکون ملایم"), plain("still", "ثابت"),
      ] },
      { id: "length", label: "چقدر بمونه", kind: "one", default: "auto", choices: [
        plain("auto", "به انتخاب کارگردان"), plain("short", "کوتاه (حدود ۳ ثانیه)"), plain("long", "طولانی (نصف ویدیو)"), plain("all", "کل ویدیو"),
      ] },
    ],
  },
  {
    id: "sky_fly", group: "scene", label: "پرواز در آسمان", hint: "پشت سرت آسمون می‌شه و تصویر شناور می‌شه", preview: "sky_fly-day",
    params: [{ id: "time", label: "زمان", kind: "one", default: "day", choices: [
      c("sky_fly", "day", "روز"), c("sky_fly", "sunset", "غروب"), c("sky_fly", "night", "شب پرستاره"),
    ] }],
  },
  {
    id: "flyover", group: "scene", label: "عبور چیزی از پشت سر", hint: "یک چیز بزرگ از پشت سرت رد می‌شه", preview: "flyover-dinosaur",
    params: [
      { id: "object", label: "چی رد بشه", kind: "one", default: "dinosaur", choices: [
        c("flyover", "dinosaur", "دایناسور"), c("flyover", "rocket", "موشک"), c("flyover", "ufo", "بشقاب‌پرنده"),
        c("flyover", "plane", "هواپیما"), c("flyover", "birds", "دسته‌ی پرنده"), c("flyover", "balloon", "بالن"),
      ] },
      { id: "direction", label: "جهت", kind: "one", default: "rtl", choices: [plain("rtl", "از راست به چپ"), plain("ltr", "از چپ به راست")] },
      { id: "size", label: "اندازه", kind: "one", default: "big", choices: [plain("big", "بزرگ"), plain("small", "کوچیک")] },
    ],
  },
  {
    id: "particles", group: "scene", label: "ذرات و بارش", hint: "کاغذ رنگی، برف، باران، قلب و… که توی تصویر می‌ریزه", preview: "particles-confetti",
    params: [
      { id: "kind", label: "نوع", kind: "one", default: "confetti", choices: [
        c("particles", "confetti", "کاغذ رنگی"), c("particles", "snow", "برف"), c("particles", "rain", "باران"),
        c("particles", "hearts", "قلب"), c("particles", "stars", "ستاره"), c("particles", "sparkles", "درخشش"),
        c("particles", "embers", "جرقه و آتش"), c("particles", "bubbles", "حباب"), c("particles", "leaves", "برگ پاییزی"),
        c("particles", "money", "اسکناس"),
      ] },
      { id: "layer", label: "جای ذرات", kind: "one", default: "front", choices: [plain("front", "جلوی من"), plain("behind", "پشت سرم")] },
      { id: "amount", label: "مقدار", kind: "one", default: "normal", choices: [plain("few", "کم"), plain("normal", "معمولی"), plain("many", "زیاد")] },
    ],
  },
  {
    id: "focus", group: "scene", label: "برجسته‌کردن آدم", hint: "پس‌زمینه کم‌رنگ می‌شه تا همه‌ی نگاه‌ها روی تو باشه", preview: "focus-blur",
    params: [
      { id: "mode", label: "چطور", kind: "one", default: "blur", choices: [
        c("focus", "blur", "پس‌زمینه تار"), c("focus", "bw", "پس‌زمینه سیاه‌وسفید"), c("focus", "dark", "نورافکن روی من"), c("focus", "color", "پس‌زمینه‌ی تک‌رنگ"),
      ] },
      { id: "color", label: "رنگ پس‌زمینه", kind: "one", default: "yellow", when: { param: "mode", in: ["color"] },
        choices: COLORS("focus", ["yellow", "purple", "blue", "pink", "black", "white"]) },
    ],
  },
  {
    id: "glow", group: "scene", label: "هاله دور آدم", hint: "دور بدنت یک خط یا هاله‌ی نورانی می‌افته", preview: "glow-glow",
    params: [
      { id: "mode", label: "شکل", kind: "one", default: "glow", choices: [
        c("glow", "glow", "هاله‌ی نور"), c("glow", "sticker", "لبه‌ی سفید مثل استیکر"), c("glow", "outline", "خط دور رنگی"),
      ] },
      { id: "color", label: "رنگ", kind: "one", default: "yellow", when: { param: "mode", in: ["glow", "outline"] },
        choices: COLORS("glow", ["yellow", "white", "cyan", "pink", "rainbow"]) },
    ],
  },
  {
    id: "clones", group: "scene", label: "چند نسخه از آدم", hint: "چند تا از خودت کنار هم یا آینه‌ای دیده می‌شی", preview: "clones-side",
    params: [
      { id: "mode", label: "چیدمان", kind: "one", default: "side", choices: [c("clones", "side", "کنار هم"), c("clones", "mirror", "آینه‌ای")] },
      { id: "count", label: "تعداد", kind: "one", default: "3", when: { param: "mode", in: ["side"] }, choices: [plain("2", "دو تا"), plain("3", "سه تا")] },
    ],
  },

  // ---------------------------------------------------------------- camera
  {
    id: "zoom_punch", group: "camera", label: "زوم ضربه‌ای", hint: "زوم سریع روی کلمه‌های مهم", preview: "zoom_punch-strong",
    params: [{ id: "strength", label: "شدت", kind: "one", default: "strong", choices: [c("zoom_punch", "light", "ملایم"), c("zoom_punch", "strong", "قوی")] }],
  },
  {
    id: "slow_zoom", group: "camera", label: "زوم آرام", hint: "دوربین آروم نزدیک یا دور می‌شه", preview: "slow_zoom-in",
    params: [{ id: "direction", label: "جهت", kind: "one", default: "in", choices: [c("slow_zoom", "in", "نزدیک شدن"), c("slow_zoom", "out", "دور شدن")] }],
  },
  {
    id: "shake", group: "camera", label: "لرزش", hint: "تکون تصویر روی یک لحظه‌ی مهم", preview: "shake-hit",
    params: [
      { id: "kind", label: "نوع", kind: "one", default: "hit", choices: [c("shake", "hit", "یک ضربه"), c("shake", "quake", "زلزله (چند ثانیه)")] },
      { id: "strength", label: "شدت", kind: "one", default: "strong", choices: [plain("light", "ملایم"), plain("strong", "قوی")] },
    ],
  },
  {
    id: "tilt", group: "camera", label: "کج شدن تصویر", hint: "تصویر یک لحظه کج می‌شه و برمی‌گرده؛ برای تعجب و شوخی", preview: "tilt-small",
    params: [{ id: "angle", label: "اندازه", kind: "one", default: "small", choices: [c("tilt", "small", "کم"), c("tilt", "big", "زیاد")] }],
  },
  {
    id: "freeze", group: "camera", label: "ایست تصویر", hint: "تصویر یک لحظه ثابت می‌مونه، مثل عکس گرفتن", preview: "freeze-photo",
    params: [
      { id: "frame", label: "شکل", kind: "one", default: "photo", choices: [c("freeze", "photo", "عکس با قاب سفید"), c("freeze", "comic", "قاب کمیک"), c("freeze", "plain", "ساده")] },
      text("label", "نوشته روی عکس", "اختیاری، مثلاً «این منم!»", 30),
    ],
  },

  // ---------------------------------------------------------------- graphics
  {
    id: "kinetic_text", group: "graphic", label: "متن بزرگ متحرک", hint: "کلمه‌ی کلیدی با حروف درشت", preview: "kinetic_text-slam",
    params: [
      { id: "anim", label: "حرکت", kind: "one", default: "slam", choices: [
        c("kinetic_text", "slam", "ضربه‌ای"), c("kinetic_text", "pop", "پرشی"), c("kinetic_text", "type", "تایپی"),
        c("kinetic_text", "word", "کلمه‌به‌کلمه"), c("kinetic_text", "wave", "موجی"),
      ] },
      { id: "position", label: "جا", kind: "one", default: "top", choices: [plain("top", "بالای تصویر"), plain("middle", "وسط تصویر")] },
      text("text", "متن", AUTO_TEXT, 40),
    ],
  },
  {
    id: "speech_bubble", group: "graphic", label: "حباب حرف", hint: "یک کلمه‌ی کوتاه کنار سر، مثل کمیک", preview: "speech_bubble-talk",
    params: [
      { id: "shape", label: "شکل", kind: "one", default: "talk", choices: [c("speech_bubble", "talk", "گفت‌وگو"), c("speech_bubble", "think", "فکر"), c("speech_bubble", "shout", "فریاد")] },
      text("text", "متن", AUTO_TEXT, 20),
    ],
  },
  {
    id: "stamp", group: "graphic", label: "مُهر", hint: "برچسب مهرمانند که با ضربه می‌خوره", preview: "stamp-red",
    params: [{ id: "color", label: "رنگ", kind: "one", default: "red", choices: COLORS("stamp", ["red", "green", "blue", "black"], true) }, text("text", "متن", AUTO_TEXT, 16)],
  },
  {
    id: "pill", group: "graphic", label: "برچسب", hint: "یک عبارت کوتاه داخل یک برچسب رنگی", preview: "pill-purple",
    params: [
      { id: "color", label: "رنگ", kind: "one", default: "purple", choices: COLORS("pill", ["purple", "red", "green", "yellow", "black"], true) },
      { id: "icon", label: "نشانه", kind: "one", default: "none", choices: [plain("none", "بدون نشانه"), plain("check", "تیک"), plain("dot", "نقطه"), plain("star", "ستاره")] },
      text("text", "متن", AUTO_TEXT, 30),
    ],
  },
  {
    id: "lower_third", group: "graphic", label: "معرفی اسم", hint: "اسم و سمت پایین تصویر، مثل تلویزیون", preview: "lower_third-bar",
    params: [
      { id: "look", label: "شکل", kind: "one", default: "bar", choices: [c("lower_third", "bar", "نوار"), c("lower_third", "card", "کارت"), c("lower_third", "minimal", "خط ساده")] },
      text("name", "اسم", "مثلاً «امیر پاپای»", 30), text("role", "سمت یا توضیح", "مثلاً «سازنده‌ی AutoReel»", 40),
    ],
  },
  {
    id: "list_card", group: "graphic", label: "فهرست", hint: "چند مورد که یکی‌یکی ظاهر می‌شن", preview: "list_card-checklist",
    params: [
      { id: "kind", label: "نوع", kind: "one", default: "checklist", choices: [
        c("list_card", "checklist", "چک‌لیست"), c("list_card", "steps", "مراحل شماره‌دار"), c("list_card", "pros_cons", "خوبی‌ها و بدی‌ها"), c("list_card", "product", "کارت محصول"),
      ] },
      text("title", "عنوان", AUTO_TEXT, 36),
      text("items", "موردها (هر خط یکی)", AUTO_TEXT, 200, { lines: 4 }),
    ],
  },
  {
    id: "compare", group: "graphic", label: "مقایسه", hint: "دو چیز کنار هم: قبل و بعد، این یا اون", preview: "compare-before_after",
    params: [
      { id: "kind", label: "نوع", kind: "one", default: "before_after", choices: [
        c("compare", "before_after", "قبل و بعد"), c("compare", "versus", "این یا اون"), c("compare", "right_wrong", "درست و غلط"),
      ] },
      text("right", "سمت راست", AUTO_TEXT, 24), text("left", "سمت چپ", AUTO_TEXT, 24),
    ],
  },
  {
    id: "stat", group: "graphic", label: "عدد و آمار", hint: "عدد، درصد یا نمودار که جلوی چشم پر می‌شه", preview: "stat-ring",
    params: [
      { id: "kind", label: "نوع", kind: "one", default: "ring", choices: [
        c("stat", "ring", "حلقه‌ی درصد"), c("stat", "count", "شمارنده‌ی عدد"), c("stat", "bars", "نمودار میله‌ای"),
        c("stat", "progress", "نوار پیشرفت"), c("stat", "editor", "تایم‌لاین ادیت"),
      ] },
      text("value", "عدد", "اختیاری، مثلاً ۸۰٪ یا ۱۲۰۰", 12), text("label", "توضیح کوتاه", AUTO_TEXT, 24),
    ],
  },
  {
    id: "notification", group: "graphic", label: "اعلان گوشی", hint: "یک اعلان از بالای صفحه پایین میاد", preview: "notification-message",
    params: [
      { id: "kind", label: "نوع", kind: "one", default: "message", choices: [
        c("notification", "message", "پیام"), c("notification", "email", "ایمیل"), c("notification", "follow", "فالو و لایک"),
        c("notification", "payment", "واریز پول"), c("notification", "reminder", "یادآوری"),
      ] },
      text("text", "متن اعلان", AUTO_TEXT, 60),
    ],
  },
  {
    id: "chat", group: "graphic", label: "گفت‌وگوی چت", hint: "چند پیام چت که یکی‌یکی میان", preview: "chat",
    params: [text("lines", "پیام‌ها (هر خط یک پیام، یکی در میان)", AUTO_TEXT, 160, { lines: 4 })],
  },
  {
    id: "search_bar", group: "graphic", label: "نوار جست‌وجو", hint: "یک عبارت داخل نوار جست‌وجو تایپ می‌شه", preview: "search_bar",
    params: [text("query", "عبارت جست‌وجو", AUTO_TEXT, 40)],
  },
  {
    id: "timer", group: "graphic", label: "تایمر", hint: "شمارش معکوس یا کرنومتر", preview: "timer-countdown",
    params: [
      { id: "kind", label: "نوع", kind: "one", default: "countdown", choices: [c("timer", "countdown", "شمارش معکوس"), c("timer", "stopwatch", "کرنومتر")] },
      { id: "seconds", label: "چند ثانیه", kind: "one", default: "3", choices: [plain("3", "۳"), plain("5", "۵"), plain("10", "۱۰")] },
    ],
  },
  {
    id: "callout", group: "graphic", label: "فلش و دایره", hint: "یک فلش یا دایره‌ی دست‌کشیده که به تو اشاره می‌کنه", preview: "callout-arrow",
    params: [
      { id: "kind", label: "شکل", kind: "one", default: "arrow", choices: [c("callout", "arrow", "فلش"), c("callout", "circle", "دایره دور صورت"), c("callout", "scribble", "خط‌خطی")] },
      { id: "color", label: "رنگ", kind: "one", default: "yellow", choices: COLORS("callout", ["yellow", "red", "white", "cyan"]) },
      text("label", "نوشته کنار فلش", "اختیاری، مثلاً «این منم»", 20),
    ],
  },
  {
    id: "emoji", group: "graphic", label: "ایموجی", hint: "ایموجی بزرگ که کنار سرت می‌پره یا از بالا می‌ریزه", preview: "emoji-pop",
    params: [
      { id: "mode", label: "حالت", kind: "one", default: "pop", choices: [c("emoji", "pop", "کنار سر"), c("emoji", "rain", "بارش")] },
      { id: "emojis", label: "کدوم‌ها", kind: "many", max: 4, default: [], hint: "خالی بذاری، کارگردان از حرف‌هات انتخاب می‌کنه.", choices: [
        plain("fire", "🔥"), plain("laugh", "😂"), plain("shock", "😱"), plain("heart", "❤️"), plain("like", "👍"), plain("hundred", "💯"),
        plain("eyes", "👀"), plain("party", "🎉"), plain("idea", "💡"), plain("star", "⭐"), plain("money", "💰"), plain("clap", "👏"),
      ] },
    ],
  },
  {
    id: "burst", group: "graphic", label: "انفجار کمیک", hint: "یک کلمه‌ی هیجانی داخل ستاره‌ی کمیک", preview: "burst",
    params: [text("text", "کلمه", AUTO_TEXT, 12)],
  },
  {
    id: "warning_sign", group: "graphic", label: "علامت هشدار", hint: "مثلث هشدار برای خطر یا غافلگیری", preview: "warning_sign",
    params: [text("label", "نوشته", AUTO_TEXT, 16)],
  },
  {
    id: "prohibit", group: "graphic", label: "علامت ممنوع", hint: "یک نشانه که روش خط قرمز می‌خوره", preview: "prohibit-person",
    params: [
      { id: "icon", label: "چی ممنوع", kind: "one", default: "person", choices: [
        c("prohibit", "person", "آدم"), plain("phone", "گوشی"), plain("money", "پول"), plain("clock", "وقت تلف کردن"), plain("sugar", "شیرینی"),
      ] },
      text("label", "نوشته", AUTO_TEXT, 24),
    ],
  },
  {
    id: "viewfinder", group: "graphic", label: "کادر ضبط", hint: "قاب دوربین با نشان REC روی کل تصویر", preview: "viewfinder",
    params: [text("label", "نوشته", "اختیاری، مثلاً «فیلم خام»", 20)],
  },
  {
    id: "live_voice", group: "graphic", label: "موج صدا", hint: "میله‌هایی که با صدات بالا و پایین می‌رن", preview: "live_voice-live",
    params: [{ id: "kind", label: "نوع", kind: "one", default: "live", choices: [c("live_voice", "live", "با نشان «زنده»"), c("live_voice", "wave", "فقط موج صدا")] }],
  },
  {
    id: "cta", group: "graphic", label: "دعوت به فالو و لایک", hint: "دکمه‌ای که یک انگشت روش می‌زنه", preview: "cta-follow",
    params: [{ id: "kind", label: "چه کاری", kind: "one", default: "follow", choices: [
      c("cta", "follow", "فالو"), c("cta", "like", "لایک"), c("cta", "save", "ذخیره"), c("cta", "share", "ارسال برای دوست"), c("cta", "comment", "کامنت"),
    ] }],
  },
  {
    id: "quote", group: "graphic", label: "نقل‌قول", hint: "یک جمله‌ی مهم داخل کارت نقل‌قول", preview: "quote",
    params: [text("text", "جمله", AUTO_TEXT, 90, { lines: 2 }), text("author", "گوینده", "اختیاری", 30)],
  },
  {
    id: "price_tag", group: "graphic", label: "قیمت و تخفیف", hint: "برچسب قیمت با قیمت قبلی خط‌خورده", preview: "price_tag",
    params: [text("price", "قیمت", "مثلاً ۴۹۰ هزار تومان", 24), text("old_price", "قیمت قبلی", "اختیاری", 24)],
  },
  {
    id: "location", group: "graphic", label: "مکان", hint: "نشانگر نقشه با اسم یک جا", preview: "location",
    params: [text("place", "اسم مکان", AUTO_TEXT, 30)],
  },

  // ---------------------------------------------------------------- transitions
  {
    id: "transition", group: "transition", label: "ترنزیشن", hint: "شکل رفتن از یک تکه به تکه‌ی بعد", preview: "transition-whip",
    params: [
      { id: "kinds", label: "کدوم‌ها", kind: "many", max: 6, default: [], hint: "اگه چیزی انتخاب نکنی، کارگردان از ترنزیشن‌های هم‌سبک ویدیو انتخاب می‌کنه.", choices: [
        c("transition", "whip", "چرخش تند"), c("transition", "flash", "فلش"), c("transition", "zoom_in", "زوم به داخل"),
        c("transition", "zoom_out", "زوم به بیرون"), c("transition", "glitch", "گلیچ"), c("transition", "spin", "چرخش"),
        c("transition", "slide", "کشیدن به کنار"), c("transition", "dissolve", "محو شدن"), c("transition", "blur", "تار شدن"),
        c("transition", "circle", "کرکره‌ی دایره‌ای"), c("transition", "light_leak", "نشت نور"),
      ] },
      { id: "amount", label: "چند جا", kind: "one", default: "some", choices: [plain("some", "چند جا"), plain("all", "همه‌ی برش‌ها")] },
    ],
  },

  // ---------------------------------------------------------------- structure
  { id: "cold_open", group: "structure", label: "شروع با اوج", hint: "ویدیو با یک لحظه‌ی جذاب از وسطش شروع می‌شه", preview: "cold_open", params: [] },
  { id: "rewind", group: "structure", label: "برگشت به عقب", hint: "چند ثانیه با افکت نوار ویدیو به عقب برمی‌گرده", preview: "rewind", params: [] },
  {
    id: "replay", group: "structure", label: "تکرار لحظه", hint: "یک لحظه‌ی مهم با زوم دوباره پخش می‌شه", preview: "replay",
    params: [text("label", "نوشته", "پیش‌فرض: «دوباره ببین»", 20)],
  },
  { id: "loop_end", group: "structure", label: "پایان حلقه‌ای", hint: "آخر ویدیو نرم به اولش وصل می‌شه تا بیننده دوباره ببینه", preview: "loop_end", params: [] },
];

export const OPTION_BY_ID = new Map(EDIT_OPTIONS.map((o) => [o.id, o]));
export const OPTION_IDS = new Set(EDIT_OPTIONS.map((o) => o.id));
export const optionLabel = (id: string) => OPTION_BY_ID.get(id)?.label ?? id;

// ------------------------------------------------------------------ selections
const visible = (when: Cond | undefined, params: Record<string, ParamValue>) => {
  if (!when) return true;
  const v = params[when.param];
  return typeof v === "string" ? when.in.includes(v) : Array.isArray(v) && v.some((x) => when.in.includes(x));
};
export const isVisible = visible;

/** Values with every visible param filled in: defaults first, then the creator's choices. */
export function withDefaults(sel: Selection): Record<string, ParamValue> {
  const opt = OPTION_BY_ID.get(sel.id);
  if (!opt) return { ...sel.params };
  const out: Record<string, ParamValue> = {};
  for (const p of opt.params) {
    if (p.kind === "files") { out[p.id] = Array.isArray(sel.params[p.id]) ? sel.params[p.id] : []; continue; }
    const v = sel.params[p.id];
    if (p.kind === "one") {
      const ok = (x: unknown) => typeof x === "string" && p.choices.some((ch) => ch.id === x && !ch.locked && visible(ch.when, out));
      out[p.id] = ok(v) ? (v as string) : (p.choices.find((ch) => ch.id === p.default && visible(ch.when, out))
        ?? p.choices.find((ch) => !ch.locked && visible(ch.when, out)))?.id ?? p.default;
    } else if (p.kind === "many") {
      out[p.id] = Array.isArray(v) ? v : p.default;
    } else {
      out[p.id] = typeof v === "string" ? v : p.default;
    }
  }
  return out;
}

/** Legacy v0.2 brief stored option ids as plain strings. */
const LEGACY: Record<string, Selection> = {
  app_card: { id: "list_card", params: { kind: "product" } },
  ring_counter: { id: "stat", params: { kind: "ring" } },
  nle_timeline: { id: "stat", params: { kind: "editor" } },
  no_human: { id: "prohibit", params: { icon: "person" } },
  jungle: { id: "scene", params: { source: "drawn", places: ["jungle"], style: "cartoon", scope: "background" } },
  dinosaur_walk: { id: "flyover", params: { object: "dinosaur" } },
  live_voice: { id: "live_voice", params: { kind: "live" } },
};
const LEGACY_TRANSITIONS = new Set(["whip", "flash", "zoom_in", "glitch"]);

/**
 * Cleans what the panel sends (or what an old video stored): unknown options and values are dropped,
 * strings are trimmed and capped, the same option twice is merged.
 */
export function normalizeSelections(raw: unknown): Selection[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Selection[] = [];
  const transitions: string[] = [];
  for (const item of list) {
    let sel: Selection | null = null;
    if (typeof item === "string") {
      if (LEGACY_TRANSITIONS.has(item)) { transitions.push(item); continue; }
      sel = LEGACY[item] ?? (OPTION_IDS.has(item) ? { id: item, params: {} } : null);
    } else if (item && typeof item === "object" && typeof (item as Selection).id === "string") {
      const s = item as Selection;
      sel = OPTION_IDS.has(s.id) ? { id: s.id, params: typeof s.params === "object" && s.params ? s.params : {} } : null;
    }
    if (!sel || out.some((o) => o.id === sel!.id)) continue;
    out.push({ id: sel.id, params: cleanParams(sel) });
  }
  if (transitions.length && !out.some((o) => o.id === "transition")) out.push({ id: "transition", params: { kinds: transitions } });
  return out;
}

function cleanParams(sel: Selection): Record<string, ParamValue> {
  const opt = OPTION_BY_ID.get(sel.id)!;
  const res: Record<string, ParamValue> = {};
  for (const p of opt.params) {
    const v = sel.params[p.id];
    if (v === undefined) continue;
    if (p.kind === "one" && typeof v === "string" && p.choices.some((ch) => ch.id === v && !ch.locked)) res[p.id] = v;
    if (p.kind === "text" && typeof v === "string") res[p.id] = v.trim().slice(0, p.maxLength);
    if (p.kind === "many" && Array.isArray(v)) {
      const ok = v.filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().slice(0, p.custom?.maxLength ?? 40))
        .filter((x) => x && (p.custom || p.choices.some((ch) => ch.id === x)));
      res[p.id] = [...new Set(ok)].slice(0, p.max);
    }
    if (p.kind === "files" && Array.isArray(v)) {
      res[p.id] = v.filter((x): x is string => typeof x === "string" && /^videos\/[\w-]+\/assets\/[\w.-]+$/.test(x)).slice(0, p.max);
    }
  }
  return res;
}

/** Short Persian summary of a selection, e.g. «تغییر محیط پشت سر: ساحل، فضا · کارتونی». */
export function describeSelection(sel: Selection): string {
  const opt = OPTION_BY_ID.get(sel.id);
  if (!opt) return sel.id;
  const v = withDefaults(sel);
  const bits: string[] = [];
  opt.params.forEach((p, i) => {
    if (!visible(p.when, v) || p.kind === "files" || p.kind === "text") return;
    const val = v[p.id];
    const name = (id: string) => p.choices.find((ch) => ch.id === id)?.label ?? id;
    // the main type (first param) and anything with its own preview tells the creator what they will see
    if (p.kind === "one" && typeof val === "string" && val !== "auto" && (i === 0 || p.choices.find((ch) => ch.id === val)?.preview))
      bits.push(name(val));
    if (p.kind === "many" && Array.isArray(val) && val.length) bits.push(val.map(name).join("، "));
  });
  const uniq = [...new Set(bits)];
  return uniq.length ? `${opt.label}: ${uniq.join("، ")}` : opt.label;
}

// ------------------------------------------------------------------ one theme for the whole video
export interface Theme {
  /** Look drawn over the picture. */
  look: LookStyle;
  /** Where the look applies. "whole" = the creator and the background. */
  scope: "whole" | "background" | "subject";
  skin: Skin;
  /** Option that decided the look ("" = default). */
  from: string;
  /** Things the resolver changed so the video stays consistent (shown to the creator). */
  notes: string[];
}

/** Look an option asks for, and on which part, before the video-wide resolution. */
export function requestedLook(sel: Selection): { look: LookStyle; scope: "whole" | "background" | "subject" } | null {
  const v = withDefaults(sel);
  if (sel.id === "look") {
    const style = String(v.style);
    if (!isLookStyle(style)) return null;
    return { look: style, scope: (v.scope as Theme["scope"]) ?? "whole" };
  }
  if (sel.id === "scene") {
    const scope = v.scope === "background" ? "background" : "whole";
    if (v.source === "generate") {
      const g = GEN_STYLES[String(v.gen_style)];
      if (!g) return null;   // auto
      return { look: g.look, scope: g.bgOnly ? "background" : scope };
    }
    const st = String(v.style);
    if (st !== "auto" && isLookStyle(st)) return { look: st, scope };
    // drawn places are flat illustrations: the video follows them unless the creator keeps it to the background
    if (v.source === "drawn") return { look: "cartoon", scope, };
    return null;
  }
  return null;
}

/**
 * The rule: a look picked for the whole video wins; a look picked only for the background stays there.
 * When two whole-video looks disagree, the "look" option wins, otherwise the first one picked.
 */
export function resolveTheme(selections: Selection[]): Theme {
  const reqs = selections
    .map((s) => ({ s, r: requestedLook(s) }))
    .filter((x): x is { s: Selection; r: NonNullable<ReturnType<typeof requestedLook>> } => !!x.r);
  const notes: string[] = [];
  const chosen = reqs.find((x) => x.s.id === "look") ?? reqs.find((x) => x.r.scope === "whole");
  const theme: Theme = chosen
    ? { look: chosen.r.look, scope: chosen.r.scope, skin: SKIN_OF[chosen.r.look], from: chosen.s.id, notes }
    : { look: "natural", scope: "whole", skin: "clean", from: "", notes };
  for (const x of reqs) {
    if (x === chosen || x.r.scope !== "whole" || x.r.look === theme.look) continue;
    notes.push(`«${optionLabel(x.s.id)}» با سبک «${LOOK_STYLES[theme.look]}» هماهنگ شد.`);
  }
  return theme;
}

/** Look one scene element is drawn in: its own background-only look, or the video's look. */
export function sceneLook(sel: Selection, theme: Theme): { look: LookStyle; own: boolean } {
  const r = requestedLook(sel);
  if (r && r.scope === "background") return { look: r.look, own: true };
  return { look: theme.look, own: false };
}
