import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  host: process.env.API_HOST ?? "0.0.0.0",
  storageDir: path.resolve(process.env.STORAGE_DIR ?? path.join(root, "storage")),
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  adminEmail: process.env.ADMIN_EMAIL ?? "admin@autoreel.local",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin1234",
  webOrigin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 500),
  maxVideoSeconds: Number(process.env.MAX_VIDEO_SECONDS ?? 120),
};
