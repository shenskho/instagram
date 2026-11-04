import { PgBoss } from "pg-boss";
import { createDb, runMigrations, DATABASE_URL } from "@autoreel/db";
import type { ImagegenPayload, JobName, JobPayload } from "@autoreel/shared";
import { getDirector } from "@autoreel/director";
import { makeJobs } from "./jobs.ts";
import { ENGINE_CMD, RENDER_WORKERS } from "./engine.ts";

const log = (m: string) => console.log(new Date().toISOString(), m);
const { db } = createDb();
await runMigrations(db);

const boss = new PgBoss(DATABASE_URL);
boss.on("error", (e) => console.error("[queue]", e));
await boss.start();
const queues: JobName[] = ["analyze", "direct", "render", "imagegen"];
for (const q of queues) await boss.createQueue(q, { expireInSeconds: 3600, retryLimit: 0 }).catch(() => undefined);

const jobs = makeJobs(db, log);
const opts = { batchSize: 1, pollingIntervalSeconds: 1 };
await boss.work<JobPayload>("analyze", opts, async ([job]) => { log(`analyze ${job.data.videoId}`); await jobs.analyze(job.data); });
await boss.work<JobPayload>("direct", opts, async ([job]) => {
  log(`direct ${job.data.videoId}`);
  await jobs.direct(job.data, (p) => boss.send("render", p));
});
await boss.work<JobPayload>("render", opts, async ([job]) => { log(`render ${job.data.videoId}`); await jobs.render(job.data); });
await boss.work<ImagegenPayload>("imagegen", opts, async ([job]) => { log(`imagegen ${job.data.key}`); await jobs.imagegen.preview(job.data); });

// the local image generator: report whether it can be used, fetch its model once in the background
if (jobs.imagegen.MODE !== "off") void jobs.imagegen.ensureModel().catch((e) => log(`imagegen: ${(e as Error).message}`));
else void jobs.imagegen.refresh();

log(`worker ready — engine "${ENGINE_CMD}", ${RENDER_WORKERS} render processes, director "${getDirector().name}"`);
const stop = async () => { await boss.stop({ graceful: true, timeout: 20000 }); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
