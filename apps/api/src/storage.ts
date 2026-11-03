import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

/** All paths in the DB are relative to STORAGE_DIR (shared with the worker). */
export const abs = (rel: string) => path.join(config.storageDir, rel);
export const videoDir = (id: string) => path.join("videos", id);

export function safeRel(rel: string) {
  const p = path.normalize(rel).replace(/^([/\\])+/, "");
  if (p.startsWith("..")) throw new Error("bad path");
  return p;
}

export function ensureDir(rel: string) {
  fs.mkdirSync(abs(rel), { recursive: true });
}
