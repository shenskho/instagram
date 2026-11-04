/**
 * Rule-based director: a deterministic baseline that needs no API key.
 * It does what a careful junior editor would do from the transcript alone: cut pauses, keep the speaker
 * framed, caption in short chunks, put a hook first and a CTA last, and illustrate recognisable phrases.
 *
 * v0.2: silent videos (the description becomes on-screen text), joined clips, point of view, picked options.
 * v0.3: every picked option comes with its details (type, place names, colours, texts) and the whole video
 *       follows one theme (resolveTheme): a look for the picture, a skin for graphics, a family of transitions.
 * The Claude director (step 3) replaces it and can reason about the point of view and description freely.
 */
import type { EditPlan, Word, Brief, UsageItem, Selection, ParamValue, Theme, LookStyle } from "@autoreel/shared";
import {
  round2, srcToOut, segmentStarts, segmentSeconds, OPTION_IDS, EMPTY_BRIEF, normalizeSelections, withDefaults,
  resolveTheme, requestedLook, SKIN_TRANSITIONS, GEN_STYLES, LOOK_STYLES, DRAWN_PLACES, optionLabel, OPTION_BY_ID, describeSelection,
} from "@autoreel/shared";
import type { Director, DirectorInput } from "./types.ts";

// ====================================================================== text helpers
const STOP = new Set(["و", "که", "از", "به", "با", "در", "این", "اون", "یه", "یک", "را", "رو", "هم", "تا", "برای", "من", "تو", "ما", "شما", "اگه", "یا", "هست", "است", "بود", "می‌خوام", "دارم",
  "واقع", "بهتون", "اینکه", "دارین", "ویدیو", "ویدیوی", "میشه", "می‌شه", "کنم", "کردم", "دوستان", "همین", "خیلی", "باید", "میخوام", "می‌کنم", "بعد",
  "چون", "ولی", "اما", "اگر", "هر", "همه", "چی", "چیه", "چه", "کجا", "وقتی", "بشه", "کنه", "کنید", "کنین", "داره", "دارن", "هستن", "هستم", "نیست", "بیشتر", "کمتر"]);
const PUNCT_END = /[،.!؟?!:]$/;
const norm = (w: string) => w.replace(/[،.!؟?!:«»"'()]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/‌/g, "");
const strip = (w: string) => w.replace(/^[!؟،.]+|[!؟،.]+$/g, ""); // same stripping the engine uses for emphasis
/** Conjugated verbs make weak on-screen words («می‌خواد», «دارین»); nouns and adjectives read better. */
const verbish = (w: string) => /^ن?می/.test(norm(w)) || /(ین|ید|یم|ند)$/.test(norm(w)) && norm(w).length <= 6;
const emphRank = (w: string, keys: string[]) => (matchesKey(w, keys) ? 10 : 0) - (verbish(w) ? 6 : 0) + norm(w).length;
const clean = (t: string) => t.replace(/^[\s،.!؟?:]+|[\s،.!؟?:]+$/g, "");
const shorten = (text: string, words: number, chars: number) => {
  const ws = text.split(/\s+/).filter(Boolean).slice(0, words);
  while (ws.length > 1 && ws.join(" ").length > chars) ws.pop();
  return ws.join(" ");
};
function keywords(text: string): string[] {
  return [...new Set(text.split(/\s+/).map(norm).filter((w) => w.length >= 3 && !STOP.has(w)))];
}
const matchesKey = (w: string, keys: string[]) => {
  const n = norm(w);
  return n.length >= 3 && keys.some((k) => n === k || (k.length >= 4 && (n.startsWith(k) || k.startsWith(n) && n.length >= 4)));
};
const FA = "۰۱۲۳۴۵۶۷۸۹";
const toLatin = (s: string) => s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)));
const str = (v: ParamValue | undefined) => (typeof v === "string" ? v : "");
const list = (v: ParamValue | undefined) => (Array.isArray(v) ? v : []);
const lines = (v: ParamValue | undefined) => str(v).split(/\n+/).map((s) => s.trim()).filter(Boolean);

/** Emoji the creator's words call for (used when they picked emoji without choosing which). */
const EMOJI_WORDS: Array<[RegExp, string]> = [
  [/^(خنده|خندیدم|بخند|شوخی)/, "laugh"], [/^(آتش|داغ|ترکوند|ترکید)/, "fire"], [/^(عالی|بی‌نظیر|بینظیر|کامل|صددرصد)/, "hundred"],
  [/^(ترس|وحشت|وای|باورنکردنی|شوکه)/, "shock"], [/^(عشق|دوست|قلب)/, "heart"], [/^(پول|درآمد|تومان|دلار|سود)/, "money"],
  [/^(ایده|فکر|راه‌حل)/, "idea"], [/^(ببین|نگاه|دیدی)/, "eyes"], [/^(تبریک|جشن|تولد)/, "party"], [/^(آفرین|دمت|ممنون)/, "clap"],
  [/^(بهترین|ستاره)/, "star"], [/^(خوب|موافق|اوکی)/, "like"],
];
const CITY = /^(تهران|تبریز|اصفهان|شیراز|مشهد|یزد|کیش|کاشان|رشت|کرمان|قشم|دبی|استانبول|پاریس|لندن)$/;

// ====================================================================== phrase rules (director's own choices)
type Spec = Record<string, unknown> & { type: string };
interface Rule { opt: string; test: (w: string, prev: string[]) => boolean; make: (t: number, dur: number) => { g: Spec; sfx?: Spec[]; dur?: number } }
const RULES: Rule[] = [
  { opt: "speech_bubble", test: (w) => /^سلام/.test(w), make: () => ({ g: { type: "speech_bubble", text: "سلام!", x: 850, y: 470 }, sfx: [{ type: "pop" }], dur: 1.2 }) },
  { opt: "stamp", test: (w) => /^(تست|تستی|آزمایشی)$/.test(w), make: () => ({ g: { type: "stamp", text: "نسخه تستی", sub: "آزمایشی", x: 540, y: 290, angle: -8 }, sfx: [{ type: "stamp" }], dur: 1.0 }) },
  { opt: "viewfinder", test: (w) => /^(ضبط|خام|خامه)/.test(w), make: () => ({ g: { type: "viewfinder", label: "فیلم خام" }, sfx: [{ type: "beep" }], dur: 2.0 }) },
  { opt: "stat", test: (w) => /^(ادیت|تدوین)/.test(w), make: (_t, d) => ({ g: { type: "nle_timeline", y: 240, work: Math.max(0.8, d * 0.75) }, sfx: [{ type: "ticks", dur: Math.max(0.8, d * 0.7) }], dur: 1.8 }) },
  { opt: "kinetic_text", test: (w, p) => w === "مصنوعی" && p.at(-1) === "هوش", make: () => ({ g: { type: "kinetic_text", y: 260, lines: [{ text: "هوش مصنوعی", size: 124, color: "accent" }] }, sfx: [{ type: "pop" }], dur: 1.3 }) },
  { opt: "prohibit", test: (w, p) => /^(انسان|آدم)/.test(w) && p.slice(-3).includes("بدون"), make: (_t, d) => ({ g: { type: "prohibit", icon: "person", x: 300, y: 250, slash_at: Math.min(0.6, d * 0.4), label: "۰٪ دخالت انسان" }, sfx: [{ type: "pop" }], dur: 1.6 }) },
  { opt: "live_voice", test: (w) => /^(الان|زنده|لایو)$/.test(w), make: () => ({ g: { type: "live_voice", text: "زنده · همین الان", x: 540, y: 170 }, sfx: [{ type: "beep" }], dur: 2.0 }) },
  { opt: "burst", test: (w) => /^افکت/.test(w), make: () => ({ g: { type: "burst", text: "افکت!", x: 290, y: 330 }, sfx: [{ type: "pop" }], dur: 1.3 }) },
  { opt: "stat", test: (w) => /^(کامل|کاملاً|کاملا|درصد)$/.test(w), make: () => ({ g: { type: "ring_counter", x: 540, y: 270, label: "کامل", fill: 0.6 }, sfx: [{ type: "riser", dur: 0.6 }], dur: 1.0 }) },
  { opt: "warning_sign", test: (w) => /^(خطر|مراقب|هشدار)/.test(w), make: () => ({ g: { type: "warning_sign", x: 250, y: 290, label: "هشدار!" }, sfx: [{ type: "pop" }], dur: 1.6 }) },
  { opt: "search_bar", test: (w) => /^(گوگل|سرچ|جستجو|جست‌وجو)/.test(w), make: () => ({ g: { type: "search_bar", y: 330 }, sfx: [{ type: "ticks", dur: 1.2 }], dur: 2.2 }) },
  { opt: "cta", test: (w) => /^(فالو|دنبال)/.test(w), make: () => ({ g: { type: "cta", kind: "follow", y: 1660 }, sfx: [{ type: "click", t_off: 0.9 }], dur: 1.8 }) },
];

const DENSITY_GAP = { low: 6, normal: 3.5, high: 2.2 } as const;
const GRAPHIC_DUR: Record<string, number> = {
  kinetic_text: 1.5, speech_bubble: 1.3, stamp: 1.1, pill: 1.6, lower_third: 2.6, list_card: 2.8, compare: 2.3, stat: 1.8,
  notification: 2.3, chat: 3.0, search_bar: 2.4, timer: 3.6, callout: 1.8, emoji: 1.8, burst: 1.3, warning_sign: 1.6,
  prohibit: 1.6, viewfinder: 2.0, live_voice: 2.0, cta: 2.0, quote: 2.6, price_tag: 1.8, location: 1.8,
};
const GRAPHIC_ORDER = Object.keys(GRAPHIC_DUR);
const EFFECT_LEN: Record<string, number> = { scene: 4.2, sky_fly: 2.6, flyover: 3.2, particles: 3.0, focus: 2.6, glow: 2.6, clones: 2.6 };

// ====================================================================== plan builder
export interface Keep {
  a: number; b: number; clip: number; silent: boolean; tr?: string; trAuto?: boolean; zoom?: number | "auto"; push?: number;
  freezeAfter?: boolean;
}
interface Moment { t: number; end: number; text: string; word: string; key: boolean; emph: boolean; used?: boolean }
type Caption = EditPlan["captions"][number];
type Tagged = Record<string, unknown> & { _opt?: string; _auto?: boolean; _label?: string };
/** Usage that is not tied to a graphic or effect (looks, slow zoom, loop ending…). */
interface Mark { id: string; t?: number; out?: number; auto: boolean; label?: string }

export interface BuilderFlags {
  hook: boolean; cta: boolean; autoRules: boolean; pacing: boolean;
  /** Force every graphic into this source window (used to render option previews). */
  window?: [number, number];
}
const DEFAULT_FLAGS: BuilderFlags = { hook: true, cta: true, autoRules: true, pacing: true };

export class PlanBuilder {
  readonly D: number;
  readonly brief: Brief;
  /** Picked options with every detail filled in (defaults where the creator chose nothing). */
  readonly picks: Map<string, Record<string, ParamValue>>;
  readonly selections: Selection[];
  readonly theme: Theme;
  readonly keys: string[];
  words: Word[] = [];
  keeps: Keep[] = [];
  captions: Caption[] = [];
  moments: Moment[] = [];
  graphics: Array<Spec & Tagged> = [];
  effects: Array<Spec & Tagged & { t0: number; t1: number }> = [];
  sfx: Spec[] = [];
  punches: Array<{ t: number; mul: number; ease: number } & Tagged> = [];
  shakes: Array<{ t: number; amp: number; dur: number } & Tagged> = [];
  tilts: Array<{ t: number; angle: number; dur: number } & Tagged> = [];
  marks: Mark[] = [];
  busy: Array<[number, number]> = [];
  reserved: Array<[number, number]> = [];
  coldOpen?: { a: number; b: number; zoom: number | "auto" };
  /** Inserted after the keep that ends at `after` (source seconds; keep indexes shift when keeps are split). */
  rewindAfter?: { after: number; a: number; b: number };
  replayAfter?: { after: number; a: number; b: number; label: string };
  freeze?: { frame: string; label: string };
  hookLines: Array<{ text: string; size: number; color: string }> = [];
  notes: string[] = [];

  constructor(readonly input: DirectorInput, readonly flags: BuilderFlags = DEFAULT_FLAGS) {
    this.D = input.analysis.info.duration;
    this.brief = { ...EMPTY_BRIEF, ...(input.brief ?? {}) } as Brief;
    this.selections = normalizeSelections(this.brief.options);
    this.picks = new Map(this.selections.map((s) => [s.id, withDefaults(s)]));
    this.theme = resolveTheme(this.selections);
    this.notes.push(...this.theme.notes);
    this.keys = keywords(this.brief.pov);
  }

  has(id: string) { return this.picks.has(id); }
  p(id: string) { return this.picks.get(id) ?? {}; }

  // ---------------------------------------------------------------- queries
  keepAt(t: number) { return this.keeps.findIndex((k) => t >= k.a && t < k.b); }
  shown(t: number) { return this.keepAt(t) >= 0; }
  keepEnd(t: number) { const i = this.keepAt(t); return i >= 0 ? this.keeps[i].b : t; }
  free(a: number, b: number) { return !this.busy.some(([x, y]) => a < y && x < b); }
  isReserved(a: number, b: number) { return this.reserved.some(([x, y]) => a < y && x < b); }
  distToBusy(t: number) { return this.busy.length ? Math.min(...this.busy.map(([x, y]) => (t < x ? x - t : t > y ? t - y : 0))) : 8; }
  inWindow(a: number, b: number) { const w = this.flags.window; return !w || (a >= w[0] - 1e-6 && b <= w[1] + 1e-6); }
  totalShown() { return this.keeps.reduce((t, k) => t + (k.b - k.a), 0); }
  /** Position of source time t in the reel, 0..1. */
  posOf(t: number) { return this.shownBetween(-1, t) / Math.max(1e-6, this.totalShown()); }
  headX(t: number) {
    const tr = this.input.analysis.person_track.filter((r) => r.present && r.head_x !== undefined);
    if (!tr.length) return 0.5;
    return tr.reduce((best, r) => (Math.abs(r.t - t) < Math.abs(best.t - t) ? r : best)).head_x ?? 0.5;
  }

  // ---------------------------------------------------------------- 1. words (speech-to-text stretches words over silences)
  prepareWords() {
    const { analysis, transcript } = this.input;
    const words: Word[] = transcript.flatMap((s) => s.words ?? []).filter((w) => w.w.trim()).map((w) => ({ ...w })).sort((a, b) => a.s - b.s);
    for (const [a, b] of analysis.pauses) {
      if (b - a < 0.15) continue;
      for (const w of words) {
        if (w.s < a && w.e > a) w.e = Math.max(w.s + 0.05, a);
        else if (w.s >= a && w.s < b) { const d = Math.max(0.12, w.e - w.s); w.s = b; w.e = Math.max(w.e, b + Math.min(d, 0.4)); }
      }
    }
    words.sort((x, y) => x.s - y.s);
    for (let i = 1; i < words.length; i++) if (words[i].s < words[i - 1].s + 0.06) words[i].s = round2(words[i - 1].s + 0.06);
    this.words = words;
  }

  // ---------------------------------------------------------------- 2. what stays (per clip)
  buildKeeps() {
    const { analysis, style } = this.input;
    const clips: Array<[number, number]> = this.flags.window ? [this.flags.window]
      : this.input.clips?.length ? this.input.clips.map((c) => [c.start, Math.min(c.end, this.D)]) : [[0, this.D]];
    clips.forEach(([cs, ce], ci) => {
      const ws = this.words.filter((w) => w.s >= cs && w.s < ce);
      if (!ws.length) { this.keeps.push({ a: round2(cs), b: round2(ce), clip: ci, silent: true }); return; }
      const s0 = Math.max(cs, ws[0].s - 0.12), s1 = Math.min(ce, ws.at(-1)!.e + 0.3);
      const cuts: Array<[number, number]> = [];
      for (const [a, b] of analysis.pauses) {
        if (b - a < style.minPause || a <= s0 || b >= s1) continue;
        const ca = a + 0.08, cb = b - 0.08;
        if (ws.some((w) => w.s >= ca && w.e <= cb)) continue;
        cuts.push([ca, cb]);
      }
      let ks: Array<[number, number]> = [];
      let t = s0;
      for (const [a, b] of cuts) { ks.push([t, a]); t = b; }
      ks.push([t, s1]);
      ks = ks.reduce<Array<[number, number]>>((acc, k) => {
        if (acc.length && k[1] - k[0] < 0.5) acc[acc.length - 1][1] = k[1]; else acc.push([...k] as [number, number]);
        return acc;
      }, []);
      for (const [a, b] of ks) this.keeps.push({ a: round2(a), b: round2(b), clip: ci, silent: false });
    });
  }

  splitAt(t: number, minPart = 0.4): number {
    t = round2(t);
    const i = this.keeps.findIndex((k) => t > k.a - 1e-6 && t < k.b);
    if (i < 0) return -1;
    const k = this.keeps[i];
    if (Math.abs(t - k.a) < 1e-6) return i;
    if (t - k.a < minPart || k.b - t < minPart) return -1;
    this.keeps.splice(i, 1, { ...k, b: t, freezeAfter: false }, { ...k, a: t, tr: undefined, trAuto: undefined });
    return i + 1;
  }

  // ---------------------------------------------------------------- 3. captions (speech + on-screen description)
  buildCaptions() {
    const captions: Caption[] = [];
    let cur: Word[] = [];
    const flush = (next?: Word) => {
      if (!cur.length) return;
      const text = cur.map((w) => w.w).join(" ");
      const t0 = cur[0].s;
      let t1 = next ? Math.min(next.s, cur.at(-1)!.e + 0.35) : cur.at(-1)!.e + 0.3;
      t1 = Math.max(t1, t0 + 0.35);
      const cands = cur.map((w) => strip(w.w)).filter((w) => norm(w).length >= 4 && !STOP.has(norm(w)));
      cands.sort((a, b) => emphRank(b, this.keys) - emphRank(a, this.keys));
      captions.push({ t0: round2(t0), t1: round2(t1), text, ...(cands.length ? { emph: [cands[0]] } : {}) });
      cur = [];
    };
    const words = this.words.filter((w) => this.shown(w.s));
    words.forEach((w, i) => {
      const prev = cur.at(-1);
      if (prev && (cur.length >= 4 || w.s - prev.e > 0.25 || w.e - cur[0].s > 1.9 || PUNCT_END.test(prev.w) || this.keepAt(w.s) !== this.keepAt(prev.s) && w.s - prev.e > 0.1)) flush(w);
      cur.push(w);
      if (i === words.length - 1) flush();
    });
    for (let i = 0; i < captions.length; i++) {
      const c = captions[i], n = captions[i + 1], p = captions[i - 1];
      if (c.text.split(" ").length > 1) continue;
      if (n && n.t0 - c.t1 < 0.7 && n.text.split(" ").length <= 4) {
        n.text = `${c.text} ${n.text}`; n.t0 = c.t0; n.emph = n.emph ?? c.emph; captions.splice(i, 1); i--;
      } else if (p && c.t0 - p.t1 < 0.7 && p.text.split(" ").length <= 4) {
        p.text = `${p.text} ${c.text}`; p.t1 = c.t1; captions.splice(i, 1); i--;
      }
    }
    for (let i = 0; i + 1 < captions.length; i++) captions[i].t1 = Math.min(captions[i].t1, captions[i + 1].t0);
    for (const c of captions) {
      const k = this.keepAt(c.t0);
      if (k >= 0 && (k === this.keeps.length - 1 || this.keeps[k + 1].clip !== this.keeps[k].clip)) c.t1 = round2(Math.min(c.t1, this.keeps[k].b));
    }
    this.captions = captions;
    this.describeSilentParts();
  }

  describeSilentParts() {
    const silent = this.keeps.filter((k) => k.silent);
    const text = this.brief.description.trim();
    if (!silent.length || !text) return;
    const chunks: string[] = [];
    for (const sentence of text.split(/[\n.!؟?،,؛;]+/).map((s) => s.trim()).filter(Boolean)) {
      const ws = sentence.split(/\s+/);
      const n = Math.ceil(ws.length / 4);
      const size = Math.ceil(ws.length / n);
      for (let i = 0; i < ws.length; i += size) chunks.push(ws.slice(i, i + size).join(" "));
    }
    if (!chunks.length) return;
    const total = silent.reduce((t, k) => t + (k.b - k.a), 0);
    const want = chunks.map((c) => Math.min(2.6, Math.max(1.3, 0.45 * c.split(" ").length + 0.6)));
    const scale = Math.min(1, (total - 0.3 * chunks.length) / want.reduce((a, b) => a + b, 0));
    const durs = want.map((d) => Math.max(0.9, d * scale));
    const gap = Math.max(0.15, Math.min(1.2, (total - durs.reduce((a, b) => a + b, 0)) / (chunks.length + 1)));
    let ki = 0, t = silent[0].a + Math.min(gap, 0.6);
    chunks.forEach((c, i) => {
      while (ki < silent.length && t + durs[i] > silent[ki].b + 1e-6) { ki++; if (ki < silent.length) t = silent[ki].a + 0.15; }
      if (ki >= silent.length) return;
      const cands = c.split(" ").map(strip).filter((w) => norm(w).length >= 3 && !STOP.has(norm(w))).sort((a, b) => emphRank(b, this.keys) - emphRank(a, this.keys));
      this.captions.push({ t0: round2(t), t1: round2(t + durs[i]), text: c, static: true, ...(cands.length ? { emph: [cands[0]] } : {}) });
      t += durs[i] + gap;
    });
    this.captions.sort((a, b) => a.t0 - b.t0);
  }

  // ---------------------------------------------------------------- 4. moments: where a graphic could go
  buildMoments() {
    this.moments = this.captions.filter((c) => this.shown(c.t0)).map((c) => ({
      t: c.t0, end: this.keepEnd(c.t0), text: clean(c.text), word: c.emph?.[0] ?? "",
      key: c.text.split(" ").some((w) => matchesKey(w, this.keys)), emph: !!c.emph?.length,
    }));
    for (const k of this.keeps) {
      for (let t = k.a + 0.4; t < k.b - 0.8; t += 2.6) {
        if (this.moments.some((m) => Math.abs(m.t - t) < 1.2)) continue;
        this.moments.push({ t: round2(t), end: k.b, text: "", word: "", key: false, emph: false });
      }
    }
    this.moments.sort((a, b) => a.t - b.t);
  }

  // ---------------------------------------------------------------- 5. hook + CTA windows
  reserveHookAndCta() {
    const { style } = this.input;
    const first = this.keeps[0], last = this.keeps.at(-1)!;
    if (this.flags.hook && style.hookText.trim()) {
      const ws = style.hookText.trim().split(/\s+/);
      const cut = ws.length > 3 ? Math.ceil(ws.length / 3) : ws.length;
      this.hookLines = [{ text: ws.slice(0, cut).join(" "), size: 120, color: "accent" }];
      if (cut < ws.length) this.hookLines.push({ text: ws.slice(cut).join(" "), size: 80, color: "white" });
      if (!this.has("cold_open")) this.reserved.push([first.a, first.a + 2.3]);
    }
    if (this.flags.cta && style.ctaText.trim() && last.b - last.a > 1.2) this.reserved.push([Math.max(last.a, last.b - 2.2), last.b]);
  }

  finishHookAndCta() {
    const { style } = this.input;
    const first = this.keeps[0], last = this.keeps.at(-1)!;
    if (this.hookLines.length && !this.coldOpen) {
      const t1 = round2(Math.min(first.b, first.a + 2.3));
      this.graphics.unshift({ type: "kinetic_text", t0: first.a, t1, y: 230, lines: this.hookLines, _line: "hook" });
      this.sfx.push({ type: "impact", t: first.a });
      this.busy.push([first.a, t1]);
    }
    if (this.flags.cta && style.ctaText.trim() && last.b - last.a > 1.2) {
      const t0 = round2(Math.max(last.a, last.b - 2.2));
      this.graphics.push({ type: "pill", text: style.ctaText.trim(), bg: "purple", x: 540, y: 230, size: 48, t0, t1: last.b, _line: "CTA" });
      this.sfx.push({ type: "pop", t: t0 });
    }
  }

  // ---------------------------------------------------------------- slot pickers
  /** Best free moment for a graphic of `dur` seconds. Constraints relax until something fits (picked options must appear). */
  pick(dur: number, minDur = 0.8, prefer?: "early" | "late"): { m: Moment; t0: number; t1: number } | null {
    const gap = DENSITY_GAP[this.input.style.graphicsDensity] * 0.6;
    const nextReserved = (t: number) => Math.min(Infinity, ...this.reserved.filter(([x]) => x > t).map(([x]) => x));
    const cands = this.moments.filter((m) => this.shown(m.t)).map((m) => {
      const t1 = round2(Math.min(m.end, m.t + dur, nextReserved(m.t)));
      return { m, t0: round2(m.t), t1 };
    }).filter((c) => c.t1 - c.t0 >= Math.min(minDur, dur) - 1e-6 && this.inWindow(c.t0, c.t1));
    const levels: Array<(c: { m: Moment; t0: number; t1: number }) => boolean> = [
      (c) => !c.m.used && !this.isReserved(c.t0, c.t1) && this.free(c.t0, c.t1) && this.distToBusy(c.t0) >= gap,
      (c) => !c.m.used && !this.isReserved(c.t0, c.t1) && this.free(c.t0, c.t1),
      (c) => !this.isReserved(c.t0, c.t1) && this.free(c.t0, c.t1),
      (c) => !this.isReserved(c.t0, c.t1),
      () => true,
    ];
    for (const ok of levels) {
      const fit = cands.filter(ok);
      if (!fit.length) continue;
      const where = (t: number) => (prefer === "late" ? this.posOf(t) * 3 : prefer === "early" ? (1 - this.posOf(t)) * 3 : 0);
      const score = (c: typeof fit[number]) => (c.m.key ? 3 : 0) + (c.m.emph ? 1 : 0) + (c.m.text ? 0.5 : 0) + Math.min(this.distToBusy(c.t0), 8) / 2 + where(c.t0);
      return fit.reduce((a, b) => (score(b) > score(a) ? b : a));
    }
    const k = this.keeps.filter((x) => this.inWindow(x.a, x.b)).sort((x, y) => (y.b - y.a) - (x.b - x.a))[0] ?? this.keeps[0];
    const t0 = round2(Math.max(k.a, (k.a + k.b) / 2 - dur / 2));
    return { m: { t: t0, end: k.b, text: "", word: "", key: false, emph: false }, t0, t1: round2(Math.min(k.b, t0 + dur)) };
  }

  shownBetween(a: number, b: number) { return this.keeps.reduce((t, k) => t + Math.max(0, Math.min(b, k.b) - Math.max(a, k.a)), 0); }

  /**
   * A window for an effect: `len` seconds of the reel, which may run across cuts inside one clip,
   * never into the hook / CTA or another effect (unless `overlap` is allowed).
   */
  pickWindow(len: number, minLen = 1.8, overlap = false): [number, number] | null {
    let best: { a: number; b: number; s: number } | null = null;
    const others = overlap ? [] : this.effects.filter((e) => e.type !== "sun");
    const starts = [...this.keeps.map((k) => k.a), ...this.moments.map((m) => m.t)].filter((t) => this.shown(t));
    for (const a of starts) {
      let i = this.keepAt(a), b = a, got = 0;
      while (i >= 0 && i < this.keeps.length) {
        const k = this.keeps[i];
        if (k.clip !== this.keeps[this.keepAt(a)].clip) break;
        let hi = k.b;
        for (const [x, y] of this.reserved) if (x < hi && y > Math.max(a, k.a)) hi = Math.min(hi, x);
        for (const e of others) if (e.t0 < hi && e.t1 > Math.max(a, k.a)) hi = Math.min(hi, e.t0);
        if (this.flags.window) hi = Math.min(hi, this.flags.window[1]);
        const from = Math.max(a, k.a);
        if (hi <= from) break;
        const take = Math.min(hi - from, len - got);
        got += take; b = from + take;
        if (got >= len - 1e-6 || hi < k.b) break;
        i++;
      }
      if (got < minLen || this.isReserved(a, a + 0.05) || others.some((e) => a >= e.t0 && a < e.t1)) continue;
      if (this.flags.window && a < this.flags.window[0]) continue;
      const m = this.moments.find((x) => Math.abs(x.t - a) < 0.05);
      const s = (got / len) * 3 - Math.abs(this.posOf(a) - 0.55) * 2 + (m?.key ? 1.5 : 0) + (m?.emph ? 0.3 : 0);
      if (!best || s > best.s) best = { a, b, s };
    }
    return best ? [round2(best.a), round2(best.b)] : null;
  }

  // ---------------------------------------------------------------- 6. graphics
  addGraphic(id: string, dur: number, make: (m: Moment, t0: number, t1: number) => { g: Spec; sfx?: Spec[]; shake?: boolean }, auto = false, minDur = 0.8, prefer?: "early" | "late") {
    const p = this.pick(dur, minDur, prefer);
    if (!p) return false;
    const { g, sfx, shake } = make(p.m, p.t0, p.t1);
    const label = auto ? undefined : describeSelection({ id, params: this.p(id) });
    this.graphics.push({ ...g, t0: p.t0, t1: p.t1, _line: p.m.text || "—", _opt: id, _auto: auto, ...(label ? { _label: label } : {}) });
    for (const s of sfx ?? []) {
      const off = typeof s.t_off === "number" ? s.t_off : 0;
      const { t_off: _drop, ...rest } = s as Spec & { t_off?: number };
      this.sfx.push({ ...rest, t: round2(Math.max(0, (s.t as number | undefined) ?? p.t0 - 0.02 + off)) });
    }
    if (shake) this.shakes.push({ t: round2(p.t0 + 0.02), amp: 1, dur: 0.3 });
    this.busy.push([p.t0, p.t1]); p.m.used = true;
    return true;
  }

  /** Content for each graphic: the creator's own text first, then what is said (or the description) at that moment. */
  graphicMaker(id: string): ((m: Moment, t0: number, t1: number) => { g: Spec; sfx?: Spec[]; shake?: boolean }) | null {
    const P = this.p(id);
    const own = str(P.text).trim();
    const fallback = (m: Moment, def: string) => own || (m.word ? strip(m.word) : def);
    const side = (t: number) => this.headX(t) < 0.5;   // true: the head is on the left, use the right side
    const nextTexts = (t: number, n: number) => {
      const after = this.captions.filter((c) => c.t0 > t + 0.05 && c.emph?.length).slice(0, n).map((c) => clean(shorten(c.text, 4, 24)));
      if (after.length) return after;
      return this.brief.description.split(/[\n.!؟?،,]+/).map((s) => clean(shorten(s.trim(), 4, 24))).filter(Boolean).slice(0, n);
    };
    const number = (text: string) => { const m = /(\d[\d,٬]*|[۰-۹][۰-۹٬,]*)\s*(درصد|٪|%)?/.exec(text); return m ? { v: m[1], pct: !!m[2] } : null; };
    switch (id) {
      case "kinetic_text": return (m) => {
        const text = fallback(m, this.input.title ?? "حالا ببین…");
        return { g: { type: "kinetic_text", anim: str(P.anim) || "slam", y: str(P.position) === "middle" ? 820 : 260, lines: [{ text, size: 124, color: "accent" }] }, sfx: [{ type: str(P.anim) === "type" ? "ticks" : "pop", ...(str(P.anim) === "type" ? { dur: 1.0 } : {}) }] };
      };
      case "speech_bubble": return (m, t0) => ({ g: { type: "speech_bubble", shape: str(P.shape) || "talk", text: own || `${fallback(m, "وای")}!`, x: side(t0) ? 830 : 250, y: 470, tail: side(t0) ? "left" : "right" }, sfx: [{ type: "pop" }] });
      case "stamp": return (m) => ({ g: { type: "stamp", text: fallback(m, "جدید"), color: str(P.color) || "red", x: 540, y: 290, angle: -8 }, sfx: [{ type: "stamp" }], shake: true });
      case "pill": return (m) => ({ g: { type: "pill", text: own || (m.text && m.text.split(" ").length <= 4 ? m.text : fallback(m, this.input.title ?? "نکته")), bg: str(P.color) || "purple", fg: str(P.color) === "yellow" ? "ink" : "white", ...(str(P.icon) && str(P.icon) !== "none" ? { icon: str(P.icon) } : {}), x: 540, y: 300, size: 50 }, sfx: [{ type: "pop" }] });
      case "lower_third": return () => ({ g: { type: "lower_third", look: str(P.look) || "bar", name: str(P.name) || this.input.title || "اسم شما", subtitle: str(P.role) || shorten(this.brief.pov, 6, 34), y: 1660 }, sfx: [{ type: "whoosh" }] });
      case "list_card": return (m, t0, t1) => {
        const kind = str(P.kind) || "checklist";
        const ownItems = lines(P.items);
        const items = ownItems.length ? ownItems.slice(0, 5) : (nextTexts(t0, 3).length ? nextTexts(t0, 3) : [fallback(m, "نکته‌ی اصلی")]);
        const step = Math.min(0.5, Math.max(0.3, (t1 - t0 - 0.9) / items.length));
        const times = items.map((_, i) => round2(0.55 + i * step));
        const sfx: Spec[] = [{ type: "whoosh", t: round2(t0 - 0.08) }, ...items.map((_, i) => ({ type: "click", t: round2(t0 + 0.55 + i * step) })), { type: "ding", t: round2(t0 + 0.6 + items.length * step) }];
        const title = str(P.title) || clean(shorten(this.input.title || m.text || this.brief.pov || "", 4, 22));
        if (kind === "product") {
          return { g: { type: "app_card", y: 40, title: title || "معرفی", subtitle: clean(shorten(this.brief.pov || m.text, 6, 34)), rows: items, row_times: times }, sfx };
        }
        return { g: { type: "list_card", kind, title, items, row_times: times, y: 330 }, sfx };
      };
      case "compare": return () => ({ g: { type: "compare", kind: str(P.kind) || "before_after", right: str(P.right), left: str(P.left), y: 380 }, sfx: [{ type: "swish" }, { type: "pop", t_off: 0.55 }] });
      case "stat": return (m, t0, t1) => {
        const kind = str(P.kind) || "ring";
        const n = number(str(P.value) || m.text);
        const label = str(P.label) || fallback(m, "");
        if (kind === "count") return { g: { type: "count_up", value: str(P.value) || (n ? `${n.v}${n.pct ? "٪" : ""}` : "100"), label, x: 540, y: 380, fill: 1.0 }, sfx: [{ type: "ticks", dur: 1.0 }, { type: "ding", t_off: 1.0 }] };
        if (kind === "bars") return { g: { type: "bar_chart", value: str(P.value) || (n ? `${n.v}${n.pct ? "٪" : ""}` : ""), label, y: 420 }, sfx: [{ type: "riser", dur: 0.8 }] };
        if (kind === "progress") return { g: { type: "progress", value: str(P.value) || (n?.pct ? toLatin(n.v) : "100"), label, y: 380, fill: round2(Math.max(0.8, (t1 - t0) * 0.7)) }, sfx: [{ type: "ticks", dur: round2(Math.max(0.8, (t1 - t0) * 0.7)) }, { type: "ding", t_off: Math.max(0.8, (t1 - t0) * 0.7) }] };
        if (kind === "editor") return { g: { type: "nle_timeline", y: 240, work: round2(Math.max(0.8, (t1 - t0) * 0.75)) }, sfx: [{ type: "ticks", dur: round2(Math.max(0.8, (t1 - t0) * 0.7)) }, { type: "ding", t_off: Math.max(0.8, (t1 - t0) * 0.75) }] };
        const v = n?.pct ? Number(toLatin(n.v).replace(/[,٬]/g, "")) : NaN;
        const ownV = Number(toLatin(str(P.value)).replace(/[^\d.]/g, ""));
        const to = ownV > 0 && ownV <= 100 ? ownV / 100 : v > 0 && v <= 100 ? v / 100 : 1;
        return { g: { type: "ring_counter", x: 540, y: 270, label, fill: 0.6, to }, sfx: [{ type: "riser", dur: 0.6 }] };
      };
      case "notification": return () => ({ g: { type: "notification", kind: str(P.kind) || "message", text: own, y: 190 }, sfx: [{ type: "ding", t_off: 0.1 }] });
      case "chat": return (_m, t0) => {
        const ls = lines(P.lines).length ? lines(P.lines) : nextTexts(t0 - 0.1, 3).map((x) => shorten(x, 6, 36));
        return { g: { type: "chat", lines: ls.slice(0, 4), y: 260 }, sfx: ls.slice(0, 4).map((_, i) => ({ type: "pop", t_off: 0.2 + i * 0.75 })) };
      };
      case "search_bar": return (m) => ({ g: { type: "search_bar", query: str(P.query) || clean(shorten(m.text || this.brief.pov || "", 6, 36)) || undefined, y: 330 }, sfx: [{ type: "ticks", dur: 1.2, t_off: 0.35 }] });
      case "timer": return (_m, t0, t1) => {
        const want = Number(str(P.seconds) || 3);
        const secs = Math.max(1, Math.min(want, Math.floor(t1 - t0 - 0.4)));
        return { g: { type: "timer", kind: str(P.kind) || "countdown", seconds: secs, x: 540, y: 400 }, sfx: [{ type: "ticks", dur: secs, t_off: 0.2 }, { type: "ding", t_off: 0.2 + secs }] };
      };
      case "callout": return () => ({ g: { type: "callout", kind: str(P.kind) || "arrow", color: str(P.color) || "yellow", label: str(P.label) }, sfx: [{ type: "swish" }] });
      case "emoji": return (m) => {
        let names = list(P.emojis);
        if (!names.length) {
          const ws = (m.text || "").split(" ").map(norm);
          names = [...new Set(ws.flatMap((w) => EMOJI_WORDS.filter(([re]) => re.test(w)).map(([, e]) => e)))].slice(0, 3);
          if (!names.length) names = ["fire", "hundred"];
        }
        return str(P.mode) === "rain"
          ? { g: { type: "emoji_rain", emojis: names }, sfx: [{ type: "pop" }] }
          : { g: { type: "emoji_pop", emojis: names }, sfx: names.map((_, i) => ({ type: "pop", t_off: i * 0.4 })) };
      };
      case "burst": return (m) => { const text = own || `${fallback(m, "وای")}!`; return { g: { type: "burst", text, x: 290, y: 330, size: Math.max(46, Math.min(84, Math.floor(84 * 6 / Math.max(6, text.length)))) }, sfx: [{ type: "pop" }] }; };
      case "warning_sign": return (m) => ({ g: { type: "warning_sign", x: 250, y: 290, label: str(P.label) || fallback(m, "هشدار!") }, sfx: [{ type: "pop" }] });
      case "prohibit": return (m, t0, t1) => ({ g: { type: "prohibit", icon: str(P.icon) || "person", x: side(t0) ? 820 : 260, y: 380, slash_at: round2(Math.min(0.6, (t1 - t0) * 0.4)), label: str(P.label) || fallback(m, "ممنوع") }, sfx: [{ type: "pop" }, { type: "swish", t_off: Math.min(0.6, (t1 - t0) * 0.4) }] });
      case "viewfinder": return (m, _t0, t1) => ({ g: { type: "viewfinder", label: str(P.label) || fallback(m, "در حال ضبط") }, sfx: [{ type: "beep" }, { type: "shutter", t: round2(t1 - 0.35) }] });
      case "live_voice": return () => ({ g: { type: "live_voice", kind: str(P.kind) || "live", text: "زنده · همین الان", x: 540, y: 170 }, sfx: [{ type: "beep" }] });
      case "cta": return () => ({ g: { type: "cta", kind: str(P.kind) || "follow", y: 1660, tap: 0.9 }, sfx: [{ type: "click", t_off: 0.9 }, { type: "ding", t_off: 1.0 }] });
      case "quote": return (m) => ({ g: { type: "quote", text: own || clean(m.text) || this.brief.pov || undefined, author: str(P.author), y: 420 }, sfx: [{ type: "whoosh" }] });
      case "price_tag": return (m) => {
        const found = /([\d۰-۹][\d۰-۹,٬]*\s*(هزار|میلیون)?\s*تومان)/.exec(m.text);
        return { g: { type: "price_tag", price: str(P.price) || found?.[1] || "قیمت ویژه", old_price: str(P.old_price), x: 540, y: 420 }, sfx: [{ type: "pop" }, { type: "swish", t_off: 0.45 }] };
      };
      case "location": return (m) => {
        const city = (m.text || "").split(" ").map(norm).find((w) => CITY.test(w));
        return { g: { type: "location", place: str(P.place) || city || this.input.title || "اینجا", x: 540, y: 380 }, sfx: [{ type: "thud" }, { type: "pop", t_off: 0.35 }] };
      };
      default: return null;
    }
  }

  // ---------------------------------------------------------------- 7. effects
  /** Background replacement / sky: own segments (may run across cuts), no zoom inside. */
  private claimBackground(len: number, minLen: number): [number, number] | null {
    const w = this.pickWindow(len, minLen) ?? this.pickWindow(len, 1.0);
    if (!w) return null;
    let [t0, t1] = w;
    let i = this.splitAt(t0);
    if (i < 0) {
      const k = this.keepAt(t0);
      if (k < 0 || t0 - this.keeps[k].a >= 0.4) return null;
      i = k;
    }
    t0 = this.keeps[i].a;
    if (this.splitAt(t1) < 0) {
      const k = this.keeps[this.keepAt(t1 - 0.01)];
      if (k) t1 = t1 - k.a < 0.4 && k.a > t0 ? k.a : k.b;
    }
    for (const k of this.keeps.filter((x) => x.a >= t0 - 1e-6 && x.b <= t1 + 1e-6)) Object.assign(k, { zoom: 1.0, push: 0 });
    for (const k of this.keeps.filter((x) => x.a > t0 + 1e-6 && x.b <= t1 + 1e-6)) Object.assign(k, { tr: "cut" });
    return [round2(t0), round2(t1)];
  }

  sceneLength(): [number, number] {
    const P = this.p("scene");
    const n = Math.max(1, this.scenePlaces().length);
    const total = this.totalShown();
    switch (str(P.length)) {
      case "short": return [3.0, 1.6];
      case "long": return [Math.max(3, total * 0.5), 2.2];
      case "all": return [total, 2.2];
      default: return [Math.max(EFFECT_LEN.scene, 2.4 * n), 2.0];
    }
  }

  /** The places of the scene option as engine sources. */
  scenePlaces(): Array<Record<string, unknown>> {
    const P = this.p("scene");
    const src = str(P.source) || "drawn";
    if (src === "upload") return list(P.files).map((f) => ({ kind: "upload", file: f }));
    if (src === "generate") {
      const g = str(P.gen_style);
      let style = g && g !== "auto" ? g : "photo";
      if (!g || g === "auto") {
        // match the video's look: a cartoon video gets cartoon places
        const hit = Object.entries(GEN_STYLES).find(([, s]) => s.look === this.theme.look && !s.bgOnly);
        if (hit) style = hit[0];
      }
      return list(P.prompts).map((text) => ({ kind: "gen", text, style }));
    }
    const ids = list(P.places).filter((p) => p in DRAWN_PLACES);
    return (ids.length ? ids : ["jungle"]).map((id) => ({ kind: "drawn", id }));
  }

  placeScene(): boolean {
    const P = this.p("scene");
    const places = this.scenePlaces();
    if (!places.length) { this.notes.push("برای «تغییر محیط پشت سر» هیچ محیط یا فایلی انتخاب نشده بود."); return false; }
    const [len, min] = this.sceneLength();
    let w: [number, number] | null;
    if (str(P.length) === "all") {
      const first = this.keeps[0], last = this.keeps.at(-1)!;
      for (const k of this.keeps) Object.assign(k, { zoom: 1.0, push: 0 });
      w = [first.a, last.b];
    } else {
      w = this.claimBackground(len, min);
    }
    if (!w) return false;
    const [t0, t1] = w;
    const req = requestedLook({ id: "scene", params: P });
    const own = req && req.scope === "background" && req.look !== "natural" ? req.look : undefined;
    const names = places.map((p) => (p.kind === "drawn" ? DRAWN_PLACES[p.id as string] : p.kind === "gen" ? String(p.text) : "فایل خودت"));
    this.effects.push({ type: "scene", t0, t1, places, change: str(P.change) || "fade", motion: str(P.motion) || "drift",
      ...(own && str(P.source) !== "generate" ? { style: own } : {}), _opt: "scene", _label: `تغییر محیط: ${names.join(" ← ")}` });
    const jungle = places.some((p) => p.id === "jungle");
    if (jungle && t1 - t0 > 2) {
      this.effects.push({ type: "sun", t0: round2(t0 + 0.9), t1, x: 560, y: 680, r: 95 });
      this.sfx.push({ type: "birds", t0, t1, gain: 0.9 });
    }
    this.sfx.push({ type: "impact", t: t0 });
    this.busy.push([t0, Math.min(t1, t0 + 0.6)]);
    return true;
  }

  placeSky(): boolean {
    const w = this.claimBackground(EFFECT_LEN.sky_fly, 1.5);
    if (!w) return false;
    const [t0, t1] = w;
    const time = str(this.p("sky_fly").time) || "day";
    this.effects.push({ type: "sky_fly", t0, t1, time, _opt: "sky_fly", _label: describeSelection({ id: "sky_fly", params: this.p("sky_fly") }) });
    this.sfx.push({ type: "whoosh", t: round2(t0 - 0.05) }, { type: "rise", t: t0, dur: round2(Math.min(1.8, t1 - t0)) });
    this.busy.push([t0, Math.min(t1, t0 + 0.6)]);
    return true;
  }

  /** Effects that add something to the picture without replacing it (may share time with other effects). */
  placeOverlayEffect(id: string): boolean {
    const P = this.p(id);
    const scene = this.effects.find((e) => e.type === "scene" || e.type === "sky_fly");
    // a flyover looks best inside a new world (like the dinosaur in the jungle of test 2)
    if (id === "flyover" && scene && scene.t1 - scene.t0 >= 3) {
      const t0 = round2(scene.t0 + 0.8), t1 = round2(Math.min(scene.t1, t0 + 3));
      this.pushFlyover(t0, t1, P, false);
      return true;
    }
    const w = this.pickWindow(EFFECT_LEN[id] ?? 2.6, 1.6) ?? this.pickWindow(EFFECT_LEN[id] ?? 2.6, 1.0, true);
    if (!w) return false;
    const [t0, t1] = w;
    const label = describeSelection({ id, params: P });
    if (id === "flyover") { this.pushFlyover(t0, t1, P, false); return true; }
    if (id === "particles") {
      this.effects.push({ type: "particles", t0, t1, kind: str(P.kind) || "confetti", layer: str(P.layer) || "front", amount: str(P.amount) || "normal", _opt: id, _label: label });
      this.sfx.push({ type: ["confetti", "money", "stars", "sparkles"].includes(str(P.kind)) ? "ding" : "swish", t: t0 });
    } else if (id === "focus") {
      this.effects.push({ type: "focus", t0, t1, mode: str(P.mode) || "blur", color: str(P.color) || "yellow", _opt: id, _label: label });
      this.sfx.push({ type: "whoosh", t: round2(t0 - 0.1) });
    } else if (id === "glow") {
      this.effects.push({ type: "glow", t0, t1, mode: str(P.mode) || "glow", color: str(P.color) || "yellow", _opt: id, _label: label });
      this.sfx.push({ type: "rise", t: t0, dur: 0.8 });
    } else if (id === "clones") {
      this.effects.push({ type: "clones", t0, t1, mode: str(P.mode) || "side", count: str(P.count) || "3", _opt: id, _label: label });
      this.sfx.push({ type: "pop", t: t0 });
    }
    this.busy.push([t0, Math.min(t1, t0 + 0.5)]);
    return true;
  }

  private pushFlyover(t0: number, t1: number, P: Record<string, ParamValue>, auto: boolean) {
    const obj = str(P.object) || "dinosaur";
    this.effects.push({ type: "flyover", t0, t1, object: obj, direction: str(P.direction) || "rtl", size: str(P.size) || "big",
      _opt: "flyover", _auto: auto, _label: describeSelection({ id: "flyover", params: P }) });
    if (obj === "dinosaur") this.sfx.push({ type: "thuds", t0: round2(t0 + 0.2), t1: round2(t1 - 0.1), every: 0.62 });
    else this.sfx.push({ type: "whoosh", t: round2(t0 + (t1 - t0) * 0.4) });
  }

  // ---------------------------------------------------------------- 8. camera
  placeCamera(id: string): boolean {
    const P = this.p(id);
    const inBg = (t: number) => this.effects.some((e) => ["scene", "sky_fly"].includes(e.type) && t >= e.t0 - 0.2 && t < e.t1);
    const covered = (t: number) => this.graphics.some((g) => typeof g.t0 === "number" && t >= (g.t0 as number) - 0.2 && t < (g.t1 as number));
    const rank = (m: Moment) => Number(m.key) * 2 + Number(m.emph) - (covered(m.t) ? 2.5 : 0);
    const ranked = this.moments.filter((m) => this.shown(m.t) && !inBg(m.t) && !this.isReserved(m.t, m.t + 0.3) && this.inWindow(m.t, m.t + 0.3))
      .sort((a, b) => rank(b) - rank(a));
    const fallbackT = () => this.pick(0.5)!.t0;
    const label = describeSelection({ id, params: P });
    if (id === "zoom_punch") {
      const ts: number[] = [];
      for (const m of ranked) { if (ts.length >= 3) break; if (ts.every((t) => Math.abs(t - m.t) > 2.5)) ts.push(m.t); }
      if (!ts.length) ts.push(fallbackT());
      const mul = str(P.strength) === "light" ? 1.09 : 1.17;
      for (const t of ts) this.punches.push({ t: round2(t + 0.05), mul, ease: 0.12, _opt: id, _label: label });
      return true;
    }
    if (id === "shake") {
      const amp = str(P.strength) === "light" ? 0.55 : 1.0;
      if (str(P.kind) === "quake") {
        const m = ranked[0];
        const t0 = m ? m.t : fallbackT(), t1 = round2(Math.min(this.keepEnd(t0), t0 + 2.2));
        this.sfx.push({ type: "thuds", t0: round2(t0), t1, every: 0.32 });
        this.shakes.push({ t: round2(t0), amp: amp * 0.8, dur: Math.max(0.3, t1 - t0), _opt: id, _label: label });
        return true;
      }
      const hit = this.graphics.find((g) => ["stamp", "burst", "warning_sign"].includes(g.type) && !g._auto);
      const ts = hit ? [hit.t0 as number] : [];
      for (const m of ranked) { if (ts.length >= 2) break; if (ts.every((t) => Math.abs(t - m.t) > 3)) ts.push(m.t); }
      if (!ts.length) ts.push(fallbackT());
      for (const t of ts) { this.shakes.push({ t: round2(t + 0.02), amp, dur: 0.3, _opt: id, _label: label }); this.sfx.push({ type: "impact", t: round2(t) }); }
      return true;
    }
    if (id === "tilt") {
      const m = ranked[0];
      const t = m ? m.t : fallbackT();
      this.tilts.push({ t: round2(t + 0.05), angle: str(P.angle) === "big" ? 14 : 7, dur: 0.9, _opt: id, _label: label });
      this.sfx.push({ type: "swish", t: round2(t) });
      return true;
    }
    if (id === "slow_zoom") {
      // the longest keep without a background change gets a slow push in (or starts close and pulls out)
      const k = this.keeps.filter((x) => !inBg(x.a) && x.b - x.a >= 1.5 && this.inWindow(x.a, x.b)).sort((x, y) => (y.b - y.a) - (x.b - x.a))[0];
      if (!k) return false;
      if (str(P.direction) === "out") Object.assign(k, { zoom: 1.32, push: -0.07 }); else Object.assign(k, { zoom: 1.0, push: 0.06 });
      this.marks.push({ id, t: k.a, auto: false, label });
      return true;
    }
    if (id === "freeze") {
      const m = ranked.find((x) => this.keeps[this.keepAt(x.t)] && x.t - this.keeps[this.keepAt(x.t)].a > 0.5) ?? ranked[0];
      const t = m ? m.t + 0.25 : fallbackT();
      let i = this.splitAt(t, 0.4);
      if (i < 0) { i = this.keepAt(t) + 1; if (i <= 0 || i >= this.keeps.length) i = Math.max(1, Math.floor(this.keeps.length / 2)); }
      this.keeps[i - 1].freezeAfter = true;
      this.freeze = { frame: str(P.frame) || "photo", label: str(P.label) };
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 9. structure
  placeColdOpen(): boolean {
    const fxs = this.effects.filter((e) => e.type !== "sun");
    let a: number, b: number;
    if (fxs.length) {
      const e = fxs[0];
      a = round2(Math.min(e.t1 - 0.6, e.t0 + 0.5)); b = round2(Math.min(e.t1, a + 1.8));
    } else {
      const total = this.totalShown();
      let acc = 0;
      const pos = new Map(this.keeps.map((k) => { const s = acc; acc += k.b - k.a; return [k, s / Math.max(1e-6, total)]; }));
      const late = this.moments.filter((m) => { const k = this.keeps[this.keepAt(m.t)]; return k && (pos.get(k)! + (m.t - k.a) / total) > 0.4 && this.inWindow(m.t, m.t + 1); });
      const m = late.sort((x, y) => Number(y.key) * 2 + Number(y.emph) - (Number(x.key) * 2 + Number(x.emph)))[0];
      const k = m ? this.keeps[this.keepAt(m.t)] : this.keeps[Math.floor(this.keeps.length / 2)];
      a = round2(m ? m.t : (k.a + k.b) / 2 - 0.8); b = round2(Math.min(k.b, a + 1.8));
    }
    if (b - a < 0.8) { const k = this.keeps.reduce((x, y) => (y.b - y.a > x.b - x.a ? y : x)); a = round2(Math.max(k.a, (k.a + k.b) / 2 - 0.9)); b = round2(Math.min(k.b, a + 1.8)); }
    const zoomed = fxs.some((e) => a < e.t1 && e.t0 < b && ["scene", "sky_fly"].includes(e.type));
    this.coldOpen = { a, b, zoom: zoomed ? 1.0 : "auto" };
    return true;
  }

  /** The keep that ends closest to the middle of the reel (for rewind / replay). */
  private middleKeep(minLen: number, skip = -1): number {
    const total = this.totalShown();
    let acc = 0, best = -1, bestD = Infinity;
    this.keeps.forEach((k, i) => {
      acc += k.b - k.a;
      if (i === skip || i === this.keeps.length - 1 || k.b - k.a < minLen || !this.inWindow(k.a, k.b)) return;
      const d = Math.abs(acc / total - 0.5);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) {
      const k = this.keeps.reduce((x, y) => (y.b - y.a > x.b - x.a ? y : x));
      const i = this.splitAt((k.a + k.b) / 2, 1.0);
      if (i < 0) return -1;
      best = i - 1;
    }
    return best;
  }

  placeRewind(): boolean {
    const best = this.middleKeep(1.6);
    if (best < 0) return false;
    const k = this.keeps[best];
    this.rewindAfter = { after: k.b, a: round2(Math.max(k.a, k.b - 2.4)), b: k.b };
    const next = this.keeps[best + 1];
    if (next && !next.tr) Object.assign(next, { tr: "flash", trAuto: true });
    return true;
  }

  placeReplay(): boolean {
    // replay the strongest line (not inside a background change), zoomed in
    const inBg = (t: number) => this.effects.some((e) => ["scene", "sky_fly"].includes(e.type) && t >= e.t0 && t < e.t1);
    const label = str(this.p("replay").label) || "دوباره ببین";
    const ranked = this.moments.filter((x) => x.text && this.shown(x.t) && !inBg(x.t) && this.inWindow(x.t, x.t + 1))
      .sort((x, y) => Number(y.key) * 2 + Number(y.emph) - (Number(x.key) * 2 + Number(x.emph)));
    for (const m of ranked) {
      const k = this.keeps[this.keepAt(m.t)];
      if (!k || k.b === this.rewindAfter?.after || k.freezeAfter) continue;
      const a = round2(Math.max(k.a, Math.min(m.t - 0.1, k.b - 1.2)));
      const b = round2(Math.min(k.b, a + 2.0));
      if (b - a < 0.8) continue;
      this.replayAfter = { after: k.b, a, b, label };
      return true;
    }
    const ki = this.middleKeep(1.2);
    if (ki < 0) return false;
    const k = this.keeps[ki];
    this.replayAfter = { after: k.b, a: round2(Math.max(k.a, k.b - 2.0)), b: k.b, label };
    return true;
  }

  /** Transitions between segments. Each picked kind appears at least once; clip joins always get one. */
  placeTransitions() {
    const P = this.p("transition");
    const auto = SKIN_TRANSITIONS[this.theme.skin];
    // transitions picked without choosing which: two from the video's own family
    const pool = this.has("transition") ? (list(P.kinds).filter(Boolean).length ? list(P.kinds).filter(Boolean) : auto.slice(0, 2)) : [];
    const freeIdx = () => this.keeps.map((_, i) => i).filter((i) => i > 0 && !this.keeps[i].tr);
    for (let guard = 0; freeIdx().length < pool.length && guard < 12; guard++) {
      const k = [...this.keeps].filter((x) => this.inWindow(x.a, x.b)).sort((x, y) => (y.b - y.a) - (x.b - x.a))[0];
      if (!k || k.b - k.a < 1.6) break;
      const mid = (k.a + k.b) / 2;
      const between = this.captions.filter((c) => c.t0 > k.a + 0.6 && c.t0 < k.b - 0.6).map((c) => c.t0).sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid))[0];
      if (this.splitAt(between ?? mid, 0.6) < 0) break;
    }
    const idx = freeIdx();
    const taken = new Set<number>();
    pool.forEach((tr, j) => {
      const want = Math.floor(((j + 0.5) * idx.length) / pool.length);
      const order = idx.map((_, k) => k).filter((k) => !taken.has(k)).sort((x, y) => Math.abs(x - want) - Math.abs(y - want));
      if (!order.length) return;
      taken.add(order[0]);
      Object.assign(this.keeps[idx[order[0]]], { tr, trAuto: false });
    });
    const every = str(P.amount) === "all";
    let n = 0, cycle = 0;
    this.keeps.forEach((k, i) => {
      if (i === 0 || k.tr) return;
      n++;
      const join = k.clip !== this.keeps[i - 1].clip;
      if (join || every || n % 3 === 0) {
        const fam = pool.length ? pool : auto;
        k.tr = fam[cycle++ % fam.length]; k.trAuto = !(every && pool.length);
      }
    });
  }

  // ---------------------------------------------------------------- 10. director's own additions
  autoPhraseGraphics() {
    const gap = DENSITY_GAP[this.input.style.graphicsDensity];
    let lastG = -Infinity;
    const used = new Set<number>();
    const nw = this.words.map((w) => norm(w.w));
    this.words.forEach((w, i) => {
      const ri = RULES.findIndex((r, k) => !used.has(k) && r.test(nw[i], nw.slice(0, i)));
      if (ri < 0 || !this.shown(w.s) || w.s - lastG < gap) return;
      const t0 = round2(w.s);
      const probe = RULES[ri].make(t0, 1.5);
      const t1 = round2(Math.min(this.keepEnd(w.s), t0 + (probe.dur ?? 1.5)));
      if (t1 - t0 < 0.6 || !this.free(t0, t1) || this.isReserved(t0, t1) || this.distToBusy(t0) < gap * 0.5) return;
      const made = RULES[ri].make(t0, t1 - t0);
      if (this.has(RULES[ri].opt) && this.graphics.some((g) => g._opt === RULES[ri].opt && !g._auto)) return;
      this.graphics.push({ ...made.g, t0, t1, _line: w.w, _opt: RULES[ri].opt, _auto: true });
      for (const s of made.sfx ?? []) {
        const { t_off, ...rest } = s as Spec & { t_off?: number };
        this.sfx.push({ ...rest, t: round2(Math.max(0, t0 - 0.02 + (t_off ?? 0))) });
      }
      if (made.g.type === "stamp") this.shakes.push({ t: round2(t0 + 0.02), amp: 1, dur: 0.3 });
      this.busy.push([t0, t1]); used.add(ri); lastG = t0;
    });
  }

  pacingPunches() {
    const events = [...this.graphics.map((g) => g.t0 as number), ...this.keeps.map((k) => k.a), ...this.punches.map((p) => p.t), ...this.effects.map((e) => e.t0)].sort((a, b) => a - b);
    let lastEv = events[0] ?? 0;
    for (const m of this.moments) {
      const prevEv = Math.max(lastEv, ...events.filter((e) => e <= m.t));
      const near = this.punches.some((p) => Math.abs(p.t - m.t) < 1.5);
      if (!near && m.t - prevEv > 2.8 && (m.emph || !m.text) && this.shown(m.t) && !this.effects.some((e) => ["scene", "sky_fly", "clones"].includes(e.type) && m.t >= e.t0 && m.t < e.t1)) {
        this.punches.push({ t: m.t, mul: 1.12, ease: 0.14, _opt: "zoom_punch", _auto: true });
        lastEv = m.t;
      }
    }
  }

  // ---------------------------------------------------------------- 11. assemble
  timeline(): EditPlan["timeline"] {
    const tl: EditPlan["timeline"] = [];
    const trLabel = (tr: string) => OPTION_BY_ID.get("transition")!.params[0].kind === "many"
      ? (OPTION_BY_ID.get("transition")!.params[0] as { choices: Array<{ id: string; label: string }> }).choices.find((c) => c.id === tr)?.label : undefined;
    if (this.coldOpen) tl.push({ src: [this.coldOpen.a, this.coldOpen.b], role: "cold_open", zoom: this.coldOpen.zoom, push: 0, _opt: "cold_open" } as EditPlan["timeline"][number]);
    this.keeps.forEach((k, i) => {
      const first = i === 0;
      const tr = first ? (this.coldOpen ? "whip" : "cut") : (k.tr ?? "cut");
      tl.push({ src: [k.a, k.b], zoom: k.zoom ?? "auto", ...(k.push !== undefined ? { push: k.push } : {}), transition_in: tr,
        ...(tr !== "cut" ? { _opt: "transition", _auto: first ? true : k.trAuto !== false, _label: `ترنزیشن: ${trLabel(tr) ?? tr}` } : {}) } as EditPlan["timeline"][number]);
      if (k.freezeAfter && this.freeze) {
        const f = round2(Math.max(k.a, k.b - 1 / 30));
        tl.push({ src: [f, round2(f + 0.04)], hold: 0.9, role: "freeze", voice: false, captions: false, zoom: k.zoom ?? "auto", push: 0,
          transition_in: "cut", _opt: "freeze", _label: describeSelection({ id: "freeze", params: this.p("freeze") }) } as EditPlan["timeline"][number]);
      }
      if (this.rewindAfter && Math.abs(this.rewindAfter.after - k.b) < 1e-6) {
        tl.push({ src: [this.rewindAfter.a, this.rewindAfter.b], role: "rewind", reverse: true, speed: 4, captions: false, voice: false, zoom: 1.0, _opt: "rewind" } as EditPlan["timeline"][number]);
      }
      if (this.replayAfter && Math.abs(this.replayAfter.after - k.b) < 1e-6) {
        tl.push({ src: [this.replayAfter.a, this.replayAfter.b], role: "replay", zoom: 1.35, push: 0.03, transition_in: "flash", captions: true, _opt: "replay" } as EditPlan["timeline"][number]);
      }
    });
    return tl;
  }

  plan(): EditPlan {
    const { input } = this;
    const { style, analysis } = input;
    const timeline = this.timeline();
    const fps = 30;
    const segDur = (role: string) => { const s = timeline.find((x) => x.role === role); return s ? round2(segmentSeconds(s, fps)) : 0; };
    if (this.coldOpen) {
      if (this.hookLines.length) this.graphics.unshift({ type: "kinetic_text", role: "cold_open", at: 0, dur: segDur("cold_open"), y: 230, lines: this.hookLines, _line: "hook" });
      this.sfx.push({ type: "impact", role: "cold_open", at: 0 });
    }
    if (this.rewindAfter) {
      const dur = segDur("rewind");
      this.graphics.push({ type: "vhs_rewind", role: "rewind", at: 0, dur, text: "برگشت", _opt: "rewind_label" });
      this.sfx.push({ type: "rewind", role: "rewind", at: 0, dur });
    }
    if (this.replayAfter) {
      this.graphics.push({ type: "replay_badge", role: "replay", at: 0, dur: segDur("replay"), text: this.replayAfter.label });
      this.sfx.push({ type: "rewind", role: "replay", at: 0, dur: 0.5 });
    }
    if (this.freeze && timeline.some((s) => s.role === "freeze")) {
      this.graphics.push({ type: "freeze_frame", role: "freeze", at: 0, dur: segDur("freeze"), frame: this.freeze.frame, label: this.freeze.label });
      this.sfx.push({ type: "shutter", role: "freeze", at: 0 });
    }
    const noSpeech = !this.words.length && (analysis.speech?.has_audio ?? true);
    // ---- the theme: one look for the picture, one skin for graphics
    const T = this.theme;
    const look = T.look !== "natural" ? { style: T.look, scope: T.scope } : undefined;
    // a look that came from another choice (e.g. a drawn place) is the director's decision: listed under its own additions
    if (look) this.marks.push({ id: "look", out: 0, auto: !this.has("look"),
      label: `سبک تصویر: ${LOOK_STYLES[T.look as LookStyle]}${T.scope === "background" ? " (فقط پس‌زمینه)" : T.scope === "subject" ? " (فقط آدم)" : ""}` });
    if (!look && this.has("look")) this.marks.push({ id: "look", out: 0, auto: false, label: `سبک تصویر: ${LOOK_STYLES[T.look as LookStyle]}` });
    const overlays = this.has("overlay") ? (list(this.p("overlay").kinds).length ? list(this.p("overlay").kinds) : ["grain"]) : [];
    if (overlays.length) this.marks.push({ id: "overlay", out: 0, auto: false, label: describeSelection({ id: "overlay", params: this.p("overlay") }) });
    const plan: EditPlan = {
      _comment: `rule director v0.3${input.note ? ` — revision note (not applied by the rule director): ${input.note}` : ""}`,
      _brief: { pov: this.brief.pov, description: this.brief.description, options: this.selections },
      _theme: { look: T.look, scope: T.scope, skin: T.skin, from: T.from },
      source: input.sourcePath,
      output: { path: input.outputPath, w: 1080, h: 1920, fps },
      timeline,
      auto_zoom: { target_head_px: 185, max: 1.4 },
      zoom: { slow_push_per_sec: 0.012, punches: this.punches.sort((a, b) => a.t - b.t) },
      grade: { contrast: 1.1, saturation: 1.14, warmth: 0.03, highlight_rolloff: 0.12, vignette: 0.2 },
      grain: style.grain && !overlays.includes("grain") ? 4 : 0,
      ...(look ? { look } : {}),
      ...(T.skin !== "clean" ? { skin: T.skin } : {}),
      ...(overlays.length ? { overlays } : {}),
      ...(this.has("loop_end") ? { loop_end: true } : {}),
      captions: this.captions,
      effects: this.effects,
      graphics: this.graphics,
      shakes: this.shakes,
      tilts: this.tilts,
      sfx: this.sfx,
      audio: { music: { gain_db: style.musicGainDb, off: !style.music }, ...(noSpeech ? { voice_chain: "anull" } : {}) },
      matting: { clean_plate: false },
      progress_bar: style.progressBar,
    };
    const total = segmentStarts(plan).at(-1)! + segmentSeconds(timeline.at(-1)!, fps);
    if (this.has("loop_end")) this.marks.push({ id: "loop_end", out: round2(Math.max(0, total - 0.45)), auto: false, label: optionLabel("loop_end") });
    plan._marks = this.marks;
    plan._usage = usageOf(plan);
    const missing = [...this.picks.keys()].filter((id) => !plan._usage!.some((u) => u.id === id && !u.auto));
    if (missing.length) plan._missing = missing;
    if (this.notes.length) plan._notes = this.notes;
    return plan;
  }

  /** Run every step. */
  build(): EditPlan {
    this.prepareWords();
    this.buildKeeps();
    if (!this.keeps.length) throw new Error("nothing to edit: the video is empty");
    this.buildCaptions();
    this.buildMoments();
    this.reserveHookAndCta();
    // picked options first: they must appear. Background changes need the longest windows, so they go first.
    if (this.has("scene")) this.placeScene();
    if (this.has("sky_fly")) this.placeSky();
    for (const id of ["flyover", "particles", "focus", "glow", "clones"]) if (this.has(id)) this.placeOverlayEffect(id);
    for (const id of GRAPHIC_ORDER) {
      if (!this.has(id)) continue;
      const make = this.graphicMaker(id)!;
      const prefer = id === "cta" ? "late" : id === "lower_third" ? "early" : undefined;
      const min = id === "list_card" || id === "chat" ? 1.6 : id === "timer" ? 1.4 : 0.8;
      this.addGraphic(id, GRAPHIC_DUR[id], make, false, min, prefer);
    }
    for (const id of ["zoom_punch", "shake", "tilt", "slow_zoom", "freeze"]) if (this.has(id)) this.placeCamera(id);
    if (this.has("cold_open")) this.placeColdOpen();
    if (this.has("rewind")) this.placeRewind();
    if (this.has("replay")) this.placeReplay();
    this.placeTransitions();
    // then the director's own choices
    if (this.flags.autoRules) this.autoPhraseGraphics();
    this.finishHookAndCta();
    if (this.flags.pacing) this.pacingPunches();
    return this.plan();
  }
}

/** Where each option shows up in the reel (output seconds). Hook and CTA are not options. */
export function usageOf(plan: EditPlan): UsageItem[] {
  const starts = segmentStarts(plan);
  const roleStart = (role: string) => { const i = plan.timeline.findIndex((s) => s.role === role); return i >= 0 ? starts[i] : null; };
  const out: UsageItem[] = [];
  const add = (id: unknown, t: number | null, auto: unknown, label?: unknown) => {
    if (typeof id === "string" && t !== null && OPTION_IDS.has(id)) out.push({ id, out: round2(t), auto: !!auto, ...(typeof label === "string" ? { label } : {}) });
  };
  plan.timeline.forEach((s, i) => { const x = s as typeof s & Tagged; add(x._opt, x.role === "cold_open" ? 0 : starts[i], x._auto, x._label); });
  for (const g of plan.graphics as Array<Spec & Tagged>) {
    if ("role" in g) { const r = roleStart(g.role as string); add(g._opt, r === null ? null : r + (g.at as number), g._auto, g._label); }
    else add(g._opt, srcToOut(plan, g.t0 as number), g._auto, g._label);
  }
  for (const e of plan.effects as Array<Spec & Tagged & { t0: number; t1: number }>) {
    // an effect may start inside a cut: report the first moment of it that is shown
    let t = srcToOut(plan, e.t0);
    for (let x = e.t0; t === null && x < e.t1; x += 0.1) t = srcToOut(plan, x);
    add(e._opt, t, e._auto, e._label);
  }
  for (const p of (plan.zoom?.punches ?? []) as Array<{ t: number } & Tagged>) add(p._opt, srcToOut(plan, p.t), p._auto, p._label);
  for (const s of (plan.shakes ?? []) as Array<{ t: number } & Tagged>) add(s._opt, srcToOut(plan, s.t), s._auto, s._label);
  for (const s of ((plan.tilts as Array<{ t: number } & Tagged>) ?? [])) add(s._opt, srcToOut(plan, s.t), s._auto, s._label);
  for (const m of ((plan._marks as Mark[]) ?? [])) add(m.id, m.out ?? (m.t !== undefined ? srcToOut(plan, m.t) : null), m.auto, m.label);
  return out.sort((a, b) => a.out - b.out);
}

export class RuleDirector implements Director {
  readonly name = "rule" as const;
  async createPlan(input: DirectorInput): Promise<EditPlan> {
    return new PlanBuilder(input).build();
  }
}
