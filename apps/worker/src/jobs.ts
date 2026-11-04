import fs from "node:fs";
import path from "node:path";
import { videos, transcripts, plans, renders, styleSettings, eq, desc, type Db } from "@autoreel/db";
import { DEFAULT_STYLE, normalizeSelections, type Clip, type EditPlan, type JobPayload, type TranscriptSegment, type VideoStatus } from "@autoreel/shared";
import { getDirector, type Analysis } from "@autoreel/director";
import { runEngine, RENDER_WORKERS } from "./engine.ts";
import { setupImagegen } from "./imagegen.ts";

const STORAGE = path.resolve(process.env.STORAGE_DIR ?? path.resolve(import.meta.dirname, "../../../storage"));
const MAX_SECONDS = Number(process.env.MAX_VIDEO_SECONDS ?? 120);
const STT = process.env.STT ?? "local";
const abs = (rel: string) => path.join(STORAGE, rel);
const vdir = (id: string) => path.join("videos", id);

class UserError extends Error {}

export function makeJobs(db: Db, log: (m: string) => void) {
  const imagegen = setupImagegen(STORAGE, log);
  // Drizzle queries only run when awaited, and progress updates are fired without awaiting from engine output.
  // Updates for one video are chained so a late progress line can never overwrite the final status.
  const chains = new Map<string, Promise<void>>();
  const set = (id: string, v: Partial<{ status: VideoStatus; stage: string | null; progress: number; error: string | null }>) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(async () => {
      try { await db.update(videos).set({ ...v, updatedAt: new Date() }).where(eq(videos.id, id)); }
      catch (e) { log(`[${id}] status update failed: ${(e as Error).message}`); }
    });
    chains.set(id, next);
    return next;
  };

  const getVideo = async (id: string) => {
    const [v] = await db.select().from(videos).where(eq(videos.id, id));
    if (!v) throw new UserError("video not found");
    return v;
  };

  async function fail(id: string, err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${id}] failed: ${msg}`);
    await set(id, { status: "failed", error: msg.slice(0, 4000), stage: null });
  }

  /**
   * Several uploads are joined into one vertical source (clip boundaries are kept for the director).
   * A single upload far from 9:16 is re-framed the same way; otherwise it is used as it is.
   */
  async function prepareSource(v: Awaited<ReturnType<typeof getVideo>>) {
    const clips = v.clips ?? [];
    const join = async (inputs: string[], target: string) => {
      const r = await runEngine(["join", abs(target), ...inputs.map(abs), "--json"]);
      if (r.code !== 0) throw new Error(`joining clips failed:\n${r.tail}`);
      return JSON.parse(r.stdout.trim().split("\n").pop() || "[]") as Array<{ start: number; end: number }>;
    };
    if (clips.length > 1) {
      await set(v.id, { stage: `چسبوندن ${clips.length} ویدیو به هم`, progress: 3 });
      const bounds = await join(clips.map((c) => c.path), v.sourcePath);
      const withTimes: Clip[] = clips.map((c, i) => ({ ...c, start: bounds[i]?.start, end: bounds[i]?.end }));
      await db.update(videos).set({ clips: withTimes }).where(eq(videos.id, v.id));
      return { ...v, clips: withTimes };
    }
    const check = await runEngine(["check-source", abs(v.sourcePath)]);
    if (check.code === 0 && JSON.parse(check.stdout.trim() || "{}").normalise) {
      await set(v.id, { stage: "عمودی کردن ویدیو", progress: 3 });
      const target = path.join(vdir(v.id), "source_vertical.mp4");
      await join([v.sourcePath], target);
      await db.update(videos).set({ sourcePath: target }).where(eq(videos.id, v.id));
      return { ...v, sourcePath: target };
    }
    return v;
  }

  // ------------------------------------------------------------------ analyze
  async function analyze({ videoId }: JobPayload) {
    try {
      let v = await getVideo(videoId);
      await set(videoId, { status: "analyzing", stage: "آماده‌سازی ویدیو", progress: 2, error: null });
      v = await prepareSource(v);
      await set(videoId, { stage: "تحلیل صدا و تصویر", progress: 5 });
      const out = path.join(vdir(videoId), "analysis");
      const r = await runEngine(["analyze", abs(v.sourcePath), "-o", abs(out), "--stt", STT], (line) => {
        if (line.includes("audio:")) void set(videoId, { stage: "تشخیص مکث‌ها انجام شد", progress: 15 });
        if (line.includes("vision:")) void set(videoId, { stage: "تشخیص گفتار", progress: 45 });
        if (line.includes("speech:")) void set(videoId, { stage: "ذخیره‌ی نتایج", progress: 90 });
      });
      if (r.code !== 0) throw new Error(`analysis failed:\n${r.tail}`);
      const A = JSON.parse(fs.readFileSync(abs(path.join(out, "analysis.json")), "utf8"));
      if (A.info.duration > MAX_SECONDS) throw new UserError(`ویدیو ${Math.round(A.info.duration)} ثانیه‌ست؛ حداکثر ${MAX_SECONDS} ثانیه مجازه.`);
      const segments: TranscriptSegment[] = A.transcript.segments;
      await db.insert(transcripts).values({ videoId, engine: A.transcript.engine ?? STT, segments, confirmed: false })
        .onConflictDoUpdate({ target: transcripts.videoId, set: { segments, confirmed: false, updatedAt: new Date() } });
      await db.update(videos).set({
        duration: A.info.duration, width: A.info.width, height: A.info.height,
        analysis: { camera: A.camera, pauses: A.pauses.length, keyframes: A.keyframes.length, contact: path.join(out, "contact.jpg"), speech: A.speech?.seconds ?? null },
      }).where(eq(videos.id, videoId));
      await set(videoId, { status: "awaiting_transcript", stage: null, progress: 100 });
    } catch (e) { await fail(videoId, e); }
  }

  // ------------------------------------------------------------------ direct
  async function direct({ videoId, note }: JobPayload, enqueueRender: (p: JobPayload) => Promise<unknown>) {
    try {
      const v = await getVideo(videoId);
      await set(videoId, { status: "directing", stage: "نوشتن نقشه‌ی ادیت", progress: 10, error: null });
      const [t] = await db.select().from(transcripts).where(eq(transcripts.videoId, videoId));
      if (!t?.confirmed) throw new UserError("transcript not confirmed");
      const [st] = await db.select().from(styleSettings).where(eq(styleSettings.userId, v.userId));
      const style = { ...DEFAULT_STYLE, ...(st?.settings ?? {}) };
      const analysis: Analysis = JSON.parse(fs.readFileSync(abs(path.join(vdir(videoId), "analysis", "analysis.json")), "utf8"));
      const [prev] = await db.select().from(plans).where(eq(plans.videoId, videoId)).orderBy(desc(plans.version)).limit(1);
      const version = (prev?.version ?? 0) + 1;
      const planRel = path.join(vdir(videoId), "plans", `v${version}.json`);
      fs.mkdirSync(path.dirname(abs(planRel)), { recursive: true });
      const director = getDirector();
      const clips = (v.clips ?? []).filter((c) => c.start !== undefined && c.end !== undefined).map((c) => ({ start: c.start!, end: c.end! }));
      const plan = await director.createPlan({
        analysis, transcript: t.segments, style, note, previousPlan: prev?.plan, title: v.title,
        brief: { pov: v.pov, description: v.description, options: normalizeSelections(v.options) }, clips: clips.length > 1 ? clips : undefined,
        sourcePath: path.relative(path.dirname(abs(planRel)), abs(v.sourcePath)).split(path.sep).join("/"),
        outputPath: `../renders/v${version}.mp4`,
      });
      // generated / uploaded backgrounds become files the engine reads
      await imagegen.resolvePlaces(plan, abs(planRel), (stage) => void set(videoId, { stage, progress: 30 }));
      fs.writeFileSync(abs(planRel), JSON.stringify(plan, null, 1));
      await set(videoId, { stage: "بررسی نقشه", progress: 70 });
      const r = await runEngine(["validate", abs(planRel), "--fix", "--json"]);
      const report = JSON.parse(r.stdout || "{}");
      const finalPlan: EditPlan = JSON.parse(fs.readFileSync(abs(planRel), "utf8"));
      const [row] = await db.insert(plans).values({ videoId, version, source: director.name, note: note ?? null, plan: finalPlan, planPath: planRel, validation: report }).returning();
      if (!report.ok) throw new Error("edit plan has errors: " + JSON.stringify(report.errors));
      await set(videoId, { status: "rendering", stage: "در صف رندر", progress: 0 });
      await enqueueRender({ videoId });
      log(`[${videoId}] plan v${version} by ${director.name} (${row.id})`);
    } catch (e) { await fail(videoId, e); }
  }

  // ------------------------------------------------------------------ render
  async function render({ videoId }: JobPayload) {
    let renderId: string | undefined;
    try {
      const [p] = await db.select().from(plans).where(eq(plans.videoId, videoId)).orderBy(desc(plans.version)).limit(1);
      if (!p) throw new UserError("no plan");
      const [row] = await db.insert(renders).values({ videoId, planId: p.id, status: "rendering" }).returning();
      renderId = row.id;
      await set(videoId, { status: "rendering", stage: "آماده‌سازی", progress: 2 });
      const t0 = Date.now();
      const r = await runEngine(["render", abs(p.planPath), "-j", String(RENDER_WORKERS), "--skip-validate"], (line) => {
        const m = /^progress (\d+)\/(\d+)/.exec(line.trim());
        if (m) void set(videoId, { stage: "رندر بخش‌ها", progress: Math.round((Number(m[1]) / Number(m[2])) * 92) });
        if (line.includes("clean plate")) void set(videoId, { stage: "ساخت تصویر اتاق خالی" });
      });
      if (r.code !== 0) throw new Error(`render failed:\n${r.tail}`);
      const planDir = path.dirname(p.planPath);
      const outRel = path.normalize(path.join(planDir, p.plan.output.path));
      const qcRel = outRel.replace(/\.mp4$/, "_qc.jpg");
      await set(videoId, { stage: "ساخت برگه‌ی بازبینی", progress: 96 });
      await runEngine(["qc", abs(outRel), abs(p.planPath), "-o", abs(qcRel)]);
      const dm = /done: .*\(([\d.]+)s video/.exec(r.stdout);
      await db.update(renders).set({ status: "done", outputPath: outRel, qcPath: fs.existsSync(abs(qcRel)) ? qcRel : null,
        duration: dm ? Number(dm[1]) : null, elapsedS: (Date.now() - t0) / 1000 }).where(eq(renders.id, row.id));
      // intermediate segment files are large; keep only the cache (clean plate, voice level)
      const work = path.join(path.dirname(abs(outRel)), ".work");
      for (const d of fs.existsSync(work) ? fs.readdirSync(work) : []) if (!d.startsWith("cache_")) fs.rmSync(path.join(work, d), { recursive: true, force: true });
      await set(videoId, { status: "ready", stage: null, progress: 100 });
    } catch (e) {
      if (renderId) await db.update(renders).set({ status: "failed", error: e instanceof Error ? e.message : String(e) }).where(eq(renders.id, renderId));
      await fail(videoId, e);
    }
  }

  return { analyze, direct, render, imagegen };
}
