/**
 * Rule-based director: a deterministic baseline that needs no API key.
 * It does what a careful junior editor would do from the transcript alone:
 * cut pauses, keep the speaker framed, caption in short chunks, put a hook first and a CTA last,
 * and illustrate a few recognisable phrases with graphics from the engine's toolbox.
 * The Claude director (step 3) replaces it and can also use effects (jungle, sun, dinosaur, ...).
 */
import type { EditPlan, Word } from "@autoreel/shared";
import { round2 } from "@autoreel/shared";
import type { Director, DirectorInput } from "./types.ts";

const STOP = new Set(["و", "که", "از", "به", "با", "در", "این", "اون", "یه", "یک", "را", "رو", "هم", "تا", "برای", "من", "تو", "ما", "شما", "اگه", "یا", "هست", "است", "بود", "می‌خوام", "دارم",
  "واقع", "بهتون", "اینکه", "دارین", "ویدیو", "ویدیوی", "میشه", "می‌شه", "کنم", "کردم", "دوستان", "همین", "خیلی", "باید", "میخوام", "می‌کنم", "بعد"]);
const PUNCT_END = /[،.!؟?!:]$/;
const norm = (w: string) => w.replace(/[،.!؟?!:«»"']/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک");

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

export class RuleDirector implements Director {
  readonly name = "rule" as const;

  async createPlan(input: DirectorInput): Promise<EditPlan> {
    const { analysis, transcript, style } = input;
    const D = analysis.info.duration;
    const words: Word[] = transcript.flatMap((s) => s.words).filter((w) => w.w.trim()).map((w) => ({ ...w })).sort((a, b) => a.s - b.s);
    if (!words.length) throw new Error("transcript has no words");
    // Speech-to-text stretches words over silences. Pauses come from audio energy, so move word edges out of them.
    for (const [a, b] of analysis.pauses) {
      if (b - a < 0.15) continue;
      for (const w of words) {
        if (w.s < a && w.e > a) w.e = Math.max(w.s + 0.05, a);          // word runs into the pause: end it there
        else if (w.s >= a && w.s < b) { const d = Math.max(0.12, w.e - w.s); w.s = b; w.e = Math.max(w.e, b + Math.min(d, 0.4)); }
      }
    }
    words.sort((x, y) => x.s - y.s);
    for (let i = 1; i < words.length; i++) if (words[i].s < words[i - 1].s + 0.06) words[i].s = round2(words[i - 1].s + 0.06);

    // ---------------------------------------------------------------- cuts
    const speechStart = Math.max(0, words[0].s - 0.12);
    const speechEnd = Math.min(D, words.at(-1)!.e + 0.3);
    const cuts: Array<[number, number]> = [];
    for (const [a, b] of analysis.pauses) {
      if (b - a < style.minPause || a <= speechStart || b >= speechEnd) continue;
      const ca = a + 0.08, cb = b - 0.08;
      // pauses come from the audio energy, so they are real silence; speech-to-text often stretches a word
      // across a pause, so only refuse the cut if a whole word would disappear inside it
      if (words.some((w) => w.s >= ca && w.e <= cb)) continue;
      cuts.push([ca, cb]);
    }
    let keeps: Array<[number, number]> = [];
    let t = speechStart;
    for (const [a, b] of cuts) { keeps.push([t, a]); t = b; }
    keeps.push([t, speechEnd]);
    // merge keeps shorter than 0.5s into the previous one (a cut there would look nervous)
    keeps = keeps.reduce<Array<[number, number]>>((acc, k) => {
      if (acc.length && k[1] - k[0] < 0.5) acc[acc.length - 1][1] = k[1]; else acc.push([...k] as [number, number]);
      return acc;
    }, []).map(([a, b]) => [round2(a), round2(b)]);
    const shown = (x: number) => keeps.some(([a, b]) => x >= a && x < b);
    const keepEnd = (x: number) => keeps.find(([a, b]) => x >= a && x < b)?.[1] ?? x;

    const timeline = keeps.map(([a, b], i) => ({
      src: [a, b] as [number, number],
      zoom: "auto" as const,
      transition_in: i === 0 ? "cut" : i % 3 === 0 ? "whip" : "cut",
    }));

    // ---------------------------------------------------------------- captions
    const captions: EditPlan["captions"] = [];
    let cur: Word[] = [];
    const flush = (next?: Word) => {
      if (!cur.length) return;
      const text = cur.map((w) => w.w).join(" ");
      const t0 = cur[0].s;
      let t1 = next ? Math.min(next.s, cur.at(-1)!.e + 0.35) : cur.at(-1)!.e + 0.3;
      t1 = Math.max(t1, t0 + 0.35);
      const strip = (w: string) => w.replace(/^[!؟،.]+|[!؟،.]+$/g, ""); // same stripping the engine uses
      const cands = cur.map((w) => strip(w.w)).filter((w) => norm(w).length >= 4 && !STOP.has(norm(w)));
      cands.sort((a, b) => b.length - a.length);
      captions.push({ t0: round2(t0), t1: round2(t1), text, ...(cands.length ? { emph: [cands[0]] } : {}) });
      cur = [];
    };
    words.forEach((w, i) => {
      const prev = cur.at(-1);
      if (prev && (cur.length >= 4 || w.s - prev.e > 0.25 || w.e - cur[0].s > 1.9 || PUNCT_END.test(prev.w))) flush(w);
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

    // ---------------------------------------------------------------- graphics from phrases
    const graphics: EditPlan["graphics"] = [];
    const sfx: EditPlan["sfx"] = [];
    const busy: Array<[number, number]> = [];
    const free = (a: number, b: number) => !busy.some(([x, y]) => a < y && x < b);
    const gap = DENSITY_GAP[style.graphicsDensity];
    let lastG = -Infinity;
    const hookEnd = keeps[0][0] + 2.3;
    if (style.hookText.trim()) {
      const ws = style.hookText.trim().split(/\s+/);
      const cut = ws.length > 3 ? Math.ceil(ws.length / 3) : ws.length;
      const lines = [{ text: ws.slice(0, cut).join(" "), size: 120, color: "accent" }];
      if (cut < ws.length) lines.push({ text: ws.slice(cut).join(" "), size: 80, color: "white" });
      graphics.push({ type: "kinetic_text", t0: keeps[0][0], t1: round2(hookEnd), y: 230, lines, _line: "hook" });
      sfx.push({ type: "impact", t: keeps[0][0] });
      busy.push([keeps[0][0], hookEnd]);
      lastG = keeps[0][0];
    }
    const used = new Set<number>();
    const normWords = words.map((w) => norm(w.w));
    words.forEach((w, i) => {
      const nw = normWords[i];
      const ri = RULES.findIndex((r, k) => !used.has(k) && r.test(nw, normWords.slice(0, i)));
      if (ri < 0 || !shown(w.s) || w.s - lastG < gap) return;
      const t0 = round2(w.s);
      const t1max = keepEnd(w.s);
      const probe = RULES[ri].make(t0, 1.5);
      const t1 = round2(Math.min(t1max, t0 + (probe.dur ?? 1.5)));
      if (t1 - t0 < 0.6 || !free(t0, t1)) return;
      const made = RULES[ri].make(t0, t1 - t0);
      graphics.push({ ...made.g, t0, t1, _line: w.w });
      for (const s of made.sfx ?? []) sfx.push({ ...s, t: round2(Math.max(0, t0 - 0.02)) });
      busy.push([t0, t1]); used.add(ri); lastG = t0;
    });

    // ---------------------------------------------------------------- CTA
    const last = keeps.at(-1)!;
    if (style.ctaText.trim() && last[1] - last[0] > 1.2) {
      const t0 = round2(Math.max(last[0], last[1] - 2.2));
      graphics.push({ type: "pill", text: style.ctaText.trim(), bg: "purple", x: 540, y: 230, size: 48, t0, t1: last[1], _line: "CTA" });
      sfx.push({ type: "pop", t: t0 });
    }

    // ---------------------------------------------------------------- pacing: punch in where nothing happens
    const punches: Array<{ t: number; mul: number; ease: number }> = [];
    const events = [...graphics.map((g) => g.t0 as number), ...keeps.map((k) => k[0])].sort((a, b) => a - b);
    let lastEv = events[0] ?? 0;
    for (const c of captions) {
      const prevEv = Math.max(lastEv, ...events.filter((e) => e <= c.t0));
      if (c.t0 - prevEv > 2.8 && c.emph?.length && shown(c.t0)) {
        punches.push({ t: c.t0, mul: 1.12, ease: 0.14 });
        lastEv = c.t0;
      }
    }

    return {
      _comment: `rule director v0.1${input.note ? ` — revision note (not applied by the rule director): ${input.note}` : ""}`,
      source: input.sourcePath,
      output: { path: input.outputPath, w: 1080, h: 1920, fps: 30 },
      timeline,
      auto_zoom: { target_head_px: 185, max: 1.4 },
      zoom: { slow_push_per_sec: 0.012, punches },
      grade: { contrast: 1.1, saturation: 1.14, warmth: 0.03, highlight_rolloff: 0.12, vignette: 0.2 },
      grain: style.grain ? 4 : 0,
      captions,
      effects: [],
      graphics,
      shakes: graphics.filter((g) => g.type === "stamp").map((g) => ({ t: (g.t0 as number) + 0.02, amp: 1, dur: 0.3 })),
      sfx,
      audio: { music: { gain_db: style.musicGainDb, off: !style.music } },
      matting: { clean_plate: false },
      progress_bar: style.progressBar,
    };
  }
}
