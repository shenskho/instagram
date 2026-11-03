import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { users, styleSettings, eq, type Db } from "@autoreel/db";
import { DEFAULT_STYLE } from "@autoreel/shared";
import { config } from "./config.ts";

declare module "@fastify/jwt" {
  interface FastifyJWT { payload: { sub: string; email: string }; user: { sub: string; email: string } }
}

/** Single-admin auth for the MVP: the account comes from ADMIN_EMAIL / ADMIN_PASSWORD. */
export async function seedAdmin(db: Db) {
  const email = config.adminEmail.toLowerCase();
  const found = await db.select().from(users).where(eq(users.email, email));
  if (found.length) return found[0];
  const [u] = await db.insert(users).values({ email, passwordHash: await bcrypt.hash(config.adminPassword, 10) }).returning();
  await db.insert(styleSettings).values({ userId: u.id, settings: DEFAULT_STYLE });
  return u;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify({ onlyCookie: true });
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
}

export function authRoutes(app: FastifyInstance, db: Db) {
  app.post<{ Body: { email: string; password: string } }>("/api/auth/login", async (req, reply) => {
    const email = String(req.body?.email ?? "").toLowerCase().trim();
    const [u] = await db.select().from(users).where(eq(users.email, email));
    if (!u || !(await bcrypt.compare(String(req.body?.password ?? ""), u.passwordHash))) {
      return reply.code(401).send({ error: "ایمیل یا رمز عبور اشتباهه" });
    }
    const token = await reply.jwtSign({ sub: u.id, email: u.email }, { expiresIn: "14d" });
    reply.setCookie("token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 14 * 86400 });
    return { id: u.id, email: u.email };
  });
  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie("token", { path: "/" });
    return { ok: true };
  });
  app.get("/api/auth/me", { preHandler: requireUser }, async (req) => ({ id: req.user.sub, email: req.user.email }));
}
