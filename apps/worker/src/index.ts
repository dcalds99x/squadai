/**
 * The worker runs long work outside web requests: agent runs, room replies,
 * scheduled jobs. Jobs live in Postgres via pg-boss, so a restart never loses
 * work, and a run that crashes mid-way resumes at its first unfinished step.
 */
import { createLogger, QUEUES } from "@squadai/core";
import { parseMasterKey } from "@squadai/core/crypto";
import { createDb } from "@squadai/db";
import {
  JOBS,
  loadModelContext,
  type RoomReplyJob,
  type RunRequestJob,
  replyInRoom,
  runRequest,
} from "@squadai/engine";
import { PgBoss } from "pg-boss";
import { handleHeartbeat } from "./jobs/heartbeat.ts";

const log = createLogger({ service: "worker" });

const url = process.env.DATABASE_URL;
if (!url) {
  log.error("DATABASE_URL is not set");
  process.exit(1);
}

let masterKey: Buffer | null = null;
try {
  masterKey = parseMasterKey(process.env.SQUADAI_MASTER_KEY);
} catch (error) {
  log.warn("provider keys cannot be decrypted; only demo mode will work", {
    reason: String(error),
  });
}

const db = createDb(url, { max: 5 });
const demoDelayMs = Number(process.env.SQUADAI_DEMO_DELAY_MS ?? 1200);
const deps = {
  db,
  log,
  loadModels: (workspaceId: string) =>
    loadModelContext(db, workspaceId, { masterKey, demoDelayMs }),
};

const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
boss.on("error", (error) => log.error("queue error", { error: String(error) }));

await boss.start();
await boss.createQueue(QUEUES.heartbeat);
await boss.createQueue(JOBS.runRequest, { retryLimit: 3, retryDelay: 10, retryBackoff: true });
await boss.createQueue(JOBS.roomReply, { retryLimit: 1 });
await boss.schedule(QUEUES.heartbeat, "*/5 * * * *");

await boss.work(QUEUES.heartbeat, async (jobs) => {
  for (const job of jobs) await handleHeartbeat(job, log);
});

await boss.work<RunRequestJob>(JOBS.runRequest, { localConcurrency: 4 }, async (jobs) => {
  for (const job of jobs) {
    const { outcome, followUps } = await runRequest(deps, job.data);
    log.info("run finished", { jobId: job.id, requestId: job.data.requestId, outcome });
    // Helper teams to start, or teams waiting on this one to resume.
    for (const next of followUps) await boss.send(JOBS.runRequest, next);
  }
});

await boss.work<RoomReplyJob>(JOBS.roomReply, { localConcurrency: 4 }, async (jobs) => {
  for (const job of jobs) await replyInRoom(deps, job.data);
});

log.info("worker started", { queues: [QUEUES.heartbeat, JOBS.runRequest, JOBS.roomReply] });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("stopping", { signal });
  // Lets in-flight jobs finish; anything cut off resumes from its last step.
  await boss.stop({ graceful: true, timeout: 30_000 });
  await db.close();
  log.info("stopped");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
