/**
 * Renders the short looping previews shown when the creator points at an edit option in the panel.
 * Each preview is the real engine output for that one option on a few seconds of a sample video.
 *
 *   npx tsx src/previews.ts <analysis.json> <segments.json> --source sample.mp4 --out ../../apps/web/public/previews
 *       [--fix fix.json] [--only stamp,jungle] [-j 2]
 *
 * Windows and texts below are written for test video 2 (see docs). For another sample video, change WINDOWS.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DEFAULT_STYLE, EDIT_OPTIONS, retimeSegment, type TranscriptSegment } from "@autoreel/shared";
import { PlanBuilder } from "./rule.ts";

type Patch = Record<string, unknown>;
const WINDOWS: Record<string, { w: [number, number]; patch?: Patch }> = {
  kinetic_text: { w: [14.1, 17.1], patch: { lines: [{ text: "هوش مصنوعی", size: 124, color: "accent" }] } },
  speech_bubble: { w: [0.5, 3.3], patch: { text: "سلام!" } },
  stamp: { w: [3.0, 6.0], patch: { text: "نسخه تستی", sub: "آزمایشی" } },
  app_card: { w: [3.0, 6.6], patch: { title: "ادیتور خودکار ریلز", subtitle: "محصولی که درست کردم", rows: ["زیرنویس خودکار", "موشن‌گرافیک از روی حرف‌ها", "انتشار خودکار"] } },
  ring_counter: { w: [8.2, 11.2], patch: { label: "کامل" } },
  burst: { w: [17.4, 20.3], patch: { text: "افکت!", size: 84 } },
  warning_sign: { w: [21.6, 24.6], patch: { label: "هشدار!" } },
  pill: { w: [4.5, 7.6], patch: { text: "محصولی که درست کردم" } },
  live_voice: { w: [21.6, 24.8] },
  viewfinder: { w: [8.2, 11.4], patch: { label: "فیلم خام" } },
  no_human: { w: [15.5, 18.6], patch: { label: "۰٪ دخالت انسان" } },
  nle_timeline: { w: [12.7, 15.7] },
  zoom_punch: { w: [8.2, 11.4] },
  shake: { w: [3.0, 6.0] },
  jungle: { w: [24.4, 28.4] },
  sky_fly: { w: [18.5, 21.7] },
  dinosaur_walk: { w: [20.6, 23.6] },
  whip: { w: [8.2, 11.6] }, flash: { w: [8.2, 11.6] }, zoom_in: { w: [8.2, 11.6] }, glitch: { w: [8.2, 11.6] },
  cold_open: { w: [10.6, 14.6] },
  rewind: { w: [12.7, 16.9] },
};

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const [analysisPath, segPath] = args.filter((a, i) => !a.startsWith("-") && !args[i - 1]?.startsWith("-"));
const source = path.resolve(flag("--source")!);
const outDir = path.resolve(flag("--out") ?? "previews");
const only = flag("--only")?.split(",");
const jobs = flag("-j") ?? String(Math.max(1, os.cpus().length - 1));
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

for (const o of EDIT_OPTIONS) {
  if (only && !only.includes(o.id)) continue;
  const spec = WINDOWS[o.id];
  if (!spec) { console.warn(`no window for ${o.id}`); continue; }
  const full = path.join(work, `${o.id}.mp4`);
  const style = { ...DEFAULT_STYLE, hookText: "", ctaText: "", minPause: 99, music: false, progressBar: false };
  const plan = new PlanBuilder(
    { analysis, transcript: segs, style, sourcePath: source, outputPath: full, brief: { options: [o.id] } },
    { hook: false, cta: false, autoRules: false, pacing: false, window: spec.w },
  ).build();
  if (spec.patch) for (const g of plan.graphics) if (g._opt === o.id) Object.assign(g, spec.patch);
  const at = plan._usage?.find((u) => u.id === o.id)?.out ?? 0.5;
  const planPath = path.join(work, `${o.id}.json`);
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 1));
  const t = Date.now();
  run("autoedit", ["render", planPath, "-j", jobs, "--skip-validate"]);
  // small, silent, loops well: 360x640, no sound
  run("ffmpeg", ["-v", "error", "-y", "-i", full, "-an", "-vf", "scale=360:640:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "27",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(outDir, `${o.id}.mp4`)]);
  const posterAt = Math.max(0, at + (o.group === "edit" ? 0.12 : 0.6));
  run("ffmpeg", ["-v", "error", "-y", "-ss", posterAt.toFixed(2), "-i", full, "-frames:v", "1", "-vf", "scale=360:640:flags=lanczos", "-q:v", "4", path.join(outDir, `${o.id}.jpg`)]);
  console.log(`${o.id}: ${((Date.now() - t) / 1000).toFixed(0)}s (shows at ${at}s)`);
}
fs.rmSync(work, { recursive: true, force: true });
