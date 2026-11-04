/**
 * Renders the short looping previews shown when the creator points at an option or one of its types in the panel.
 * Each preview is the real engine output for that one choice on a few seconds of a sample video.
 *
 *   npx tsx src/previews.ts <analysis.json> <segments.json> --source sample.mp4 --out ../../apps/web/public/previews
 *       [--fix fix.json] [--only look-cartoon,scene-beach] [--group look] [-j 2] [--skip-existing]
 *
 * Windows below are written for test video 2. For another sample video, change WINDOWS.
 * Preview names come from the catalog (EditOption.preview and Choice.preview).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DEFAULT_STYLE, EDIT_OPTIONS, retimeSegment, type ParamValue, type Selection, type TranscriptSegment } from "@autoreel/shared";
import { PlanBuilder } from "./rule.ts";

const W_GFX: [number, number] = [8.2, 11.6];
/** Source window per option (test video 2). */
const WINDOWS: Record<string, [number, number]> = {
  look: [8.2, 11.2], overlay: [8.2, 11.2],
  scene: [3.0, 7.4], sky_fly: [18.5, 21.7], flyover: [20.6, 23.8], particles: [8.2, 11.4], focus: [8.2, 11.2], glow: [8.2, 11.2], clones: [8.2, 11.2],
  zoom_punch: [8.2, 11.4], slow_zoom: [8.2, 11.4], shake: [3.0, 6.0], tilt: [8.2, 11.2], freeze: [8.2, 11.4],
  kinetic_text: [14.1, 17.1], speech_bubble: [0.5, 3.3], stamp: [3.0, 6.0], pill: [4.5, 7.6], lower_third: [8.2, 11.4],
  list_card: [3.0, 6.6], compare: W_GFX, stat: W_GFX, notification: W_GFX, chat: [8.2, 11.9], search_bar: W_GFX, timer: [8.2, 12.4],
  callout: W_GFX, emoji: W_GFX, burst: [17.4, 20.3], warning_sign: [21.6, 24.6], prohibit: [15.5, 18.6], viewfinder: [8.2, 11.4],
  live_voice: [21.6, 24.8], cta: W_GFX, quote: [8.2, 11.4], price_tag: W_GFX, location: W_GFX,
  transition: [8.2, 11.6], cold_open: [10.6, 14.6], rewind: [12.7, 16.9], replay: [8.2, 12.4], loop_end: [8.2, 11.2],
};
/** Sample texts so every preview reads well (the real reel takes them from the speech). */
const SAMPLE: Record<string, Record<string, ParamValue>> = {
  kinetic_text: { text: "هوش مصنوعی" }, speech_bubble: { text: "سلام!" }, stamp: { text: "نسخه تستی" }, pill: { text: "محصولی که درست کردم" },
  lower_third: { name: "امیر پاپای", role: "سازنده‌ی AutoReel" },
  list_card: { title: "سه قدم ساده", items: "آپلود ویدیو\nتأیید متن\nتحویل ریلز" },
  stat: { value: "۸۰٪", label: "کامل" }, search_bar: { query: "چطور ریلز رو خودکار ادیت کنم؟" }, timer: { seconds: "3" },
  callout: { label: "این منم" }, emoji: { emojis: ["fire", "laugh", "hundred"] }, burst: { text: "افکت!" }, warning_sign: { label: "هشدار!" },
  prohibit: { label: "بدون دخالت انسان" }, viewfinder: { label: "فیلم خام" }, quote: { text: "کاری که امروز می‌تونی بکنی رو به فردا نسپار." },
  price_tag: { price: "۴۹۰ هزار تومان", old_price: "۹۹۰ هزار" }, location: { place: "تهران" }, freeze: { label: "این منم!" },
};
const PER_CHOICE: Record<string, Record<string, ParamValue>> = {
  "list_card-pros_cons": { items: "سریع\nارزون\n-هنوز API نداره", title: "" },
  "stat-count": { value: "۱۲۰۰", label: "دنبال‌کننده‌ی جدید" }, "stat-bars": { value: "+۳۰۰٪", label: "رشد پیج" }, "stat-progress": { value: "80", label: "در حال ادیت" },
  "scene-change_fade": { places: ["beach", "space"] }, "scene-change_flash": { places: ["beach", "space"] },
  "scene-change_wipe": { places: ["beach", "space"] }, "scene-change_glitch": { places: ["beach", "space"] },
};

interface Job { name: string; opt: string; sels: Selection[]; window: [number, number]; kind: string }

/** Every preview name in the catalog, with the selection that shows it. */
function jobs(): Job[] {
  const out = new Map<string, Job>();
  const add = (name: string | undefined, opt: string, params: Record<string, ParamValue>) => {
    if (!name || out.has(name)) return;
    const o = EDIT_OPTIONS.find((x) => x.id === opt)!;
    const p = { ...(SAMPLE[opt] ?? {}), ...params, ...(PER_CHOICE[name] ?? {}) };
    const sels: Selection[] = [{ id: opt, params: p }];
    // a look is easier to judge with a graphic on top: graphics follow the look
    if (o.group === "look" && opt === "look") sels.push({ id: "kinetic_text", params: { text: "هوش مصنوعی", anim: "pop" } });
    out.set(name, { name, opt, sels, window: WINDOWS[opt] ?? W_GFX, kind: o.group });
  };
  for (const o of EDIT_OPTIONS) {
    for (const p of o.params) {
      if (p.kind !== "one" && p.kind !== "many") continue;
      for (const ch of p.choices) {
        if (!ch.preview || ch.locked || ch.preview.startsWith("gen-")) continue;   // gen-* needs the generator
        const params: Record<string, ParamValue> = p.kind === "many" ? { [p.id]: [ch.id] } : { [p.id]: ch.id };
        if (ch.when) params[ch.when.param] = ch.when.in[0];
        if (o.id === "look" && p.id === "family") params.style = { real: "cinematic", cartoon: "cartoon", drawing: "sketch", painting: "watercolor", digital: "neon" }[ch.id] ?? "cinematic";
        if (o.id === "look" && p.id === "scope") params.family = "cartoon", params.style = "cartoon";
        if (o.id === "scene" && p.id === "style") Object.assign(params, { source: "drawn", places: ["jungle"] });
        add(ch.preview, o.id, params);
      }
    }
    add(o.preview, o.id, {});
  }
  return [...out.values()];
}

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith("-") && !(args[i - 1]?.startsWith("-") && !["--skip-existing", "--list", "--dry"].includes(args[i - 1])));
const [analysisPath, segPath] = positional;
const list = jobs();
if (args.includes("--list")) { for (const j of list) console.log(j.name, j.opt, JSON.stringify(j.sels[0].params)); process.exit(0); }
const source = path.resolve(flag("--source")!);
const outDir = path.resolve(flag("--out") ?? "previews");
const only = flag("--only")?.split(",");
const group = flag("--group");
const skip = args.includes("--skip-existing");
const workers = flag("-j") ?? String(Math.max(1, os.cpus().length - 1));
const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
let segs: TranscriptSegment[] = JSON.parse(fs.readFileSync(segPath, "utf8"));
if (flag("--fix")) {
  const fix: { segments: Array<{ index: number; text: string }> } = JSON.parse(fs.readFileSync(flag("--fix")!, "utf8"));
  segs = segs.map((s, i) => { const f = fix.segments.find((x) => x.index === i); return f ? retimeSegment(s, f.text) : s; });
}
const work = path.join(outDir, ".work");
fs.mkdirSync(work, { recursive: true });
const run = (cmd: string, a: string[]) => {
  const r = spawnSync(cmd, a, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${a.slice(0, 3).join(" ")} failed`);
  return r.stdout;
};

let n = 0;
const todo = list.filter((j) => (!only || only.includes(j.name)) && (!group || j.kind === group) && !(skip && fs.existsSync(path.join(outDir, `${j.name}.mp4`))));
console.log(`${todo.length} previews to render`);
for (const j of todo) {
  const full = path.join(work, `${j.name}.mp4`);
  const style = { ...DEFAULT_STYLE, hookText: "", ctaText: "", minPause: 99, music: false, progressBar: false, grain: false };
  let plan;
  try {
    plan = new PlanBuilder(
      { analysis, transcript: segs, style, sourcePath: source, outputPath: full, brief: { options: j.sels } },
      { hook: false, cta: false, autoRules: false, pacing: false, window: j.window },
    ).build();
  } catch (e) { console.warn(`${j.name}: plan failed: ${(e as Error).message}`); continue; }
  if (plan._missing?.length) console.warn(`${j.name}: missing ${plan._missing.join(",")}`);
  if (args.includes("--dry")) { console.log(`${j.name}: ${plan.timeline.length} segs, usage ${(plan._usage ?? []).map((u) => u.id + "@" + u.out).join(" ")}`); continue; }
  const at = plan._usage?.find((u) => u.id === j.opt)?.out ?? 0.5;
  const planPath = path.join(work, `${j.name}.json`);
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 1));
  const t = Date.now();
  try {
    run("autoedit", ["render", planPath, "-j", workers, "--skip-validate"]);
    // small, silent, loops well
    run("ffmpeg", ["-v", "error", "-y", "-i", full, "-an", "-vf", "scale=270:480:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "29",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(outDir, `${j.name}.mp4`)]);
    const posterAt = Math.max(0, at + (j.kind === "transition" ? 0.12 : 0.7));
    run("ffmpeg", ["-v", "error", "-y", "-ss", posterAt.toFixed(2), "-i", full, "-frames:v", "1", "-vf", "scale=270:480:flags=lanczos", "-q:v", "5", path.join(outDir, `${j.name}.jpg`)]);
  } catch (e) { console.warn(`${j.name}: render failed: ${(e as Error).message}`); continue; }
  fs.rmSync(full, { force: true });
  n++;
  console.log(`[${n}/${todo.length}] ${j.name}: ${((Date.now() - t) / 1000).toFixed(0)}s (shows at ${at}s)`);
}
fs.rmSync(work, { recursive: true, force: true });
