/**
 * Rule-based director: a deterministic baseline that needs no API key.
 * It does what a careful junior editor would do from the transcript alone: cut pauses, keep the speaker
 * framed, caption in short chunks, put a hook first and a CTA last, and illustrate recognisable phrases.
 *
 * Since v0.2 it also
 *  - edits videos where nobody speaks: the creator's description becomes on-screen text,
 *  - respects clip boundaries when several uploads were joined (transition at every join),
 *  - uses the point of view: its words get the caption emphasis and the best graphic slots,
 *  - guarantees every option the creator picked appears at least once, then adds its own choices,
 *  - reports where every option shows up in the reel (`_usage`, output seconds).
 * The Claude director (step 3) replaces it and can reason about the point of view and description freely.
 */
import type { EditPlan, Word, Brief, UsageItem } from "@autoreel/shared";
import { round2, srcToOut, segmentStarts, segmentSeconds, OPTION_IDS, EMPTY_BRIEF } from "@autoreel/shared";
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
/** Content words of the point of view; matching words in the speech count as key words. */
function keywords(text: string): string[] {
  return [...new Set(text.split(/\s+/).map(norm).filter((w) => w.length >= 3 && !STOP.has(w)))];
}
const matchesKey = (w: string, keys: string[]) => {
  const n = norm(w);
  return n.length >= 3 && keys.some((k) => n === k || (k.length >= 4 && (n.startsWith(k) || k.startsWith(n) && n.length >= 4)));
};

// ====================================================================== phrase rules (director's own choices)
type Spec = Record<string, unknown> & { type: string };
interface Rule { test: (w: string, prev: string[]) => boolean; make: (t: number, dur: number) => { g: Spec; sfx?: Spec[]; dur?: number } }
const RULES: Rule[] = [
  { test: (w) => /^سلام/.test(w), make: () => ({ g: { type: "speech_bubble", text: "سلام!", x: 850, y: 470 }, sfx: [{ type: "pop" }], dur: 1.2 }) },
  { test: (w) => /^(تست|تستی|آزمایشی)$/.test(w), make: () => ({ g: { type: "stamp", text: "نسخه تستی", sub: "آزمایشی", x: 540, y: 290, angle: -8 }, sfx: [{ type: "stamp" }], dur: 1.0 }) },
  { test: (w) => /^(ضبط|خام|خامه)/.test(w), make: () => ({ g: { type: "viewfinder", label: "فیلم خام" }, sfx: [{ type: "beep" }], dur: 2.0 }) },
  { test: (w) => /^(ادیت|تدوین)/.test(w), make: (_t, d) => ({ g: { type: "nle_timeline", y: 240, work: Math.max(0.8, d * 0.75) }, sfx: [{ type: "ticks", dur: Math.max(0.8, d * 0.7) }], dur: 1.8 }) },
  { test: (w, p) => w === "مصنوعی" && p.at(-1) === "هوش", make: () => ({ g: { type: "kinetic_text", y: 260, lines: [{ text: "هوش مصنوعی", size: 124, color: "accent" }] }, sfx: [{ type: "pop" }], dur: 1.3 }) },
  { test: (w, p) => /^(انسان|آدم)/.test(w) && p.slice(-3).includes("بدون"), make: (_t, d) => ({ g: { type: "no_human", x: 300, y: 250, slash_at: Math.min(0.6, d * 0.4), label: "۰٪ دخالت انسان", label_x: 750, label_y: 250 }, sfx: [{ type: "pop" }], dur: 1.6 }) },
  { test: (w) => /^(الان|زنده|لایو)$/.test(w), make: () => ({ g: { type: "live_voice", text: "زنده · همین الان", x: 540, y: 170 }, sfx: [{ type: "beep" }], dur: 2.0 }) },
  { test: (w) => /^افکت/.test(w), make: () => ({ g: { type: "burst", text: "افکت!", x: 290, y: 330 }, sfx: [{ type: "pop" }], dur: 1.3 }) },
  { test: (w) => /^(کامل|کاملاً|کاملا|درصد)$/.test(w), make: () => ({ g: { type: "ring_counter", x: 540, y: 270, label: "کامل", fill: 0.6 }, sfx: [{ type: "riser", dur: 0.6 }], dur: 1.0 }) },
  { test: (w) => /^(خطر|مراقب|هشدار)/.test(w), make: () => ({ g: { type: "warning_sign", x: 250, y: 290, label: "هشدار!" }, sfx: [{ type: "pop" }], dur: 1.6 }) },
];

const DENSITY_GAP = { low: 6, normal: 3.5, high: 2.2 } as const;
const TRANSITIONS = ["whip", "flash", "zoom_in", "glitch"] as const;
const FX_LEN: Record<string, number> = { jungle: 4.2, sky_fly: 2.6, dinosaur_walk: 3.2 };

// ====================================================================== plan builder
export interface Keep { a: number; b: number; clip: number; silent: boolean; tr?: string; trAuto?: boolean; zoom?: number | "auto"; push?: number }
interface Moment { t: number; end: number; text: string; word: string; key: boolean; emph: boolean; used?: boolean }
type Caption = EditPlan["captions"][number];
type Tagged = Record<string, unknown> & { _opt?: string; _auto?: boolean };

export interface BuilderFlags {
  hook: boolean; cta: boolean; autoRules: boolean; pacing: boolean;
  /** Force every graphic into this source window (used to render option previews). */
  window?: [number, number];
}
const DEFAULT_FLAGS: BuilderFlags = { hook: true, cta: true, autoRules: true, pacing: true };

export class PlanBuilder {
  readonly D: number;
  readonly brief: Brief;
  readonly selected: Set<string>;
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
  busy: Array<[number, number]> = [];
  reserved: Array<[number, number]> = [];
  coldOpen?: { a: number; b: number; zoom: number | "auto" };
  rewindAfter?: { keep: number; a: number; b: number };
  hookLines: Array<{ text: string; size: number; color: string }> = [];
  log: string[] = [];

  constructor(readonly input: DirectorInput, readonly flags: BuilderFlags = DEFAULT_FLAGS) {
    this.D = input.analysis.info.duration;
    this.brief = { ...EMPTY_BRIEF, ...(input.brief ?? {}) };
    this.selected = new Set(this.brief.options.filter((id) => OPTION_IDS.has(id)));
    this.keys = keywords(this.brief.pov);
  }

  // ---------------------------------------------------------------- queries
  keepAt(t: number) { return this.keeps.findIndex((k) => t >= k.a && t < k.b); }
  shown(t: number) { return this.keepAt(t) >= 0; }
  keepEnd(t: number) { const i = this.keepAt(t); return i >= 0 ? this.keeps[i].b : t; }
  free(a: number, b: number) { return !this.busy.some(([x, y]) => a < y && x < b); }
  isReserved(a: number, b: number) { return this.reserved.some(([x, y]) => a < y && x < b); }
  distToBusy(t: number) { return this.busy.length ? Math.min(...this.busy.map(([x, y]) => (t < x ? x - t : t > y ? t - y : 0))) : 8; }
  inWindow(a: number, b: number) { const w = this.flags.window; return !w || (a >= w[0] - 1e-6 && b <= w[1] + 1e-6); }
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
        if (w.s < a && w.e > a) w.e = Math.max(w.s + 0.05, a);          // word runs into the pause: end it there
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
      if (!ws.length) { this.keeps.push({ a: round2(cs), b: round2(ce), clip: ci, silent: true }); return; }  // b-roll / silent clip: keep it whole
      const s0 = Math.max(cs, ws[0].s - 0.12), s1 = Math.min(ce, ws.at(-1)!.e + 0.3);
      const cuts: Array<[number, number]> = [];
      for (const [a, b] of analysis.pauses) {
        if (b - a < style.minPause || a <= s0 || b >= s1) continue;
        const ca = a + 0.08, cb = b - 0.08;
        // pauses come from audio energy (real silence); refuse the cut only if a whole word would disappear in it
        if (ws.some((w) => w.s >= ca && w.e <= cb)) continue;
        cuts.push([ca, cb]);
      }
      let ks: Array<[number, number]> = [];
      let t = s0;
      for (const [a, b] of cuts) { ks.push([t, a]); t = b; }
      ks.push([t, s1]);
      // merge keeps shorter than 0.5s into the previous one (a cut there would look nervous)
      ks = ks.reduce<Array<[number, number]>>((acc, k) => {
        if (acc.length && k[1] - k[0] < 0.5) acc[acc.length - 1][1] = k[1]; else acc.push([...k] as [number, number]);
        return acc;
      }, []);
      for (const [a, b] of ks) this.keeps.push({ a: round2(a), b: round2(b), clip: ci, silent: false });
    });
  }

  /** Split the keep containing t; returns the index of the second half (or the keep starting at t), -1 if impossible. */
  splitAt(t: number, minPart = 0.4): number {
    t = round2(t);
    const i = this.keeps.findIndex((k) => t > k.a - 1e-6 && t < k.b);
    if (i < 0) return -1;
    const k = this.keeps[i];
    if (Math.abs(t - k.a) < 1e-6) return i;
    if (t - k.a < minPart || k.b - t < minPart) return -1;
    this.keeps.splice(i, 1, { ...k, b: t }, { ...k, a: t, tr: undefined, trAuto: undefined });
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
      // words of the point of view first, then nouns over verbs, then the longest
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
    // a lone word reads as a flicker: join it to its neighbour
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
    // never let a caption run into the next clip
    for (const c of captions) {
      const k = this.keepAt(c.t0);
      if (k >= 0 && (k === this.keeps.length - 1 || this.keeps[k + 1].clip !== this.keeps[k].clip)) c.t1 = round2(Math.min(c.t1, this.keeps[k].b));
    }
    this.captions = captions;
    this.describeSilentParts();
  }

  /** Where nobody speaks, the creator's description is shown as on-screen text (no karaoke highlight). */
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
    // silent parts without text still need slots (every ~2.6s)
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
      if (!this.selected.has("cold_open")) this.reserved.push([first.a, first.a + 2.3]);
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
  /** Best free moment for a graphic of `dur` seconds. Constraints relax until something fits (selected options must appear). */
  pick(dur: number, minDur = 0.8): { m: Moment; t0: number; t1: number } | null {
    const gap = DENSITY_GAP[this.input.style.graphicsDensity] * 0.6;
    // stop before the next reserved window (hook / CTA) rather than run into it
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
      const score = (c: typeof fit[number]) => (c.m.key ? 3 : 0) + (c.m.emph ? 1 : 0) + (c.m.text ? 0.5 : 0) + Math.min(this.distToBusy(c.t0), 8) / 2;
      return fit.reduce((a, b) => (score(b) > score(a) ? b : a));
    }
    // nothing at all (e.g. very short video): middle of the longest keep
    const k = this.keeps.filter((x) => this.inWindow(x.a, x.b)).sort((x, y) => (y.b - y.a) - (x.b - x.a))[0] ?? this.keeps[0];
    const t0 = round2(Math.max(k.a, (k.a + k.b) / 2 - dur / 2));
    return { m: { t: t0, end: k.b, text: "", word: "", key: false, emph: false }, t0, t1: round2(Math.min(k.b, t0 + dur)) };
  }

  /** Seconds of [a, b] that stay in the reel. */
  shownBetween(a: number, b: number) { return this.keeps.reduce((t, k) => t + Math.max(0, Math.min(b, k.b) - Math.max(a, k.a)), 0); }

  /**
   * A window for an effect that replaces or adds to the background: `len` seconds of the reel, which may run
   * across cuts inside one clip, never into the hook / CTA or another effect.
   */
  pickWindow(len: number, minLen = 1.8): [number, number] | null {
    const total = this.keeps.reduce((t, k) => t + (k.b - k.a), 0);
    const outAt = (t: number) => this.shownBetween(-1, t) / Math.max(total, 1e-6);
    let best: { a: number; b: number; s: number } | null = null;
    const starts = [...this.keeps.map((k) => k.a), ...this.moments.map((m) => m.t)].filter((t) => this.shown(t));
    for (const a of starts) {
      let i = this.keepAt(a), b = a, got = 0;
      while (i >= 0 && i < this.keeps.length) {
        const k = this.keeps[i];
        if (k.clip !== this.keeps[this.keepAt(a)].clip) break;
        let hi = k.b;
        for (const [x, y] of this.reserved) if (x < hi && y > Math.max(a, k.a)) hi = Math.min(hi, x);
        for (const e of this.effects) if (e.t0 < hi && e.t1 > Math.max(a, k.a)) hi = Math.min(hi, e.t0);
        if (this.flags.window) hi = Math.min(hi, this.flags.window[1]);
        const from = Math.max(a, k.a);
        if (hi <= from) break;
        const take = Math.min(hi - from, len - got);
        got += take; b = from + take;
        if (got >= len - 1e-6 || hi < k.b) break;
        i++;
      }
      if (got < minLen || this.isReserved(a, a + 0.05) || this.effects.some((e) => a >= e.t0 && a < e.t1)) continue;
      if (this.flags.window && a < this.flags.window[0]) continue;
      const m = this.moments.find((x) => Math.abs(x.t - a) < 0.05);
      const s = (got / len) * 3 - Math.abs(outAt(a) - 0.55) * 2 + (m?.key ? 1.5 : 0) + (m?.emph ? 0.3 : 0);
      if (!best || s > best.s) best = { a, b, s };
    }
    return best ? [round2(best.a), round2(best.b)] : null;
  }

  // ---------------------------------------------------------------- 6. options
  addGraphic(id: string, dur: number, make: (m: Moment, t0: number, t1: number) => { g: Spec; sfx?: Spec[]; shake?: boolean }, auto = false, minDur = 0.8) {
    const p = this.pick(dur, minDur);
    if (!p) return false;
    const { g, sfx, shake } = make(p.m, p.t0, p.t1);
    this.graphics.push({ ...g, t0: p.t0, t1: p.t1, _line: p.m.text || "—", _opt: id, _auto: auto });
    for (const s of sfx ?? []) this.sfx.push({ ...s, t: round2(Math.max(0, (s.t as number | undefined) ?? p.t0 - 0.02)) });
    if (shake) this.shakes.push({ t: round2(p.t0 + 0.02), amp: 1, dur: 0.3 });
    this.busy.push([p.t0, p.t1]); p.m.used = true;
    return true;
  }

  /** Content for each graphic, taken from what is said (or the description) at that moment. */
  graphicMaker(id: string): ((m: Moment, t0: number, t1: number) => { g: Spec; sfx?: Spec[]; shake?: boolean }) | null {
    const fallback = (m: Moment, def: string) => (m.word ? strip(m.word) : def);
    const head = (t: number) => this.headX(t);
    const nextTexts = (t: number, n: number) => {
      // the next lines that carry a key word (fillers like «و در واقع یه» make empty rows)
      const after = this.captions.filter((c) => c.t0 > t + 0.05 && c.emph?.length).slice(0, n).map((c) => clean(shorten(c.text, 4, 24)));
      if (after.length) return after;
      return this.brief.description.split(/[\n.!؟?،,]+/).map((s) => clean(shorten(s.trim(), 4, 24))).filter(Boolean).slice(0, n);
    };
    switch (id) {
      case "kinetic_text": return (m) => ({ g: { type: "kinetic_text", y: 260, lines: [{ text: fallback(m, this.input.title ?? "حالا ببین…"), size: 124, color: "accent" }] }, sfx: [{ type: "pop" }] });
      case "speech_bubble": return (m, t0) => ({ g: { type: "speech_bubble", text: `${fallback(m, "وای")}!`, x: head(t0) < 0.5 ? 830 : 250, y: 470, tail: head(t0) < 0.5 ? "left" : "right" }, sfx: [{ type: "pop" }] });
      case "stamp": return (m) => ({ g: { type: "stamp", text: fallback(m, "جدید"), x: 540, y: 290, angle: -8 }, sfx: [{ type: "stamp" }], shake: true });
      case "app_card": return (m, t0, t1) => {
        const rows = nextTexts(t0, 3);
        const list = rows.length ? rows : [fallback(m, "نکته‌ی اصلی")];
        const step = Math.min(0.5, Math.max(0.3, (t1 - t0 - 0.9) / list.length));
        return {
          g: { type: "app_card", y: 40, title: clean(shorten(this.input.title || m.text || this.brief.pov || "معرفی", 4, 22)), subtitle: clean(shorten(this.brief.pov || m.text, 6, 34)), rows: list, row_times: list.map((_, i) => round2(0.55 + i * step)) },
          sfx: [{ type: "whoosh", t: round2(t0 - 0.08) }, ...list.map((_, i) => ({ type: "click", t: round2(t0 + 0.55 + i * step) })), { type: "ding", t: round2(t0 + 0.6 + list.length * step) }],
        };
      };
      case "ring_counter": return (m) => {
        const num = /(\d+|[۰-۹]+)\s*(درصد|٪|%)/.exec(m.text);
        const v = num ? Number(num[1].replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))) : NaN;
        return { g: { type: "ring_counter", x: 540, y: 270, label: fallback(m, ""), fill: 0.6, to: v > 0 && v <= 100 ? v / 100 : 1 }, sfx: [{ type: "riser", dur: 0.6 }] };
      };
      case "burst": return (m) => { const text = `${fallback(m, "وای")}!`; return { g: { type: "burst", text, x: 290, y: 330, size: Math.max(46, Math.min(84, Math.floor(84 * 6 / Math.max(6, text.length)))) }, sfx: [{ type: "pop" }] }; };
      case "warning_sign": return (m) => ({ g: { type: "warning_sign", x: 250, y: 290, label: fallback(m, "هشدار!") }, sfx: [{ type: "pop" }] });
      case "pill": return (m) => ({ g: { type: "pill", text: m.text && m.text.split(" ").length <= 4 ? m.text : fallback(m, this.input.title ?? "نکته"), bg: "purple", icon: "check", x: 540, y: 300, size: 50 }, sfx: [{ type: "pop" }] });
      case "live_voice": return () => ({ g: { type: "live_voice", text: "زنده · همین الان", x: 540, y: 170 }, sfx: [{ type: "beep" }] });
      case "viewfinder": return (m, _t0, t1) => ({ g: { type: "viewfinder", label: fallback(m, "در حال ضبط") }, sfx: [{ type: "beep" }, { type: "shutter", t: round2(t1 - 0.35) }] });
      case "no_human": return (m, t0, t1) => ({ g: { type: "no_human", x: 300, y: 250, slash_at: round2(Math.min(0.6, (t1 - t0) * 0.4)), label: fallback(m, "بدون دخالت انسان"), label_x: 750, label_y: 250 }, sfx: [{ type: "pop" }, { type: "swish", t: round2(t0 + Math.min(0.6, (t1 - t0) * 0.4)) }] });
      case "nle_timeline": return (_m, t0, t1) => ({ g: { type: "nle_timeline", y: 240, work: round2(Math.max(0.8, (t1 - t0) * 0.75)) }, sfx: [{ type: "ticks", dur: round2(Math.max(0.8, (t1 - t0) * 0.7)) }, { type: "ding", t: round2(t0 + Math.max(0.8, (t1 - t0) * 0.75)) }] });
      default: return null;
    }
  }

  static GRAPHIC_DUR: Record<string, number> = { kinetic_text: 1.4, speech_bubble: 1.2, stamp: 1.0, app_card: 2.6, ring_counter: 1.2, burst: 1.3, warning_sign: 1.6, pill: 1.6, live_voice: 2.0, viewfinder: 2.0, no_human: 1.6, nle_timeline: 1.8 };

  placeEffect(id: string): boolean {
    if (id === "dinosaur_walk") {
      const j = this.effects.find((e) => e.type === "jungle");
      if (j && j.t1 - j.t0 >= 3) {   // the dinosaur walks through the jungle (like test 2)
        const t0 = round2(j.t0 + 1.0), t1 = round2(Math.min(j.t1, t0 + 3));
        this.effects.push({ type: "dinosaur_walk", t0, t1, scale: 1.25, feet_y: 1690, palette: "brown", direction: "rtl", _opt: id });
        this.sfx.push({ type: "thuds", t0: round2(t0 + 0.2), t1: round2(t1 - 0.1), every: 0.62 });
        return true;
      }
    }
    const w = this.pickWindow(FX_LEN[id] ?? 3, id === "sky_fly" ? 1.5 : 1.8) ?? this.pickWindow(FX_LEN[id] ?? 3, 1.0);
    if (!w) return false;
    let [t0, t1] = w;
    if (id === "dinosaur_walk") {
      this.effects.push({ type: "dinosaur_walk", t0, t1, scale: 1.05, palette: "brown", direction: "rtl", _opt: id });
      this.sfx.push({ type: "thuds", t0: round2(t0 + 0.2), t1: round2(t1 - 0.1), every: 0.62 });
      return true;
    }
    // background replacement: its own segments (it may run across cuts), no zoom, flash in and glitch back to normal
    let i = this.splitAt(t0);
    if (i < 0) {   // too close to the start of its keep to split there: start with the keep
      const k = this.keepAt(t0);
      if (k < 0 || t0 - this.keeps[k].a >= 0.4) return false;
      i = k;
    }
    t0 = this.keeps[i].a;
    if (this.splitAt(t1) < 0) {   // too close to a keep edge to split: end at the nearer edge
      const k = this.keeps[this.keepAt(t1 - 0.01)];
      if (k) t1 = t1 - k.a < 0.4 && k.a > t0 ? k.a : k.b;
    }
    const inside = this.keeps.filter((k) => k.a >= t0 - 1e-6 && k.b <= t1 + 1e-6);
    for (const k of inside) Object.assign(k, { zoom: 1.0, push: 0, tr: "cut" });   // plain cuts inside the new world
    Object.assign(this.keeps[i], { tr: "flash", trAuto: true });
    const after = this.keeps.find((k) => k.a >= t1 - 1e-6);
    if (after && after.clip === this.keeps[i].clip && !after.tr) Object.assign(after, { tr: "glitch", trAuto: true });
    if (id === "jungle") {
      this.effects.push({ type: "jungle", t0, t1, _opt: id });
      if (t1 - t0 > 2) this.effects.push({ type: "sun", t0: round2(t0 + 0.9), t1, x: 560, y: 680, r: 95 });
      this.sfx.push({ type: "birds", t0, t1, gain: 0.9 }, { type: "impact", t: t0 });
      if (t1 - t0 > 2) this.sfx.push({ type: "ding", t: round2(t0 + 0.92) });
    } else {
      this.effects.push({ type: "sky_fly", t0, t1, _opt: id });
      this.sfx.push({ type: "whoosh", t: round2(t0 - 0.05) }, { type: "rise", t: t0, dur: round2(Math.min(1.8, t1 - t0)) });
    }
    this.busy.push([t0, Math.min(t1, t0 + 0.6)]);
    return true;
  }

  placeMotion(id: string): boolean {
    const inFx = (t: number) => this.effects.some((e) => e.type !== "dinosaur_walk" && t >= e.t0 - 0.2 && t < e.t1);
    const covered = (t: number) => this.graphics.some((g) => typeof g.t0 === "number" && t >= (g.t0 as number) - 0.2 && t < (g.t1 as number));
    const rank = (m: Moment) => Number(m.key) * 2 + Number(m.emph) - (covered(m.t) ? 2.5 : 0);
    const ranked = this.moments.filter((m) => this.shown(m.t) && !inFx(m.t) && !this.isReserved(m.t, m.t + 0.3) && this.inWindow(m.t, m.t + 0.3))
      .sort((a, b) => rank(b) - rank(a));
    const fallbackT = () => this.pick(0.5)!.t0;
    if (id === "zoom_punch") {
      const ts: number[] = [];
      for (const m of ranked) { if (ts.length >= 3) break; if (ts.every((t) => Math.abs(t - m.t) > 2.5)) ts.push(m.t); }
      if (!ts.length) ts.push(fallbackT());
      for (const t of ts) this.punches.push({ t: round2(t + 0.05), mul: 1.15, ease: 0.12, _opt: id });
      return true;
    }
    if (id === "shake") {
      const hit = this.graphics.find((g) => ["stamp", "burst", "warning_sign"].includes(g.type) && !g._auto);
      const ts = hit ? [hit.t0 as number] : [];
      for (const m of ranked) { if (ts.length >= 2) break; if (ts.every((t) => Math.abs(t - m.t) > 3)) ts.push(m.t); }
      if (!ts.length) ts.push(fallbackT());
      for (const t of ts) { this.shakes.push({ t: round2(t + 0.02), amp: 1, dur: 0.3, _opt: id }); this.sfx.push({ type: "impact", t: round2(t) }); }
      return true;
    }
    return false;
  }

  placeColdOpen(): boolean {
    // the most visual moment: an effect if there is one, else the strongest line in the second half
    const fxs = this.effects.filter((e) => e.type !== "sun");
    let a: number, b: number;
    if (fxs.length) {
      const e = fxs[0];
      a = round2(Math.min(e.t1 - 0.6, e.t0 + 0.5)); b = round2(Math.min(e.t1, a + 1.8));
    } else {
      const total = this.keeps.reduce((t, k) => t + (k.b - k.a), 0);
      let acc = 0;
      const pos = new Map(this.keeps.map((k) => { const s = acc; acc += k.b - k.a; return [k, s / Math.max(1e-6, total)]; }));
      const late = this.moments.filter((m) => { const k = this.keeps[this.keepAt(m.t)]; return k && (pos.get(k)! + (m.t - k.a) / total) > 0.4 && this.inWindow(m.t, m.t + 1); });
      const m = late.sort((x, y) => Number(y.key) * 2 + Number(y.emph) - (Number(x.key) * 2 + Number(x.emph)))[0];
      const k = m ? this.keeps[this.keepAt(m.t)] : this.keeps[Math.floor(this.keeps.length / 2)];
      a = round2(m ? m.t : (k.a + k.b) / 2 - 0.8); b = round2(Math.min(k.b, a + 1.8));
    }
    if (b - a < 0.8) { const k = this.keeps.reduce((x, y) => (y.b - y.a > x.b - x.a ? y : x)); a = round2(Math.max(k.a, (k.a + k.b) / 2 - 0.9)); b = round2(Math.min(k.b, a + 1.8)); }
    const zoomed = fxs.some((e) => a < e.t1 && e.t0 < b && e.type !== "dinosaur_walk");
    this.coldOpen = { a, b, zoom: zoomed ? 1.0 : "auto" };
    return true;
  }

  placeRewind(): boolean {
    // after the keep that ends closest to the middle of the reel, replay its last ~2.4s backwards
    const total = this.keeps.reduce((t, k) => t + (k.b - k.a), 0);
    let acc = 0, best = -1, bestD = Infinity;
    this.keeps.forEach((k, i) => {
      acc += k.b - k.a;
      if (i === this.keeps.length - 1 || k.b - k.a < 1.6 || !this.inWindow(k.a, k.b)) return;
      const d = Math.abs(acc / total - 0.5);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) {   // one long keep: split it in the middle first
      const k = this.keeps.reduce((x, y) => (y.b - y.a > x.b - x.a ? y : x));
      const i = this.splitAt((k.a + k.b) / 2, 1.0);
      if (i < 0) return false;
      best = i - 1;
    }
    const k = this.keeps[best];
    this.rewindAfter = { keep: best, a: round2(Math.max(k.a, k.b - 2.4)), b: k.b };
    const next = this.keeps[best + 1];
    if (next && !next.tr) Object.assign(next, { tr: "flash", trAuto: true });
    return true;
  }

  /** Transitions between segments. Each selected one appears at least once; clip joins always get one. */
  placeTransitions() {
    const pool = TRANSITIONS.filter((t) => this.selected.has(t));
    const freeIdx = () => this.keeps.map((_, i) => i).filter((i) => i > 0 && !this.keeps[i].tr);
    // not enough boundaries for the selected transitions: split the longest keeps between captions
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
      // spread the selected transitions evenly; on a collision take the nearest free boundary
      const want = Math.floor(((j + 0.5) * idx.length) / pool.length);
      const order = idx.map((_, k) => k).filter((k) => !taken.has(k)).sort((x, y) => Math.abs(x - want) - Math.abs(y - want));
      if (!order.length) return;
      taken.add(order[0]);
      Object.assign(this.keeps[idx[order[0]]], { tr, trAuto: false });
    });
    let n = 0, cycle = 0;
    this.keeps.forEach((k, i) => {
      if (i === 0 || k.tr) return;
      n++;
      const join = k.clip !== this.keeps[i - 1].clip;
      if (join || n % 3 === 0) { k.tr = pool.length ? pool[cycle++ % pool.length] : "whip"; k.trAuto = true; }
    });
  }

  // ---------------------------------------------------------------- 7. director's own additions
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
      // the creator already picked this graphic and it is in the reel: don't repeat it
      if (this.graphics.some((g) => g.type === made.g.type && g._opt && !g._auto)) return;
      this.graphics.push({ ...made.g, t0, t1, _line: w.w, _opt: made.g.type, _auto: true });
      for (const s of made.sfx ?? []) this.sfx.push({ ...s, t: round2(Math.max(0, t0 - 0.02)) });
      if (made.g.type === "stamp") this.shakes.push({ t: round2(t0 + 0.02), amp: 1, dur: 0.3 });
      this.busy.push([t0, t1]); used.add(ri); lastG = t0;
    });
  }

  /** Something should change on screen every ~3s: punch in on emphasised words where nothing happens. */
  pacingPunches() {
    const events = [...this.graphics.map((g) => g.t0 as number), ...this.keeps.map((k) => k.a), ...this.punches.map((p) => p.t), ...this.effects.map((e) => e.t0)].sort((a, b) => a - b);
    let lastEv = events[0] ?? 0;
    for (const m of this.moments) {
      const prevEv = Math.max(lastEv, ...events.filter((e) => e <= m.t));
      const near = this.punches.some((p) => Math.abs(p.t - m.t) < 1.5);
      if (!near && m.t - prevEv > 2.8 && (m.emph || !m.text) && this.shown(m.t) && !this.effects.some((e) => m.t >= e.t0 && m.t < e.t1)) {
        this.punches.push({ t: m.t, mul: 1.12, ease: 0.14, _opt: "zoom_punch", _auto: true });
        lastEv = m.t;
      }
    }
  }

  // ---------------------------------------------------------------- 8. assemble
  timeline(): EditPlan["timeline"] {
    const tl: EditPlan["timeline"] = [];
    if (this.coldOpen) tl.push({ src: [this.coldOpen.a, this.coldOpen.b], role: "cold_open", zoom: this.coldOpen.zoom, push: 0, _opt: "cold_open" } as EditPlan["timeline"][number]);
    this.keeps.forEach((k, i) => {
      const first = i === 0;
      const tr = first ? (this.coldOpen ? "whip" : "cut") : (k.tr ?? "cut");
      tl.push({ src: [k.a, k.b], zoom: k.zoom ?? "auto", ...(k.push !== undefined ? { push: k.push } : {}), transition_in: tr,
        ...(tr !== "cut" ? { _opt: tr, _auto: first ? true : k.trAuto !== false } : {}) } as EditPlan["timeline"][number]);
      if (this.rewindAfter && this.rewindAfter.keep === i) {
        tl.push({ src: [this.rewindAfter.a, this.rewindAfter.b], role: "rewind", reverse: true, speed: 4, captions: false, voice: false, zoom: 1.0, _opt: "rewind" } as EditPlan["timeline"][number]);
      }
    });
    return tl;
  }

  plan(): EditPlan {
    const { input } = this;
    const { style, analysis } = input;
    const timeline = this.timeline();
    const fps = 30;
    if (this.coldOpen) {
      const dur = round2(segmentSeconds(timeline[0], fps));
      if (this.hookLines.length) this.graphics.unshift({ type: "kinetic_text", role: "cold_open", at: 0, dur, y: 230, lines: this.hookLines, _line: "hook" });
      this.sfx.push({ type: "impact", role: "cold_open", at: 0 });
    }
    if (this.rewindAfter) {
      const seg = timeline.find((s) => s.role === "rewind")!;
      const dur = round2(segmentSeconds(seg, fps));
      this.graphics.push({ type: "vhs_rewind", role: "rewind", at: 0, dur, text: "برگشت", _opt: "rewind_label" });
      this.sfx.push({ type: "rewind", role: "rewind", at: 0, dur });
    }
    const noSpeech = !this.words.length && (analysis.speech?.has_audio ?? true);
    const plan: EditPlan = {
      _comment: `rule director v0.2${input.note ? ` — revision note (not applied by the rule director): ${input.note}` : ""}`,
      _brief: { pov: this.brief.pov, description: this.brief.description, options: [...this.selected] },
      source: input.sourcePath,
      output: { path: input.outputPath, w: 1080, h: 1920, fps },
      timeline,
      auto_zoom: { target_head_px: 185, max: 1.4 },
      zoom: { slow_push_per_sec: 0.012, punches: this.punches.sort((a, b) => a.t - b.t) },
      grade: { contrast: 1.1, saturation: 1.14, warmth: 0.03, highlight_rolloff: 0.12, vignette: 0.2 },
      grain: style.grain ? 4 : 0,
      captions: this.captions,
      effects: this.effects,
      graphics: this.graphics,
      shakes: this.shakes,
      sfx: this.sfx,
      // no speech: keep the original sound as it is (the voice chain would treat music/ambience as a voice)
      audio: { music: { gain_db: style.musicGainDb, off: !style.music }, ...(noSpeech ? { voice_chain: "anull" } : {}) },
      matting: { clean_plate: false },
      progress_bar: style.progressBar,
    };
    plan._usage = usageOf(plan);
    const missing = [...this.selected].filter((id) => !plan._usage!.some((u) => u.id === id && !u.auto));
    if (missing.length) plan._missing = missing;
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
    // selected options first: they must appear. Background effects need the longest windows, so they go first.
    for (const id of ["jungle", "sky_fly", "dinosaur_walk"]) if (this.selected.has(id)) this.placeEffect(id);
    for (const id of Object.keys(PlanBuilder.GRAPHIC_DUR)) {
      if (!this.selected.has(id)) continue;
      const make = this.graphicMaker(id)!;
      this.addGraphic(id, PlanBuilder.GRAPHIC_DUR[id], make, false, id === "app_card" ? 1.6 : 0.8);
    }
    for (const id of ["zoom_punch", "shake"]) if (this.selected.has(id)) this.placeMotion(id);
    if (this.selected.has("cold_open")) this.placeColdOpen();
    if (this.selected.has("rewind")) this.placeRewind();
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
  const add = (id: unknown, t: number | null, auto: unknown) => { if (typeof id === "string" && t !== null && OPTION_IDS.has(id)) out.push({ id, out: round2(t), auto: !!auto }); };
  plan.timeline.forEach((s, i) => { const x = s as typeof s & Tagged; add(x._opt, x.role === "cold_open" ? 0 : starts[i], x._auto); });
  for (const g of plan.graphics as Array<Spec & Tagged>) {
    if ("role" in g) { const r = roleStart(g.role as string); add(g._opt, r === null ? null : r + (g.at as number), g._auto); }
    else add(g._opt, srcToOut(plan, g.t0 as number), g._auto);
  }
  for (const e of plan.effects as Array<Spec & Tagged & { t0: number }>) add(e._opt, srcToOut(plan, e.t0), e._auto);
  for (const p of (plan.zoom?.punches ?? []) as Array<{ t: number } & Tagged>) add(p._opt, srcToOut(plan, p.t), p._auto);
  for (const s of (plan.shakes ?? []) as Array<{ t: number } & Tagged>) add(s._opt, srcToOut(plan, s.t), s._auto);
  return out.sort((a, b) => a.out - b.out);
}

export class RuleDirector implements Director {
  readonly name = "rule" as const;
  async createPlan(input: DirectorInput): Promise<EditPlan> {
    return new PlanBuilder(input).build();
  }
}
