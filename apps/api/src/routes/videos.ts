import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { videos, transcripts, plans, renders, eq, and, desc, type Db } from "@autoreel/db";
import { retimeSegment, OPTION_IDS, type TranscriptSegment, type Clip } from "@autoreel/shared";
import { requireUser } from "../auth.ts";
import { abs, videoDir, ensureDir } from "../storage.ts";
import { enqueue } from "../queue.ts";
import { config } from "../config.ts";

const ALLOWED = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

export function videoRoutes(app: FastifyInstance, db: Db) {
  const own = async (userId: string, id: string) => {
    const [v] = await db.select().from(videos).where(and(eq(videos.id, id), eq(videos.userId, userId)));
    return v;
  };

  app.get("/api/videos", { preHandler: requireUser }, async (req) => {
    return db.select({
      id: videos.id, title: videos.title, status: videos.status, stage: videos.stage, progress: videos.progress,
      duration: videos.duration, error: videos.error, createdAt: videos.createdAt, updatedAt: videos.updatedAt,
    }).from(videos).where(eq(videos.userId, req.user.sub)).orderBy(desc(videos.createdAt));
  });

  /**
   * Upload one or more clips (multipart, fields first: title, pov; then one or more `file` parts).
   * Several clips are joined into one source by the worker before analysis.
   */
  app.post("/api/videos", { preHandler: requireUser }, async (req, reply) => {
    let title = "", pov = "";
    let v: { id: string } | undefined;
    const saved: Clip[] = [];
    const cleanup = async () => {
      if (!v) return;
      await db.delete(videos).where(eq(videos.id, v.id));
      fs.rmSync(abs(videoDir(v.id)), { recursive: true, force: true });
    };
    try {
      for await (const part of req.parts()) {
        if (part.type === "field") {
          if (part.fieldname === "title") title = String(part.value ?? "").slice(0, 120);
          if (part.fieldname === "pov") pov = String(part.value ?? "").slice(0, 2000);
          continue;
        }
        const ext = path.extname(part.filename || "").toLowerCase() || ".mp4";
        if (!ALLOWED.has(ext)) { part.file.resume(); await cleanup(); return reply.code(400).send({ error: `فرمت ${ext} پشتیبانی نمی‌شه. mp4، mov، m4v، webm یا mkv بفرست.` }); }
        if (!v) {
          [v] = await db.insert(videos).values({ userId: req.user.sub, title: title || path.basename(part.filename || "video", ext).slice(0, 120), pov, sourcePath: "pending" }).returning();
          ensureDir(path.join(videoDir(v.id), "clips"));
        }
        const rel = path.join(videoDir(v.id), "clips", `${String(saved.length + 1).padStart(2, "0")}${ext}`);
        await pipeline(part.file, fs.createWriteStream(abs(rel)));
        if (part.file.truncated) { await cleanup(); return reply.code(413).send({ error: `فایل «${part.filename}» بیش از حد مجاز بزرگه.` }); }
        saved.push({ name: (part.filename || `clip${saved.length + 1}`).slice(0, 200), path: rel });
      }
    } catch (e) {
      await cleanup();
      const code = (e as { code?: string }).code;
      if (code === "FST_FILES_LIMIT") return reply.code(413).send({ error: `حداکثر ${config.maxClips} فایل رو می‌شه با هم فرستاد.` });
      throw e;
    }
    if (!v || !saved.length) return reply.code(400).send({ error: "فایلی ارسال نشده" });
    // one file is the source itself; several are joined by the worker into source.mp4
    let sourcePath = path.join(videoDir(v.id), "source.mp4");
    if (saved.length === 1) {
      sourcePath = path.join(videoDir(v.id), `source${path.extname(saved[0].path)}`);
      fs.renameSync(abs(saved[0].path), abs(sourcePath));
      fs.rmSync(abs(path.join(videoDir(v.id), "clips")), { recursive: true, force: true });
      saved[0].path = sourcePath;
    }
    await db.update(videos).set({ sourcePath, clips: saved.length > 1 ? saved : null, stage: "در صف تحلیل" }).where(eq(videos.id, v.id));
    await enqueue("analyze", { videoId: v.id });
    return reply.code(201).send({ id: v.id, clips: saved.length });
  });

  app.get<{ Params: { id: string } }>("/api/videos/:id", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    const [t] = await db.select().from(transcripts).where(eq(transcripts.videoId, v.id));
    const rows = await db.select().from(plans).where(eq(plans.videoId, v.id)).orderBy(desc(plans.version));
    // the full plan is large; the panel needs where each option shows up
    const ps = rows.map(({ plan, planPath: _p, ...p }) => ({ ...p, usage: plan._usage ?? [], missing: (plan._missing as string[] | undefined) ?? [] }));
    const rs = await db.select().from(renders).where(eq(renders.videoId, v.id)).orderBy(desc(renders.createdAt));
    return { video: v, transcript: t ?? null, plans: ps, renders: rs };
  });

  app.get<{ Params: { id: string; version: string } }>("/api/videos/:id/plans/:version", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    const [p] = await db.select().from(plans).where(and(eq(plans.videoId, v.id), eq(plans.version, Number(req.params.version))));
    return p ? p.plan : reply.code(404).send({ error: "not found" });
  });

  const TranscriptBody = z.object({ segments: z.array(z.object({ index: z.number().int().min(0), text: z.string().max(2000) })) });
  app.put<{ Params: { id: string } }>("/api/videos/:id/transcript", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    const body = TranscriptBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const [t] = await db.select().from(transcripts).where(eq(transcripts.videoId, v.id));
    if (!t) return reply.code(409).send({ error: "متن هنوز آماده نیست" });
    const segs: TranscriptSegment[] = t.segments.map((s) => ({ ...s }));
    for (const { index, text } of body.data.segments) if (segs[index]) segs[index] = retimeSegment(segs[index], text);
    await db.update(transcripts).set({ segments: segs, updatedAt: new Date() }).where(eq(transcripts.videoId, v.id));
    return { segments: segs };
  });

  // ------------------------------------------------------------------ brief: point of view, description, options
  const BriefBody = z.object({
    pov: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
    options: z.array(z.string()).max(40).optional(),
  });
  type BriefIn = z.infer<typeof BriefBody>;
  const saveBrief = async (id: string, b: BriefIn) => {
    const set: Partial<{ pov: string; description: string; options: string[] }> = {};
    if (b.pov !== undefined) set.pov = b.pov.trim();
    if (b.description !== undefined) set.description = b.description.trim();
    if (b.options !== undefined) set.options = [...new Set(b.options.filter((o) => OPTION_IDS.has(o)))];
    if (Object.keys(set).length) await db.update(videos).set({ ...set, updatedAt: new Date() }).where(eq(videos.id, id));
  };
  const hasWords = (segs: TranscriptSegment[]) => segs.some((s) => s.words?.some((w) => w.w.trim()) || s.text.trim());

  app.put<{ Params: { id: string } }>("/api/videos/:id/brief", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    const body = BriefBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    await saveBrief(v.id, body.data);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/videos/:id/confirm", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    if (v.status !== "awaiting_transcript") return reply.code(409).send({ error: "این ویدیو منتظر تأیید متن نیست" });
    const body = BriefBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const [t] = await db.select().from(transcripts).where(eq(transcripts.videoId, v.id));
    const description = (body.data.description ?? v.description).trim();
    if (!hasWords(t?.segments ?? []) && !description)
      return reply.code(400).send({ error: "در این ویدیو حرفی شنیده نشد. یک توضیح کوتاه بنویس که توی ویدیو چه اتفاقی می‌افته." });
    await saveBrief(v.id, body.data);
    await db.update(transcripts).set({ confirmed: true, confirmedAt: new Date() }).where(eq(transcripts.videoId, v.id));
    await db.update(videos).set({ status: "directing", stage: "در صف کارگردانی", progress: 0, error: null, updatedAt: new Date() }).where(eq(videos.id, v.id));
    await enqueue("direct", { videoId: v.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: BriefIn & { note?: string } }>("/api/videos/:id/revise", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    if (!["ready", "failed"].includes(v.status)) return reply.code(409).send({ error: "کار قبلی هنوز تموم نشده" });
    const [t] = await db.select().from(transcripts).where(eq(transcripts.videoId, v.id));
    if (!t?.confirmed) return reply.code(409).send({ error: "اول متن رو تأیید کن" });
    const body = BriefBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    await saveBrief(v.id, body.data);
    const note = String(req.body?.note ?? "").slice(0, 2000) || undefined;
    await db.update(videos).set({ status: "directing", stage: "در صف کارگردانی", progress: 0, error: null, updatedAt: new Date() }).where(eq(videos.id, v.id));
    await enqueue("direct", { videoId: v.id, note });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/videos/:id/reanalyze", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    if (["analyzing", "directing", "rendering"].includes(v.status)) return reply.code(409).send({ error: "کار قبلی هنوز تموم نشده" });
    await db.update(videos).set({ status: "uploaded", stage: "در صف تحلیل", progress: 0, error: null, updatedAt: new Date() }).where(eq(videos.id, v.id));
    await enqueue("analyze", { videoId: v.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/videos/:id", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    if (["analyzing", "directing", "rendering"].includes(v.status)) return reply.code(409).send({ error: "وسط پردازش نمی‌شه حذف کرد" });
    await db.delete(videos).where(eq(videos.id, v.id));
    fs.rmSync(abs(videoDir(v.id)), { recursive: true, force: true });
    return { ok: true };
  });
}
