import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { videos, transcripts, plans, renders, eq, and, desc, type Db } from "@autoreel/db";
import { retimeSegment, type TranscriptSegment } from "@autoreel/shared";
import { requireUser } from "../auth.ts";
import { abs, videoDir, ensureDir } from "../storage.ts";
import { enqueue } from "../queue.ts";

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

  app.post("/api/videos", { preHandler: requireUser }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "فایلی ارسال نشده" });
    const ext = path.extname(file.filename || "").toLowerCase() || ".mp4";
    if (!ALLOWED.has(ext)) return reply.code(400).send({ error: `فرمت ${ext} پشتیبانی نمی‌شه` });
    const titleField = file.fields?.title as { value?: string } | undefined;
    const title = (titleField?.value || path.basename(file.filename || "video", ext)).slice(0, 120);
    const [v] = await db.insert(videos).values({ userId: req.user.sub, title, sourcePath: "pending" }).returning();
    const rel = path.join(videoDir(v.id), `source${ext}`);
    ensureDir(videoDir(v.id));
    await pipeline(file.file, fs.createWriteStream(abs(rel)));
    if (file.file.truncated) {
      await db.delete(videos).where(eq(videos.id, v.id));
      fs.rmSync(abs(videoDir(v.id)), { recursive: true, force: true });
      return reply.code(413).send({ error: "فایل بیش از حد مجاز بزرگه" });
    }
    await db.update(videos).set({ sourcePath: rel, stage: "در صف تحلیل" }).where(eq(videos.id, v.id));
    await enqueue("analyze", { videoId: v.id });
    return reply.code(201).send({ id: v.id });
  });

  app.get<{ Params: { id: string } }>("/api/videos/:id", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    const [t] = await db.select().from(transcripts).where(eq(transcripts.videoId, v.id));
    const ps = await db.select({ id: plans.id, version: plans.version, source: plans.source, note: plans.note, validation: plans.validation, createdAt: plans.createdAt })
      .from(plans).where(eq(plans.videoId, v.id)).orderBy(desc(plans.version));
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

  app.post<{ Params: { id: string } }>("/api/videos/:id/confirm", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    if (v.status !== "awaiting_transcript") return reply.code(409).send({ error: "این ویدیو منتظر تأیید متن نیست" });
    await db.update(transcripts).set({ confirmed: true, confirmedAt: new Date() }).where(eq(transcripts.videoId, v.id));
    await db.update(videos).set({ status: "directing", stage: "در صف کارگردانی", progress: 0, error: null, updatedAt: new Date() }).where(eq(videos.id, v.id));
    await enqueue("direct", { videoId: v.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>("/api/videos/:id/revise", { preHandler: requireUser }, async (req, reply) => {
    const v = await own(req.user.sub, req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    if (!["ready", "failed"].includes(v.status)) return reply.code(409).send({ error: "کار قبلی هنوز تموم نشده" });
    const [t] = await db.select().from(transcripts).where(eq(transcripts.videoId, v.id));
    if (!t?.confirmed) return reply.code(409).send({ error: "اول متن رو تأیید کن" });
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
