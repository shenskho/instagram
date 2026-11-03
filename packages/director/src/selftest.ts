/** Quick check of the rule director on a stored analysis + transcript: npx tsx src/selftest.ts <analysis.json> <segments.json> */
import fs from "node:fs";
import { DEFAULT_STYLE, retimeSegment, type TranscriptSegment } from "@autoreel/shared";
import { RuleDirector } from "./rule.ts";

const [analysisPath, segPath, fixPath] = process.argv.slice(2);
const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
let segs: TranscriptSegment[] = JSON.parse(fs.readFileSync(segPath, "utf8"));
if (fixPath) {
  const fix: { segments: Array<{ index: number; text: string }> } = JSON.parse(fs.readFileSync(fixPath, "utf8"));
  segs = segs.map((s, i) => { const f = fix.segments.find((x) => x.index === i); return f ? retimeSegment(s, f.text) : s; });
}
const plan = await new RuleDirector().createPlan({ analysis, transcript: segs, style: DEFAULT_STYLE, sourcePath: "../source.mp4", outputPath: "../renders/t.mp4" });
console.log("segments", plan.timeline.length, plan.timeline.map((t) => t.src.join("-")).join("  "));
console.log("captions", plan.captions.length, plan.captions.slice(0, 10).map((c) => `${c.text} [${c.emph ?? ""}]`).join(" | "));
console.log("graphics", plan.graphics.map((g) => `${g.type}@${g.t0}`).join(", "));
