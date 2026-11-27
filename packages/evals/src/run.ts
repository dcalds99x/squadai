/**
 * Runs every team's reference requests end to end, the way a person would:
 * scope check, request, run (confirming checkpoints), delivery. Then grades
 * each one with rule checks and, with a real model, an AI judge.
 *
 *   pnpm evals                      demo model, rule checks only (what CI runs)
 *   ANTHROPIC_API_KEY=… pnpm evals  real Claude models, plus the AI judge
 *   pnpm evals --team code-review --out report.md
 *
 * Needs DATABASE_URL. It works in a throwaway workspace and deletes it after.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getTeamTemplate } from "@squadai/catalog";
import { DEFAULT_TIER_MODELS, type ModelRef } from "@squadai/core";
import { encryptSecret } from "@squadai/core/crypto";
import { createDb, createWorkspaceForUser, hireTeam, schema } from "@squadai/db";
import {
  checkScope,
  createRequest,
  decideToolApproval,
  loadModelContext,
  type RunInput,
  runRequest,
} from "@squadai/engine";
import { createModelFactory } from "@squadai/providers";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type EvalCase, loadSuites } from "./cases.ts";
import { type CheckResult, type Observed, runChecks } from "./checks.ts";
import { judge, PASSING_SCORE, type Verdict } from "./judge.ts";

const { values: args } = parseArgs({
  options: { team: { type: "string" }, out: { type: "string", default: "evals-report.md" } },
});
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (the evals use a throwaway workspace in it).");
const apiKey = process.env.EVAL_DEMO === "1" ? undefined : process.env.ANTHROPIC_API_KEY;
const real = Boolean(apiKey);
const judgeModel = (process.env.EVAL_JUDGE_MODEL ??
  DEFAULT_TIER_MODELS.balanced.primary) as ModelRef;

const db = createDb(url, { max: 4 });
const masterKey = randomBytes(32);
const userId = `evals-${randomUUID()}`;
const { approval, delivery, deliveryVersion, llmCall, playbook, reviewNote, run, team } = schema;

interface Row {
  team: string;
  id: string;
  checks: CheckResult[];
  verdict: Verdict | null;
  costMicros: number;
  seconds: number;
  error?: string;
}

async function setUp(): Promise<{ workspaceId: string; teams: Map<string, string> }> {
  await db
    .insert(schema.user)
    .values({ id: userId, name: "Eval", email: `${userId}@example.test` });
  const { workspaceId } = await createWorkspaceForUser(db, {
    userId,
    userName: "Eval",
    locale: "en",
  });
  for (const id of ["market-research", "code-review"]) {
    await hireTeam(db, { workspaceId, template: getTeamTemplate(id) });
  }
  await db
    .update(schema.workspace)
    .set({ settings: { demoMode: !real, locale: "en" } })
    .where(eq(schema.workspace.id, workspaceId));
  if (apiKey) {
    await db.insert(schema.providerCredential).values({
      workspaceId,
      provider: "anthropic",
      label: "evals",
      encryptedKey: encryptSecret(apiKey, masterKey),
    });
  }
  const rows = await db
    .select({ id: team.id, slug: team.slug })
    .from(team)
    .where(eq(team.workspaceId, workspaceId));
  return { workspaceId, teams: new Map(rows.map((r) => [r.slug, r.id])) };
}

async function runCase(
  workspaceId: string,
  teamId: string,
  c: EvalCase,
): Promise<{ seen: Observed; costMicros: number }> {
  const models = await loadModelContext(db, workspaceId, { masterKey });
  const scope = await checkScope(db, { workspaceId, teamId, prompt: c.prompt }, models);
  const seen: Observed = { scope: scope.fit, suggested: scope.alternatives[0]?.teamSlug ?? null };
  if (scope.fit === "out" || c.expect.scope === "out") return { seen, costMicros: 0 };

  const [pb] = c.playbook
    ? await db
        .select({ id: playbook.id })
        .from(playbook)
        .where(and(eq(playbook.teamId, teamId), eq(playbook.key, c.playbook)))
    : [];
  if (c.playbook && !pb) throw new Error(`Unknown playbook "${c.playbook}"`);
  const { requestId, deliveryId } = await createRequest(db, {
    workspaceId,
    teamId,
    playbookId: pb?.id ?? null,
    userId,
    prompt: c.prompt,
  });

  // Like the worker: run, then whatever it triggers. Like a person: say "go on" at every pause.
  const deps = { db, loadModels: (ws: string) => loadModelContext(db, ws, { masterKey }) };
  const queue: RunInput[] = [{ requestId }];
  let checkpoints = 0;
  for (let guard = 0; queue.length > 0 && guard < 40; guard++) {
    const job = queue.shift() as RunInput;
    const result = await runRequest(deps, job);
    if (job.requestId === requestId) seen.outcome = result.outcome;
    queue.push(...result.followUps);
    if (result.outcome !== "waiting") continue;
    const pending = await db
      .select({ id: approval.id, kind: approval.kind })
      .from(approval)
      .innerJoin(delivery, eq(delivery.id, approval.deliveryId))
      .where(
        and(
          eq(delivery.requestId, job.requestId),
          eq(approval.status, "pending"),
          inArray(approval.kind, ["checkpoint", "tool"]),
        ),
      );
    for (const a of pending) {
      if (a.kind === "checkpoint" && job.requestId === requestId) checkpoints++;
      queue.push(
        await decideToolApproval(db, { workspaceId, approvalId: a.id, userId, allow: true }),
      );
    }
  }

  const [latest] = await db
    .select({ id: deliveryVersion.id, content: deliveryVersion.content })
    .from(deliveryVersion)
    .where(eq(deliveryVersion.deliveryId, deliveryId))
    .orderBy(desc(deliveryVersion.number))
    .limit(1);
  const notes = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewNote)
    .innerJoin(deliveryVersion, eq(deliveryVersion.id, reviewNote.versionId))
    .where(eq(deliveryVersion.deliveryId, deliveryId));
  const [cost] = await db
    .select({ micros: sql<number>`coalesce(sum(${llmCall.costMicros}), 0)::int` })
    .from(llmCall)
    .innerJoin(run, eq(run.id, llmCall.runId))
    .where(eq(run.requestId, requestId));
  return {
    seen: { ...seen, text: latest?.content ?? "", reviewNotes: notes[0]?.n ?? 0, checkpoints },
    costMicros: Number(cost?.micros ?? 0),
  };
}

function report(rows: Row[]): string {
  const failed = (r: Row) =>
    Boolean(r.error) ||
    r.checks.some((c) => !c.pass) ||
    (r.verdict !== null && r.verdict.score < PASSING_SCORE);
  const passed = rows.filter((r) => !failed(r)).length;
  const lines = [
    `# Team evals`,
    "",
    `${passed}/${rows.length} cases passed · ${real ? `real models, judged by ${judgeModel}` : "demo model, rule checks only (no judge)"}`,
    "",
    "| Team | Case | Result | Checks | Judge | Cost | Time |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => {
      const checks = r.error
        ? `error: ${r.error}`
        : r.checks
            .map(
              (c) =>
                `${c.pass ? "✓" : "✗"} ${c.name}${c.pass || !c.detail ? "" : ` (${c.detail})`}`,
            )
            .join("<br>");
      const verdict = r.verdict ? `${r.verdict.score}/5 ${r.verdict.reason}` : "—";
      return `| ${r.team} | ${r.id} | ${failed(r) ? "❌" : "✅"} | ${checks} | ${verdict} | $${(r.costMicros / 1e6).toFixed(4)} | ${r.seconds.toFixed(1)}s |`;
    }),
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const suites = loadSuites(fileURLToPath(new URL("../cases", import.meta.url)), args.team);
  const { workspaceId, teams } = await setUp();
  const judgeFactory = apiKey
    ? createModelFactory({ credentials: [{ provider: "anthropic", apiKey }], demoMode: false })
    : null;
  const rows: Row[] = [];
  try {
    for (const suite of suites) {
      const teamId = teams.get(suite.team);
      if (!teamId) throw new Error(`No team "${suite.team}" in the eval office.`);
      for (const c of suite.cases) {
        const started = performance.now();
        const row: Row = {
          team: suite.team,
          id: c.id,
          checks: [],
          verdict: null,
          costMicros: 0,
          seconds: 0,
        };
        try {
          const { seen, costMicros } = await runCase(workspaceId, teamId, c);
          row.checks = runChecks(c, seen);
          row.costMicros = costMicros;
          if (judgeFactory && c.rubric && seen.text) {
            row.verdict = await judge(
              { prompt: c.prompt, rubric: c.rubric, text: seen.text },
              judgeModel,
              judgeFactory,
            );
          }
        } catch (error) {
          row.error = String(error).slice(0, 200);
        }
        row.seconds = (performance.now() - started) / 1000;
        rows.push(row);
        console.log(
          `${row.error || row.checks.some((x) => !x.pass) ? "✗" : "✓"} ${suite.team}/${c.id}`,
        );
      }
    }
  } finally {
    await db.delete(schema.workspace).where(eq(schema.workspace.id, workspaceId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.close();
  }

  const markdown = report(rows);
  writeFileSync(args.out as string, markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(`\n${markdown}`);
  const ok = rows.every(
    (r) =>
      !r.error &&
      r.checks.every((c) => c.pass) &&
      (r.verdict === null || r.verdict.score >= PASSING_SCORE),
  );
  process.exit(ok ? 0 : 1);
}

await main();
