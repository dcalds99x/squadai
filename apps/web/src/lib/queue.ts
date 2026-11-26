import "server-only";
import { JOBS, type RoomReplyJob, type RunRequestJob } from "@squadai/engine";
import { PgBoss } from "pg-boss";
import { env } from "./env";

const globalForQueue = globalThis as unknown as { squadaiQueue?: Promise<PgBoss> };

/** A send-only queue client: the worker does the processing and maintenance. */
function getQueue(): Promise<PgBoss> {
  globalForQueue.squadaiQueue ??= (async () => {
    const boss = new PgBoss({
      connectionString: env().DATABASE_URL,
      schema: "pgboss",
      supervise: false,
      schedule: false,
      max: 2,
    });
    boss.on("error", (error) =>
      console.error(
        JSON.stringify({ level: "error", message: "queue error", error: String(error) }),
      ),
    );
    await boss.start();
    await boss.createQueue(JOBS.runRequest, { retryLimit: 3, retryDelay: 10, retryBackoff: true });
    await boss.createQueue(JOBS.roomReply, { retryLimit: 1 });
    return boss;
  })();
  return globalForQueue.squadaiQueue;
}

export async function enqueueRun(job: RunRequestJob): Promise<void> {
  await (await getQueue()).send(JOBS.runRequest, job);
}

export async function enqueueReply(job: RoomReplyJob): Promise<void> {
  await (await getQueue()).send(JOBS.roomReply, job);
}
