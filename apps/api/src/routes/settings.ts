import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { styleSettings, eq, type Db } from "@autoreel/db";
import { DEFAULT_STYLE } from "@autoreel/shared";
import { requireUser } from "../auth.ts";

const Style = z.object({
  hookText: z.string().max(80),
  ctaText: z.string().max(80),
  music: z.boolean(),
  musicGainDb: z.number().min(-40).max(-6),
  graphicsDensity: z.enum(["low", "normal", "high"]),
  grain: z.boolean(),
  progressBar: z.boolean(),
  minPause: z.number().min(0.15).max(1.5),
});

export function settingsRoutes(app: FastifyInstance, db: Db) {
  app.get("/api/settings/style", { preHandler: requireUser }, async (req) => {
    const [s] = await db.select().from(styleSettings).where(eq(styleSettings.userId, req.user.sub));
    return { ...DEFAULT_STYLE, ...(s?.settings ?? {}) };
  });
  app.put("/api/settings/style", { preHandler: requireUser }, async (req, reply) => {
    const body = Style.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    await db.insert(styleSettings).values({ userId: req.user.sub, settings: body.data })
      .onConflictDoUpdate({ target: styleSettings.userId, set: { settings: body.data, updatedAt: new Date() } });
    return body.data;
  });
}
