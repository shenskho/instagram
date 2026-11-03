/** Types shared by api, worker and web. */

export const VIDEO_STATUSES = [
  "uploaded",            // file stored, analysis queued
  "analyzing",           // speech + vision analysis running
  "awaiting_transcript", // user must check / fix the transcript
  "directing",           // edit plan being written
  "rendering",           // engine rendering the reel
  "ready",               // output available
  "failed",
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const STATUS_LABELS_FA: Record<VideoStatus, string> = {
  uploaded: "آپلود شد",
  analyzing: "در حال تحلیل",
  awaiting_transcript: "منتظر تأیید متن",
  directing: "در حال کارگردانی",
  rendering: "در حال رندر",
  ready: "آماده",
  failed: "خطا",
};

export interface Word { w: string; s: number; e: number }
export interface TranscriptSegment { start: number; end: number; text: string; words: Word[] }

export interface StyleSettings {
  /** Big text in the first seconds. Empty = director decides. */
  hookText: string;
  /** Question shown at the end to drive comments. */
  ctaText: string;
  music: boolean;
  musicGainDb: number;
  /** How many motion graphics the director may add. */
  graphicsDensity: "low" | "normal" | "high";
  grain: boolean;
  progressBar: boolean;
  /** Seconds of silence that count as a pause worth cutting. */
  minPause: number;
}

export const DEFAULT_STYLE: StyleSettings = {
  hookText: "این ویدیو رو هیچ انسانی ادیت نکرده!",
  ctaText: "نظرت چیه؟ تو کامنت بگو",
  music: true,
  musicGainDb: -20,
  graphicsDensity: "normal",
  grain: true,
  progressBar: true,
  minPause: 0.3,
};

export type JobName = "analyze" | "direct" | "render";
export interface JobPayload { videoId: string; note?: string }

// ------------------------------------------------------------------ per-video brief
/** What the creator tells the director about one video. */
export interface Brief {
  /** The angle / point of view of the video: what it should make the viewer feel or understand. */
  pov: string;
  /** Short description of what happens on screen. Required when nobody speaks in the video. */
  description: string;
  /** Option ids (see EDIT_OPTIONS) that must appear in the reel. The director may add more. */
  options: string[];
}
export const EMPTY_BRIEF: Brief = { pov: "", description: "", options: [] };

/** One uploaded file. Several clips are joined into one source before analysis. */
export interface Clip { name: string; path: string; start?: number; end?: number }

// ------------------------------------------------------------------ edit options the user can pick
export type OptionGroup = "graphic" | "motion" | "edit";
export const OPTION_GROUPS: Array<{ id: OptionGroup; label: string; hint: string }> = [
  { id: "graphic", label: "گرافیک", hint: "چیزهایی که روی تصویر ظاهر می‌شن" },
  { id: "motion", label: "موشن و افکت", hint: "حرکت دوربین و عوض شدن محیط" },
  { id: "edit", label: "ادیت", hint: "شکل برش‌ها و ترتیب ویدیو" },
];

export interface EditOption { id: string; group: OptionGroup; label: string; hint: string }
export const EDIT_OPTIONS: EditOption[] = [
  { id: "kinetic_text", group: "graphic", label: "متن بزرگ متحرک", hint: "کلمه‌ی کلیدی با حروف درشت بالای تصویر" },
  { id: "speech_bubble", group: "graphic", label: "حباب حرف", hint: "یک کلمه‌ی کوتاه کنار سر، مثل کمیک" },
  { id: "stamp", group: "graphic", label: "مهر", hint: "برچسب مهرمانند که با ضربه می‌خوره" },
  { id: "app_card", group: "graphic", label: "کارت معرفی", hint: "کارتی با عنوان و چند ردیف که یکی‌یکی تیک می‌خورن" },
  { id: "ring_counter", group: "graphic", label: "حلقه‌ی درصد", hint: "حلقه‌ای که پر می‌شه؛ برای درصد و پیشرفت" },
  { id: "burst", group: "graphic", label: "ستاره‌ی هیجان", hint: "یک کلمه‌ی هیجانی داخل ستاره‌ی زرد" },
  { id: "warning_sign", group: "graphic", label: "تابلوی هشدار", hint: "مثلث هشدار برای خطر یا غافلگیری" },
  { id: "pill", group: "graphic", label: "برچسب کوچک", hint: "یک عبارت کوتاه داخل یک برچسب رنگی" },
  { id: "live_voice", group: "graphic", label: "نشان زنده", hint: "نشان «زنده» با میله‌هایی که با صدات بالا و پایین می‌رن" },
  { id: "viewfinder", group: "graphic", label: "قاب دوربین", hint: "قاب ضبط دوربین با نشان REC روی کل تصویر" },
  { id: "no_human", group: "graphic", label: "آدمک خط‌خورده", hint: "آدمکی که روش خط می‌خوره، همراه یک برچسب" },
  { id: "nle_timeline", group: "graphic", label: "نوار ادیت", hint: "تایم‌لاین ادیت که جلو می‌ره؛ برای «در حال ساخت»" },
  { id: "zoom_punch", group: "motion", label: "ضربه‌ی زوم", hint: "زوم سریع روی کلمه‌های مهم" },
  { id: "shake", group: "motion", label: "لرزش تصویر", hint: "تکون کوتاه روی یک لحظه‌ی مهم" },
  { id: "jungle", group: "motion", label: "جنگل پشت سر", hint: "پشت سرت جنگل می‌شه، با خورشید و صدای پرنده" },
  { id: "sky_fly", group: "motion", label: "پرواز در آسمان", hint: "پشت سرت آسمون می‌شه و تصویر شناور می‌شه" },
  { id: "dinosaur_walk", group: "motion", label: "عبور دایناسور", hint: "یک دایناسور از پشت سرت رد می‌شه" },
  { id: "whip", group: "edit", label: "ویپ", hint: "پرش سریع و کشیده بین دو برش" },
  { id: "flash", group: "edit", label: "فلش", hint: "سفید شدن کوتاه بین دو برش" },
  { id: "zoom_in", group: "edit", label: "زوم ورود", hint: "برش با زوم سریع به داخل" },
  { id: "glitch", group: "edit", label: "گلیچ", hint: "پارازیت رنگی دیجیتال بین دو برش" },
  { id: "cold_open", group: "edit", label: "شروع با اوج", hint: "ویدیو با یک لحظه‌ی جذاب از وسطش شروع می‌شه" },
  { id: "rewind", group: "edit", label: "برگشت به عقب", hint: "چند ثانیه با افکت نوار ویدیو به عقب برمی‌گرده" },
];
export const OPTION_IDS = new Set(EDIT_OPTIONS.map((o) => o.id));
export const optionLabel = (id: string) => EDIT_OPTIONS.find((o) => o.id === id)?.label ?? id;

/** Where an option shows up in the finished reel (output seconds). */
export interface UsageItem { id: string; out: number; auto: boolean }

/** Edit plan (EDL) consumed by the Python engine. Kept loose: the engine validates it. */
export interface EditPlan {
  _comment?: string;
  source: string;
  output: { path: string; w: number; h: number; fps: number };
  timeline: Array<{ src: [number, number]; role?: string; zoom?: number | "auto"; push?: number; transition_in?: string; reverse?: boolean; speed?: number; captions?: boolean; voice?: boolean }>;
  captions: Array<{ t0: number; t1: number; text: string; emph?: string[]; static?: boolean }>;
  graphics: Array<Record<string, unknown> & { type: string }>;
  effects: Array<Record<string, unknown> & { type: string; t0: number; t1: number }>;
  sfx: Array<Record<string, unknown> & { type: string }>;
  zoom?: { slow_push_per_sec?: number; punches?: Array<{ t: number; mul?: number; to?: number; ease: number }> };
  auto_zoom?: { target_head_px: number; max: number };
  grade?: Record<string, number>;
  grain?: number;
  shakes?: Array<{ t: number; amp: number; dur: number }>;
  audio?: { voice_chain?: string; music?: { gain_db?: number; off?: boolean; bpm?: number } };
  matting?: { clean_plate?: boolean };
  progress_bar?: boolean;
  /** Written by the director: every option it used and where (output seconds). */
  _usage?: UsageItem[];
  [k: string]: unknown;
}

/** Output length of one timeline segment, frame-exact like the engine. */
export function segmentSeconds(s: EditPlan["timeline"][number], fps = 30): number {
  const n = Math.ceil(s.src[1] * fps - 1e-6) - Math.ceil(s.src[0] * fps - 1e-6);
  return (s.reverse ? Math.ceil(n / (s.speed ?? 1)) : n) / fps;
}

/** Output time where source time t is first shown in the main (non-role) timeline, or null if it was cut. */
export function srcToOut(plan: Pick<EditPlan, "timeline" | "output">, t: number): number | null {
  const fps = plan.output?.fps ?? 30;
  let acc = 0;
  for (const s of plan.timeline) {
    if (!s.role && !s.reverse && s.src[0] <= t && t < s.src[1]) return round2(acc + (t - s.src[0]));
    acc += segmentSeconds(s, fps);
  }
  return null;
}

/** Output start of each timeline segment. */
export function segmentStarts(plan: Pick<EditPlan, "timeline" | "output">): number[] {
  const fps = plan.output?.fps ?? 30;
  let acc = 0;
  return plan.timeline.map((s) => { const a = acc; acc += segmentSeconds(s, fps); return round2(a); });
}

/**
 * Re-time a segment after the user edits its text. New words are laid over the *speech* intervals of the
 * original words (pauses stay pauses), proportionally to their length. Keeps cuts and caption sync sane.
 */
export function retimeSegment(seg: TranscriptSegment, newText: string): TranscriptSegment {
  const text = newText.trim().replace(/\s+/g, " ");
  if (text === seg.text.trim().replace(/\s+/g, " ")) return { ...seg, text };
  const words = text.split(" ").filter(Boolean);
  const base: Array<[number, number]> = seg.words?.length ? seg.words.map((w): [number, number] => [w.s, w.e]) : [[seg.start, seg.end]];
  const spans = base
    .filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  if (!spans.length) spans.push([seg.start, Math.max(seg.start + 0.05, seg.end)]);
  const speech = spans.reduce((t, [a, b]) => t + (b - a), 0);
  // map "speech time" (pauses removed) back to real time
  const toReal = (x: number) => {
    let acc = 0;
    for (const [a, b] of spans) {
      if (x <= acc + (b - a)) return a + (x - acc);
      acc += b - a;
    }
    return spans[spans.length - 1][1];
  };
  const weights = words.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let pos = 0;
  const out: Word[] = words.map((w, i) => {
    const d = (speech * weights[i]) / total;
    const word = { w, s: round2(toReal(pos + 0.001)), e: round2(toReal(pos + d - 0.001)) };
    pos += d;
    return word;
  });
  return { ...seg, text, words: out };
}

export const round2 = (x: number) => Math.round(x * 100) / 100;
