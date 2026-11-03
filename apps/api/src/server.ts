import Fastify from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import fs from "node:fs";
import { createDb, runMigrations } from "@autoreel/db";
import { config } from "./config.ts";
import { authRoutes, seedAdmin } from "./auth.ts";
import { videoRoutes } from "./routes/videos.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { fileRoutes } from "./routes/files.ts";
import { getBoss } from "./queue.ts";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 2 * 1024 * 1024 });
const { db } = createDb();

await runMigrations(db);
await seedAdmin(db);
await getBoss();
fs.mkdirSync(config.storageDir, { recursive: true });

await app.register(cors, { origin: config.webOrigin, credentials: true });
await app.register(cookie);
await app.register(jwt, { secret: config.jwtSecret, cookie: { cookieName: "token", signed: false } });
await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

app.get("/api/health", async () => ({ ok: true }));
authRoutes(app, db);
videoRoutes(app, db);
settingsRoutes(app, db);
await fileRoutes(app, db);

await app.listen({ port: config.port, host: config.host });
