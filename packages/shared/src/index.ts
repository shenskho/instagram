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

export * from "./catalog";
import type { Selection } from "./catalog";

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

export type JobName = "analyze" | "direct" | "render" | "imagegen";
export interface JobPayload { videoId: string; note?: string }
/** Preview of one generated background (panel → worker). */
export interface ImagegenPayload { key: string; text: string; style: string }

/** Cache key of a generated image: the same text and style always give the same file. */
export function imagegenKey(text: string, style: string): string {
  const s = `v1|${text.replace(/\u200c/g, " ").replace(/\s+/g, " ").trim()}|${style}`;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ------------------------------------------------------------------ per-video brief
/** What the creator tells the director about one video. */
export interface Brief {
  /** The angle / point of view of the video: what it should make the viewer feel or understand. */
  pov: string;
  /** Short description of what happens on screen. Required when nobody speaks in the video. */
  description: string;
  /** Options the creator picked (see EDIT_OPTIONS), with their details. Each must appear in the reel; the director may add more. */
  options: Selection[];
}
export const EMPTY_BRIEF: Brief = { pov: "", description: "", options: [] };

/** One uploaded file. Several clips are joined into one source before analysis. */
export interface Clip { name: string; path: string; start?: number; end?: number }

/** Where an option shows up in the finished reel (output seconds). */
export interface UsageItem { id: string; out: number; auto: boolean; /** what exactly, e.g. «ساحل» */ label?: string }

/** Edit plan (EDL) consumed by the Python engine. Kept loose: the engine validates it. */
export interface EditPlan {
  _comment?: string;
  source: string;
  output: { path: string; w: number; h: number; fps: number };
  timeline: Array<{ src: [number, number]; role?: string; zoom?: number | "auto"; push?: number; transition_in?: string; reverse?: boolean; speed?: number; captions?: boolean; voice?: boolean; /** freeze frame: hold the first frame this many seconds */ hold?: number }>;
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
  /** Whole-video look (autoedit/looks.py) and where it applies. */
  look?: { style: string; scope: "whole" | "background" | "subject" };
  /** How graphics and captions are drawn so they match the look. */
  skin?: string;
  /** Texture over the whole video: grain, vhs, light_leak, bars, dust, vignette. */
  overlays?: string[];
  /** Blend the last frames into the first one so the reel loops. */
  loop_end?: boolean;
  /** Written by the director: every option it used and where (output seconds). */
  _usage?: UsageItem[];
  /** Picked options that did not fit (video too short). */
  _missing?: string[];
  /** Notes for the creator about the theme (e.g. a style that was matched to the rest). */
  _notes?: string[];
  [k: string]: unknown;
}

/** Output length of one timeline segment, frame-exact like the engine. */
export function segmentSeconds(s: EditPlan["timeline"][number], fps = 30): number {
  if (s.hold) return Math.max(1, Math.round(s.hold * fps)) / fps;
  const n = Math.max(1, Math.ceil(s.src[1] * fps - 1e-6) - Math.ceil(s.src[0] * fps - 1e-6));
  return (s.reverse ? Math.ceil(n / (s.speed ?? 1)) : n) / fps;
}

/** Output time where source time t is first shown in the main (non-role) timeline, or null if it was cut. */
export function srcToOut(plan: Pick<EditPlan, "timeline" | "output">, t: number): number | null {
  const fps = plan.output?.fps ?? 30;
  let acc = 0;
  for (const s of plan.timeline) {
    if (!s.role && !s.reverse && !s.hold && s.src[0] <= t && t < s.src[1]) return round2(acc + (t - s.src[0]));
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
