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

/** Edit plan (EDL) consumed by the Python engine. Kept loose: the engine validates it. */
export interface EditPlan {
  _comment?: string;
  source: string;
  output: { path: string; w: number; h: number; fps: number };
  timeline: Array<{ src: [number, number]; role?: string; zoom?: number | "auto"; push?: number; transition_in?: string; reverse?: boolean; speed?: number; captions?: boolean; voice?: boolean }>;
  captions: Array<{ t0: number; t1: number; text: string; emph?: string[] }>;
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
  [k: string]: unknown;
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
