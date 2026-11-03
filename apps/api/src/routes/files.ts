import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { videos, eq, and, type Db } from "@autoreel/db";
import { config } from "../config.ts";
import { requireUser } from "../auth.ts";

/** /files/videos/<id>/... — outputs, keyframes, QC sheets. Range requests work, so the player can seek. */
export async function fileRoutes(app: FastifyInstance, db: Db) {
  await app.register(async (scope) => {
    scope.addHook("preHandler", requireUser);
    scope.addHook("preHandler", async (req, reply) => {
      const m = /^\/files\/videos\/([0-9a-f-]{36})\//.exec(req.url);
      if (!m) return reply.code(404).send({ error: "not found" });
      const [v] = await db.select({ id: videos.id }).from(videos).where(and(eq(videos.id, m[1]), eq(videos.userId, req.user.sub)));
      if (!v) return reply.code(404).send({ error: "not found" });
    });
    await scope.register(fastifyStatic, { root: config.storageDir, prefix: "/files/", decorateReply: false, dotfiles: "deny", index: false });
  });
}
