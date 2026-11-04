import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { GEN_STYLES, imagegenKey } from "@autoreel/shared";
import { requireUser } from "../auth.ts";
import { abs } from "../storage.ts";
import { enqueue } from "../queue.ts";

/**
 * The local image generator lives in the worker. The worker writes capabilities.json (can it generate?) and
 * imagegen/<key>.status.json for each preview; the API only reads those files and queues jobs.
 */
export function imagegenRoutes(app: FastifyInstance) {
  const readJson = (rel: string) => { try { return JSON.parse(fs.readFileSync(abs(rel), "utf8")); } catch { return null; } };

  app.get("/api/capabilities", { preHandler: requireUser }, async () => {
    const cap = readJson("capabilities.json");
    return { imagegen: cap?.imagegen ?? { available: false, reason: "unknown" } };
  });

  const Body = z.object({ text: z.string().trim().min(1).max(80), style: z.string().refine((s) => s in GEN_STYLES) });
  app.post("/api/imagegen/preview", { preHandler: requireUser }, async (req, reply) => {
    const b = Body.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "اسم محیط و سبک لازمه" });
    const cap = readJson("capabilities.json")?.imagegen;
    if (!cap?.available) return reply.code(409).send({ error: "مدل تصویرساز هنوز آماده نیست." });
    const key = imagegenKey(b.data.text, b.data.style);
    if (fs.existsSync(abs(path.join("imagegen", `${key}.png`)))) return { key, status: "done", path: `imagegen/${key}.png` };
    const st = readJson(path.join("imagegen", `${key}.status.json`));
    if (st?.status === "working") return { key, status: "working" };
    fs.mkdirSync(abs("imagegen"), { recursive: true });
    fs.writeFileSync(abs(path.join("imagegen", `${key}.status.json`)), JSON.stringify({ status: "queued", ...b.data }));
    await enqueue("imagegen", { key, ...b.data }, { singletonKey: key });
    return { key, status: "queued" };
  });

  app.get<{ Params: { key: string } }>("/api/imagegen/:key", { preHandler: requireUser }, async (req, reply) => {
    if (!/^[0-9a-f]{16}$/.test(req.params.key)) return reply.code(400).send({ error: "bad key" });
    const st = readJson(path.join("imagegen", `${req.params.key}.status.json`));
    if (!st) return reply.code(404).send({ error: "not found" });
    return { key: req.params.key, ...st };
  });
}
