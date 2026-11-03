import { PgBoss } from "pg-boss";
import { DATABASE_URL } from "@autoreel/db";
import type { JobName, JobPayload } from "@autoreel/shared";

export const QUEUES: JobName[] = ["analyze", "direct", "render"];
let boss: PgBoss | null = null;

export async function getBoss() {
  if (boss) return boss;
  boss = new PgBoss(DATABASE_URL);
  boss.on("error", (e) => console.error("[queue]", e));
  await boss.start();
  for (const q of QUEUES) {
    // renders can take several minutes; no automatic retry (a failed render is shown to the user)
    await boss.createQueue(q, { expireInSeconds: 3600, retryLimit: 0 }).catch(() => undefined);
  }
  return boss;
}

export async function enqueue(name: JobName, payload: JobPayload) {
  const b = await getBoss();
  return b.send(name, payload);
}
