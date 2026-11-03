import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export { schema };
export { eq, and, desc, asc, sql } from "drizzle-orm";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://autoreel:autoreel@localhost:5432/autoreel";

export function createDb(url = DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
export type Db = ReturnType<typeof createDb>["db"];

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS });
}
