/**
 * Load test for the queue and the database: many requests at once, each job
 * delivered twice (the way a retry or a double click would), several workers
 * pulling from the queue. Reports throughput and run times, and fails if any
 * request ran twice.
 *
 *   pnpm --filter @squadai/worker load-test -- --requests 200 --workers 4
 *
 * Uses the demo model (no cost), a throwaway workspace and its own pg-boss
 * schema, so it never touches real work or a running worker's jobs.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getTeamTemplate } from "@squadai/catalog";
import { createDb, createWorkspaceForUser, hireTeam, schema } from "@squadai/db";
import {
  createRequest,
  loadModelContext,
  type RunOutcome,
  type RunRequestJob,
  runRequest,
} from "@squadai/engine";
import { eq, inArray, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";

const { values } = parseArgs({
  options: {
    requests: { type: "string", default: "100" },
    workers: { type: "string", default: "4" },
    concurrency: { type: "string", default: "4" },
    delay: { type: "string", default: "50" },
    out: { type: "string" },
  },
});
const N = Number(values.requests);
const WORKERS = Number(values.workers);
const CONCURRENCY = Number(values.concurrency);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL.");

const QUEUE = "load-test-run";
const db = createDb(url, { max: WORKERS * CONCURRENCY + 4 });
const userId = `load-${randomUUID()}`;
const deps = {
  db,
  loadModels: (ws: string) =>
    loadModelContext(db, ws, { masterKey: null, demoDelayMs: Number(values.delay) }),
};

const durations: number[] = [];
const outcomes = new Map<RunOutcome, number>();
const errors: string[] = [];

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function main() {
  await db
    .insert(schema.user)
    .values({ id: userId, name: "Load", email: `${userId}@example.test` });
  const { workspaceId } = await createWorkspaceForUser(db, {
    userId,
    userName: "Load",
    locale: "en",
  });
  await hireTeam(db, { workspaceId, template: getTeamTemplate("code-review") });
  await db
    .update(schema.workspace)
    .set({ settings: { demoMode: true, locale: "en" } })
    .where(eq(schema.workspace.id, workspaceId));
  const teams = await db.select().from(schema.team).where(eq(schema.team.workspaceId, workspaceId));
  const playbooks = await db
    .select()
    .from(schema.playbook)
    .where(
      inArray(
        schema.playbook.teamId,
        teams.map((t) => t.id),
      ),
    );

  const boss = new PgBoss({ connectionString: url, schema: "pgboss_load" });
  boss.on("error", (e) => errors.push(String(e)));
  await boss.start();
  await boss.createQueue(QUEUE, { retryLimit: 2, retryDelay: 1 });

  try {
    // A mix: every playbook, plus requests where the team decides.
    const requestIds: string[] = [];
    const createStart = performance.now();
    for (let i = 0; i < N; i++) {
      const team = teams[i % teams.length];
      const options = playbooks.filter((p) => p.teamId === team?.id);
      const pb = i % 3 === 0 ? null : options[i % options.length];
      const { requestId } = await createRequest(db, {
        workspaceId,
        teamId: team?.id as string,
        playbookId: pb?.id ?? null,
        userId,
        prompt: `Load test request ${i}: a short note about topic ${i % 17}`,
      });
      requestIds.push(requestId);
    }
    const createMs = performance.now() - createStart;

    // Each job twice, as a double submit or an at-least-once retry would.
    const jobs = requestIds.flatMap((requestId) => [{ requestId }, { requestId }]);
    await boss.insert(
      QUEUE,
      jobs.map((data) => ({ data })),
    );

    const runStart = performance.now();
    for (let w = 0; w < WORKERS; w++) {
      await boss.work<RunRequestJob>(
        QUEUE,
        { localConcurrency: CONCURRENCY, pollingIntervalSeconds: 0.5 },
        async ([job]) => {
          if (!job) return;
          const started = performance.now();
          const result = await runRequest(deps, job.data);
          durations.push(performance.now() - started);
          outcomes.set(result.outcome, (outcomes.get(result.outcome) ?? 0) + 1);
          for (const next of result.followUps) await boss.send(QUEUE, next);
        },
      );
    }

    // Done when every request has finished or is waiting on a person (checkpoints).
    const deadline = Date.now() + 10 * 60_000;
    for (;;) {
      const [open] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.request)
        .where(
          sql`${schema.request.id} in ${requestIds} and ${schema.request.status} in ('queued', 'running')`,
        );
      // Straight from pg-boss's table: its stats are cached and lag behind.
      const [pending] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from pgboss_load.job
            where name = ${QUEUE} and state in ('created', 'retry', 'active')`,
      );
      if ((open?.n ?? 0) === 0 && Number(pending?.n ?? 0) === 0) break;
      if (Date.now() > deadline) throw new Error("timed out waiting for the queue to drain");
      await new Promise((r) => setTimeout(r, 500));
    }
    const runMs = performance.now() - runStart;

    const [runs] = await db
      .select({
        total: sql<number>`count(*)::int`,
        doubled: sql<number>`count(*) filter (where n > 1)::int`,
      })
      .from(
        sql`(select ${schema.run.requestId} as id, count(*) as n from ${schema.run}
             where ${schema.run.requestId} in ${requestIds} group by 1) as per_request`,
      );
    const [calls] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.llmCall)
      .where(eq(schema.llmCall.workspaceId, workspaceId));

    const sorted = [...durations].sort((a, b) => a - b);
    const report = [
      "# Load test",
      "",
      `${N} requests, each job sent twice (${N * 2} jobs), ${WORKERS} workers × ${CONCURRENCY} concurrent, demo model with ${values.delay} ms per call.`,
      "",
      "| Measure | Value |",
      "| --- | --- |",
      `| Requests created | ${N} in ${(createMs / 1000).toFixed(1)} s (${((N / createMs) * 1000).toFixed(0)}/s) |`,
      `| Queue drained in | ${(runMs / 1000).toFixed(1)} s |`,
      `| Throughput | ${((N / runMs) * 60_000).toFixed(0)} requests/min |`,
      `| Job time p50 / p95 / max | ${pct(sorted, 50).toFixed(0)} / ${pct(sorted, 95).toFixed(0)} / ${(sorted.at(-1) ?? 0).toFixed(0)} ms |`,
      `| Outcomes | ${[...outcomes].map(([k, v]) => `${k} ${v}`).join(", ")} |`,
      `| Model calls | ${calls?.n ?? 0} |`,
      `| Requests that ran twice | ${runs?.doubled ?? 0} of ${runs?.total ?? 0} |`,
      `| Queue errors | ${errors.length} |`,
      "",
    ].join("\n");
    console.log(report);
    if (values.out) writeFileSync(values.out, report);
    if ((runs?.doubled ?? 0) > 0 || errors.length > 0) process.exitCode = 1;
  } finally {
    await boss.stop({ graceful: false });
    await db.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.close();
  }
}

await main();
