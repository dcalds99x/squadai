import type { Logger } from "@squadai/core";

/** Proves the schedule-and-consume loop works end to end. */
export async function handleHeartbeat(job: { id: string }, log: Logger): Promise<void> {
  log.info("heartbeat", { jobId: job.id, memoryMb: Math.round(process.memoryUsage().rss / 1e6) });
}
