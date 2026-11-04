/**
 * Quick check of the rule director on a stored analysis + transcript, without the database:
 *   npx tsx src/selftest.ts <analysis.json> <segments.json> [--fix fix.json] [--brief brief.json] [--clips clips.json] [--out plan.json]
 * brief.json = {"pov": "...", "description": "...", "options": [{"id": "scene", "params": {"places": ["beach"]}}, "stamp", ...]}
 */
import fs from "node:fs";
import { DEFAULT_STYLE, retimeSegment, optionLabel, type TranscriptSegment } from "@autoreel/shared";
import { RuleDirector } from "./rule.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const read = (p?: string) => (p ? JSON.parse(fs.readFileSync(p, "utf8")) : undefined);
const [analysisPath, segPath] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const analysis = read(analysisPath);
let segs: TranscriptSegment[] = segPath && segPath !== "-" ? read(segPath) : analysis.transcript?.segments ?? [];
const fix: { segments: Array<{ index: number; text: string }> } | undefined = read(flag("--fix"));
if (fix) segs = segs.map((s, i) => { const f = fix.segments.find((x) => x.index === i); return f ? retimeSegment(s, f.text) : s; });

const plan = await new RuleDirector().createPlan({
  analysis, transcript: segs, style: DEFAULT_STYLE, sourcePath: flag("--source") ?? "../source.mp4", outputPath: "../renders/t.mp4",
  brief: read(flag("--brief")), clips: read(flag("--clips")),
});
if (flag("--out")) fs.writeFileSync(flag("--out")!, JSON.stringify(plan, null, 1));
console.log("segments", plan.timeline.length, plan.timeline.map((t) => `${t.role ? t.role + ":" : ""}${t.src.join("-")}${t.transition_in && t.transition_in !== "cut" ? `(${t.transition_in})` : ""}`).join("  "));
console.log("captions", plan.captions.length, plan.captions.slice(0, 8).map((c) => `${c.text} [${c.emph ?? ""}]`).join(" | "));
console.log("graphics", plan.graphics.map((g) => `${g.type}@${g.t0 ?? g.role}`).join(", "));
console.log("effects", plan.effects.map((e) => `${e.type}@${e.t0}-${e.t1}`).join(", "));
console.log("usage", (plan._usage ?? []).map((u) => `${u.label ?? optionLabel(u.id)}${u.auto ? "*" : ""}@${u.out}`).join(" | "));
if (plan._notes) console.log("notes", plan._notes);
console.log("theme", JSON.stringify(plan._theme), "look", JSON.stringify(plan.look ?? null), "skin", plan.skin ?? "clean");
if (plan._missing) console.log("MISSING", plan._missing);
