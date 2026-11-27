/**
 * Carries out a request. A playbook's `mode` decides the shape of the work:
 *
 * - sequential: research → draft → review, each step building on the last.
 * - coordinator: the first agent splits the work, teammates do their parts,
 *   the coordinator combines them.
 * - parallel: every step but the last runs at the same time; the last combines.
 *
 * Inside a step an agent can use tools (see ./tools). A tool with policy "ask"
 * pauses the step until a person decides; `request_help` pauses it until another
 * team delivers. Everything a step needs to resume (the conversation so far
 * and what it is waiting for) lives in `step.checkpoint`, so pauses survive
 * restarts and any worker can pick the run back up.
 */

import { trace } from "@opentelemetry/api";
import {
  createLogger,
  type Logger,
  type ModelTier,
  resolveAgentModels,
  type ToolPolicy,
  workspaceLocale,
} from "@squadai/core";
import { type DbOrTx, schema } from "@squadai/db";
import {
  BudgetExceededError,
  type CallKind,
  type ChatResult,
  type ChatTurn,
  type Effort,
  formatToolResult,
  friendlyError,
  generateWithFallback,
  inSpan,
  LEGACY_REVIEW_NOTES_MARKER,
  parseToolCall,
  REVIEW_NOTES_MARKER,
  TOOL_CALL_PATTERN,
  toolInstructions,
} from "@squadai/providers";
import { and, asc, desc, eq, gte, inArray, isNull, lt, max, ne, or, sql } from "drizzle-orm";
import { createStreamer, notify } from "./events.ts";
import {
  defaultFlow,
  type FlowStep,
  parseFlowPlan,
  parseVerdict,
  producesText,
  resolveFlow,
} from "./flow.ts";
import { resolveHandoffsFor } from "./handoffs.ts";
import type { ModelContext } from "./models.ts";
import { checkScope, describeOutOfScope, scopeInstructions } from "./scope.ts";
import {
  type OfferedTool,
  type ToolContext,
  toolsForAgent,
  toSpecs,
  workspaceTools,
} from "./tools/index.ts";
import { type Words, wordsFor } from "./words.ts";

const {
  agent,
  agentToolPolicy,
  approval,
  budget,
  delivery,
  deliveryVersion,
  handoff,
  llmCall,
  message,
  playbook,
  request,
  reviewNote,
  room,
  run,
  step,
  team,
} = schema;

export interface RunDeps {
  db: DbOrTx;
  loadModels: (workspaceId: string) => Promise<ModelContext>;
  log?: Logger;
}

export interface RunInput {
  requestId: string;
  /** Present when the person asked for changes: re-runs the steps that write the text. */
  feedback?: string;
}

export type RunOutcome =
  | "awaiting_approval"
  | "delivered"
  | "waiting"
  | "failed"
  | "skipped"
  /** The lead found the request outside the team's scope. */
  | "declined"
  /** The person stopped the work at a checkpoint. */
  | "cancelled";

export interface RunResult {
  outcome: RunOutcome;
  /** Other runs to start or resume (helper teams, or a team waiting on this one). */
  followUps: RunInput[];
}

const EFFORT: Record<ModelTier, Effort> = { economy: "low", balanced: "medium", max: "high" };

/**
 * How long a worker holds a run without news. Renewed before every model call;
 * shorter than pg-boss's job expiry, so a run whose worker died is free again
 * by the time the job is retried.
 */
const LEASE_MS = 10 * 60_000;
const lease = () => new Date(Date.now() + LEASE_MS);

/** The person cancelled the request (or deleted it) while it ran. */
class RunCancelledError extends Error {
  constructor() {
    super("The request was cancelled.");
    this.name = "RunCancelledError";
  }
}

/** Postgres "unique_violation", however the driver wraps it. */
function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return code(error) === "23505" || code((error as { cause?: unknown } | null)?.cause) === "23505";
}
const MAX_TOOL_CALLS = 4;
const MAX_MODEL_CALLS = 8;

interface AgentRow {
  id: string;
  key: string;
  name: string;
  role: string;
  instructions: string;
  tier: ModelTier;
  model: string | null;
  fallbackModel: string | null;
  style: "precise" | "balanced" | "creative";
}

type StepRow = typeof step.$inferSelect;

interface Checkpoint {
  turns: ChatTurn[];
  toolCalls: number;
  modelCalls: number;
  pending?: {
    type: "approval" | "handoff";
    id: string;
    tool: string;
    input: Record<string, unknown>;
  };
}

type StepKind = CallKind;

type StepOutcome = { status: "done"; text: string } | { status: "waiting" };

interface TurnOptions {
  /** The text a review step revises (only the demo model reads it). */
  reviewing?: string;
  /** Review loops: this round and how many the step allows. */
  round?: number;
  rounds?: number;
  /** A draft rewriting an earlier version. */
  rework?: boolean;
  noTools?: boolean;
  effort?: Effort;
  maxOutputTokens?: number;
}

/** Splits a review into the revised text and its margin notes. */
export function parseReview(text: string): {
  text: string;
  notes: { anchor: string; body: string }[];
} {
  const [body, notesBlock] = text
    .replace(LEGACY_REVIEW_NOTES_MARKER, REVIEW_NOTES_MARKER)
    .split(REVIEW_NOTES_MARKER);
  const notes = (notesBlock ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("::"))
    .map((line) => {
      const [anchor, ...rest] = line.split("::");
      // Models often quote the excerpt; the page adds its own quotes.
      const excerpt = (anchor ?? "")
        .trim()
        .replace(/^[-*•\s]+/, "")
        .replace(/^["“”'']+|["“”'']+$/g, "")
        .trim();
      return { anchor: excerpt, body: rest.join("::").trim() };
    })
    .filter((n) => n.anchor && n.body);
  return { text: (body ?? "").trim(), notes };
}

/**
 * Reads a coordinator's plan: {"tasks":[{"agent":"key","task":"..."}]}.
 * The keys are protocol tokens, the same in every locale. A model may still
 * translate them, and early builds used Portuguese keys, so
 * {"tarefas":[{"agente","tarefa"}]} is accepted too.
 */
export function parsePlan(text: string, validKeys: string[]): { agentKey: string; task: string }[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    type Item = { agente?: unknown; tarefa?: unknown; agent?: unknown; task?: unknown };
    const parsed = JSON.parse(text.slice(start, end + 1)) as { tarefas?: Item[]; tasks?: Item[] };
    const items = Array.isArray(parsed.tasks)
      ? parsed.tasks
      : Array.isArray(parsed.tarefas)
        ? parsed.tarefas
        : [];
    return items
      .map((t) => ({ agentKey: t.agent ?? t.agente, task: t.task ?? t.tarefa }))
      .filter(
        (t): t is { agentKey: string; task: string } =>
          typeof t.agentKey === "string" &&
          validKeys.includes(t.agentKey) &&
          typeof t.task === "string" &&
          t.task.trim() !== "",
      )
      .map((t) => ({ agentKey: t.agentKey, task: t.task.trim() }))
      .slice(0, 6);
  } catch {
    return [];
  }
}

export async function checkBudget(
  db: DbOrTx,
  workspaceId: string,
  now = new Date(),
): Promise<void> {
  const [limit] = await db
    .select({ cents: budget.monthlyLimitCents })
    .from(budget)
    .where(eq(budget.workspaceId, workspaceId));
  if (!limit?.cents) return;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [spent] = await db
    .select({ micros: sql<number>`coalesce(sum(${llmCall.costMicros}), 0)::bigint` })
    .from(llmCall)
    .where(and(eq(llmCall.workspaceId, workspaceId), gte(llmCall.createdAt, monthStart)));
  if (Number(spent?.micros ?? 0) / 10_000 >= limit.cents) throw new BudgetExceededError();
}

/**
 * Runs (or resumes) a request. Traced as one `squadai.run` span, with a
 * child span per step and per tool call, and the model calls inside them.
 */
export function runRequest(deps: RunDeps, input: RunInput): Promise<RunResult> {
  return inSpan(
    "squadai.run",
    { "squadai.request_id": input.requestId, "squadai.revision": Boolean(input.feedback) },
    async (span) => {
      const result = await runRequestTraced(deps, input);
      span.setAttribute("squadai.outcome", result.outcome);
      return result;
    },
  );
}

async function runRequestTraced(deps: RunDeps, input: RunInput): Promise<RunResult> {
  const { db } = deps;
  const log = (deps.log ?? createLogger({ service: "engine" })).child({
    requestId: input.requestId,
  });
  const followUps: RunInput[] = [];
  const skipped: RunResult = { outcome: "skipped", followUps };

  const [req] = await db
    .select({
      id: request.id,
      workspaceId: request.workspaceId,
      teamId: request.teamId,
      prompt: request.prompt,
      status: request.status,
      playbookId: request.playbookId,
      flow: request.flow,
      teamName: team.name,
      leadKey: team.leadKey,
      scope: team.scope,
    })
    .from(request)
    .innerJoin(team, eq(team.id, request.teamId))
    .where(eq(request.id, input.requestId));
  if (!req || req.status === "done" || req.status === "cancelled") return skipped;

  // No playbook: the team lead decides the flow ("adaptive").
  const [pb] = req.playbookId
    ? await db.select().from(playbook).where(eq(playbook.id, req.playbookId))
    : [];
  if (req.playbookId && !pb) return skipped;
  const [del] = await db
    .select()
    .from(delivery)
    .where(eq(delivery.requestId, req.id))
    .orderBy(desc(delivery.createdAt))
    .limit(1);
  const [teamRoom] = await db.select({ id: room.id }).from(room).where(eq(room.teamId, req.teamId));
  if (!del || !teamRoom) return skipped;
  trace.getActiveSpan()?.setAttributes({
    "squadai.workspace_id": req.workspaceId,
    "squadai.team": req.teamName,
    "squadai.mode": pb?.mode ?? "adaptive",
    "squadai.playbook": pb?.name ?? "",
  });
  if (del.status === "delivered" || (del.status === "awaiting_approval" && !input.feedback))
    return skipped;

  const agents = await db
    .select({
      id: agent.id,
      key: agent.key,
      name: agent.name,
      role: agent.role,
      instructions: agent.instructions,
      tier: agent.tier,
      model: agent.model,
      fallbackModel: agent.fallbackModel,
      style: agent.style,
      skills: agent.skills,
    })
    .from(agent)
    .where(eq(agent.teamId, req.teamId))
    .orderBy(asc(agent.position));
  const byKey = new Map<string, AgentRow>(agents.map((a) => [a.key, a]));
  const policyRows = agents.length
    ? await db
        .select()
        .from(agentToolPolicy)
        .where(
          inArray(
            agentToolPolicy.agentId,
            agents.map((a) => a.id),
          ),
        )
    : [];
  const policiesOf = (agentId: string) =>
    new Map<string, ToolPolicy>(
      policyRows.filter((p) => p.agentId === agentId).map((p) => [p.tool, p.policy]),
    );
  const otherTeams = await db
    .select({ slug: team.slug, name: team.name })
    .from(team)
    .where(and(eq(team.workspaceId, req.workspaceId), ne(team.id, req.teamId)));

  const models = await deps.loadModels(req.workspaceId);
  // Everything this run writes or asks follows the workspace language.
  const locale = workspaceLocale(models.settings);
  const words = wordsFor(locale);
  const allTools = workspaceTools(
    models,
    otherTeams,
    locale,
    agents.map((a) => ({ key: a.key, name: a.name })),
  );
  const scopeLine = scopeInstructions(words, req.scope, otherTeams);

  const ping = (type: "room" | "request" | "presence" | "delivery") =>
    notify(db, {
      type,
      workspaceId: req.workspaceId,
      teamId: req.teamId,
      requestId: req.id,
      deliveryId: del.id,
    });
  const say = async (
    agentId: string | null,
    body: string,
    kind: "chat" | "system" | "delivery" | "handoff" = "chat",
    payload?: Record<string, unknown>,
  ) => {
    await db.insert(message).values({
      roomId: teamRoom.id,
      kind,
      authorAgentId: agentId,
      requestId: req.id,
      body,
      payload,
    });
    await ping("room");
  };

  // ── Run bookkeeping ─────────────────────────────────────────────────
  const revision = Boolean(input.feedback);
  let [currentRun] = revision
    ? []
    : await db
        .select()
        .from(run)
        .where(
          and(
            eq(run.requestId, req.id),
            inArray(run.status, ["queued", "running", "failed", "waiting"]),
          ),
        )
        .orderBy(desc(run.createdAt))
        .limit(1);
  // Claim the run. If another worker holds it (the same request queued twice),
  // this job steps aside: a request never runs twice at once.
  if (!currentRun) {
    try {
      [currentRun] = await db
        .insert(run)
        .values({
          requestId: req.id,
          status: "running",
          startedAt: new Date(),
          leaseUntil: lease(),
        })
        .returning();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      log.info("another worker already started this request");
      return skipped;
    }
  } else {
    const [claimed] = await db
      .update(run)
      .set({ status: "running", error: null, leaseUntil: lease() })
      .where(
        and(
          eq(run.id, currentRun.id),
          or(ne(run.status, "running"), isNull(run.leaseUntil), lt(run.leaseUntil, new Date())),
        ),
      )
      .returning({ id: run.id });
    if (!claimed) {
      log.info("another worker is running this request", { runId: currentRun.id });
      return skipped;
    }
  }
  if (!currentRun) throw new Error("Could not create run.");
  const runId = currentRun.id;
  // Renewing the lease is also where a run learns it was cancelled.
  const renewLease = async () => {
    const [current] = await db
      .update(run)
      .set({ leaseUntil: lease() })
      .where(eq(run.id, runId))
      .returning({ status: run.status });
    if (!current || current.status === "cancelled") throw new RunCancelledError();
  };
  const rows = await db
    .select()
    .from(step)
    .where(eq(step.runId, runId))
    .orderBy(asc(step.position));

  const ensureStep = async (
    position: number,
    who: AgentRow,
    meta: { kind: StepKind | "checkpoint"; task: string },
  ): Promise<StepRow> => {
    const existing = rows.find((r) => r.position === position);
    if (existing) return existing;
    const [created] = await db
      .insert(step)
      .values({
        runId,
        position,
        agentId: who.id,
        input: { kind: meta.kind, task: meta.task, agentKey: who.key },
      })
      .returning();
    if (!created) throw new Error("Could not create step.");
    rows.push(created);
    return created;
  };

  await db.update(request).set({ status: "running" }).where(eq(request.id, req.id));
  await db.update(delivery).set({ status: "in_progress" }).where(eq(delivery.id, del.id));
  await ping("request");

  // ── One agent doing one step, with tools ────────────────────────────
  let currentStepId: string | null = null;

  const record = async (result: ChatResult, row: StepRow, who: AgentRow) => {
    await db.insert(llmCall).values({
      workspaceId: req.workspaceId,
      runId,
      stepId: row.id,
      agentId: who.id,
      provider: result.provider,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costMicros: result.costMicros,
      latencyMs: result.latencyMs,
      usedFallback: result.usedFallback,
    });
    if (result.usedFallback) {
      await say(null, words.room.usedFallback(who.name, result.model), "system");
    }
  };

  const saveCheckpoint = (row: StepRow, cp: Checkpoint, status?: StepRow["status"]) =>
    db
      .update(step)
      .set({ checkpoint: cp as unknown as Record<string, unknown>, ...(status ? { status } : {}) })
      .where(eq(step.id, row.id));

  const agentTurn = (
    row: StepRow,
    who: AgentRow,
    kind: StepKind,
    prompt: string,
    opts: TurnOptions = {},
  ): Promise<StepOutcome> =>
    row.status === "done"
      ? Promise.resolve({ status: "done", text: String(row.output?.text ?? "") })
      : inSpan(
          `squadai.step ${kind}`,
          {
            "squadai.step_id": row.id,
            "squadai.position": row.position,
            "squadai.agent": who.name,
            "squadai.step_kind": kind,
            ...(opts.round ? { "squadai.round": opts.round } : {}),
          },
          async (span) => {
            const outcome = await agentTurnTraced(row, who, kind, prompt, opts);
            span.setAttribute("squadai.step_status", outcome.status);
            return outcome;
          },
        );

  const agentTurnTraced = async (
    row: StepRow,
    who: AgentRow,
    kind: StepKind,
    prompt: string,
    opts: TurnOptions,
  ): Promise<StepOutcome> => {
    if (row.status === "done") return { status: "done", text: String(row.output?.text ?? "") };
    currentStepId = row.id;
    // Planning and talking things over are quick turns, without tools.
    const offered = opts.noTools
      ? new Map<string, OfferedTool>()
      : toolsForAgent(allTools, policiesOf(who.id));
    const toolCtx: ToolContext = {
      db,
      log,
      workspaceId: req.workspaceId,
      teamId: req.teamId,
      teamName: req.teamName,
      agentId: who.id,
      agentName: who.name,
      requestId: req.id,
      models,
    };
    const cp: Checkpoint = (row.checkpoint as unknown as Checkpoint | null) ?? {
      turns: [],
      toolCalls: 0,
      modelCalls: 0,
    };

    if (row.status !== "running") {
      await db
        .update(step)
        .set({ status: "running", startedAt: row.startedAt ?? new Date() })
        .where(eq(step.id, row.id));
      await ping("presence");
    }

    // Resolve whatever this step was waiting for.
    if (cp.pending) {
      const pending = cp.pending;
      let result: string | null = null;
      if (pending.type === "approval") {
        const [a] = await db.select().from(approval).where(eq(approval.id, pending.id));
        if (!a || a.status === "pending") {
          await saveCheckpoint(row, cp, "waiting");
          return { status: "waiting" };
        }
        if (a.status === "approved") {
          const tool = offered.get(pending.tool);
          const outcome = tool ? await runTool(tool, pending.input, toolCtx, who) : null;
          if (outcome?.kind === "wait") return { status: "waiting" };
          result = outcome?.text ?? words.toolResult.unavailable;
        } else {
          result = words.toolResult.refused;
        }
      } else {
        const [h] = await db.select().from(handoff).where(eq(handoff.id, pending.id));
        // A missing handoff means the helping team was removed: it can't help.
        if (h && (h.status === "open" || h.status === "in_progress")) {
          await saveCheckpoint(row, cp, "waiting");
          return { status: "waiting" };
        }
        result = h?.status === "done" ? (h.result ?? "") : words.toolResult.helpFailed;
      }
      cp.turns.push({ role: "user", content: formatToolResult(pending.tool, result) });
      cp.pending = undefined;
      await saveCheckpoint(row, cp, "running");
    }

    // Tools found mid-loop that need to pause.
    async function runTool(
      tool: OfferedTool,
      toolInput: Record<string, unknown>,
      ctx: ToolContext,
      by: AgentRow,
    ): Promise<{ kind: "text"; text: string } | { kind: "wait" }> {
      try {
        const outcome = await inSpan(
          `squadai.tool ${tool.def.name}`,
          { "squadai.tool": tool.def.name, "squadai.agent": by.name },
          () => tool.def.run(toolInput, ctx),
        );
        if (outcome.kind === "wait_handoff") {
          cp.pending = {
            type: "handoff",
            id: outcome.handoffId,
            tool: tool.def.name,
            input: toolInput,
          };
          await saveCheckpoint(row, cp, "waiting");
          followUps.push({ requestId: outcome.helperRequestId });
          return { kind: "wait" };
        }
        if (outcome.costMicros) {
          await db.insert(llmCall).values({
            workspaceId: ctx.workspaceId,
            runId,
            stepId: row.id,
            agentId: by.id,
            provider: "anthropic",
            model: `tool:${tool.def.name}`,
            costMicros: outcome.costMicros,
          });
        }
        return { kind: "text", text: outcome.text };
      } catch (error) {
        log.warn("tool failed", { tool: tool.def.name, error: String(error) });
        return { kind: "text", text: words.toolResult.failed(String(error).slice(0, 300)) };
      }
    }

    const system = [
      who.instructions,
      words.prompt.system(who.name, who.role, req.teamName),
      scopeLine,
      offered.size > 0 ? toolInstructions(toSpecs(offered), locale) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const hint = {
      agentName: who.name,
      kind,
      topic: req.prompt,
      locale,
      reviewing: opts.reviewing,
      round: opts.round,
      rounds: opts.rounds,
      rework: opts.rework,
      tools: [...offered.keys()],
      teammates: agents.map((a) => ({ key: a.key, name: a.name })),
      teams: otherTeams,
    };

    while (cp.modelCalls < MAX_MODEL_CALLS) {
      await renewLease();
      await checkBudget(db, req.workspaceId);
      // People watch the text appear; plans are JSON for the engine, not for them.
      const streamer =
        kind === "triage" || kind === "plan"
          ? null
          : createStreamer(db, {
              workspaceId: req.workspaceId,
              teamId: req.teamId,
              requestId: req.id,
              agentName: who.name,
              kind,
            });
      let result: ChatResult;
      try {
        result = await generateWithFallback(
          resolveAgentModels(who, models.settings),
          {
            system,
            prompt,
            continuation: cp.turns,
            style: who.style,
            effort: opts.effort ?? EFFORT[who.tier],
            maxOutputTokens: opts.maxOutputTokens,
            hint,
            onDelta: streamer?.onDelta,
            onRestart: streamer?.onRestart,
          },
          models.factory,
        );
      } finally {
        await streamer?.done();
      }
      cp.modelCalls++;
      await record(result, row, who);

      const call = parseToolCall(result.text);
      if (!call || cp.toolCalls >= MAX_TOOL_CALLS) {
        const text = call
          ? result.text.replace(TOOL_CALL_PATTERN, "").trim() || call.preface
          : result.text;
        await db
          .update(step)
          .set({ status: "done", finishedAt: new Date(), output: { text }, checkpoint: null })
          .where(eq(step.id, row.id));
        return { status: "done", text };
      }

      cp.turns.push({ role: "assistant", content: result.text });
      cp.toolCalls++;
      const tool = offered.get(call.name);
      if (!tool) {
        cp.turns.push({
          role: "user",
          content: formatToolResult(call.name, words.toolResult.notOffered),
        });
        await saveCheckpoint(row, cp);
        continue;
      }

      if (tool.policy === "ask") {
        const [a] = await db
          .insert(approval)
          .values({
            workspaceId: req.workspaceId,
            deliveryId: del.id,
            stepId: row.id,
            requestedByAgentId: who.id,
            kind: "tool",
            payload: { tool: tool.def.name, input: call.input },
            question: words.approval.tool(who.name, tool.def.label),
          })
          .returning({ id: approval.id });
        if (!a) throw new Error("Could not create approval.");
        cp.pending = { type: "approval", id: a.id, tool: tool.def.name, input: call.input };
        await saveCheckpoint(row, cp, "waiting");
        await say(who.id, words.room.askPermission(tool.def.label), "system", {
          approvalId: a.id,
        });
        await ping("delivery");
        return { status: "waiting" };
      }

      await say(who.id, words.room.usingTool(tool.def.label));
      const outcome = await runTool(tool, call.input, toolCtx, who);
      if (outcome.kind === "wait") return { status: "waiting" };
      cp.turns.push({ role: "user", content: formatToolResult(call.name, outcome.text) });
      if (cp.toolCalls >= MAX_TOOL_CALLS) {
        cp.turns.push({ role: "user", content: words.toolResult.limit });
      }
      await saveCheckpoint(row, cp);
    }
    throw new Error("Too many model calls in one step.");
  };

  // ── Versions ─────────────────────────────────────────────────────────
  const addVersion = async (
    who: AgentRow,
    label: string,
    text: string,
    notes: { anchor: string; body: string }[] = [],
  ) => {
    const [top] = await db
      .select({ n: max(deliveryVersion.number) })
      .from(deliveryVersion)
      .where(eq(deliveryVersion.deliveryId, del.id));
    const [version] = await db
      .insert(deliveryVersion)
      .values({
        deliveryId: del.id,
        number: (top?.n ?? 0) + 1,
        label: `${label} · ${who.name}`,
        content: text,
        authorAgentId: who.id,
      })
      .returning({ id: deliveryVersion.id });
    if (version && notes.length > 0) {
      await db.insert(reviewNote).values(
        notes.map((n) => ({
          versionId: version.id,
          agentId: who.id,
          anchor: n.anchor,
          body: n.body,
        })),
      );
    }
  };

  const [latestVersion] = await db
    .select({ content: deliveryVersion.content })
    .from(deliveryVersion)
    .where(eq(deliveryVersion.deliveryId, del.id))
    .orderBy(desc(deliveryVersion.number))
    .limit(1);
  const current = latestVersion?.content ?? null;

  /** Contributions from the last finished run, used when a revision only redoes the synthesis. */
  const previousContributions = async () => {
    const done = await db
      .select({ input: step.input, output: step.output })
      .from(step)
      .innerJoin(run, eq(run.id, step.runId))
      .where(and(eq(run.requestId, req.id), eq(step.status, "done"), ne(run.id, runId)));
    return done
      .filter((s) => s.input?.kind === "contribution")
      .map((s) => ({
        name: byKey.get(String(s.input?.agentKey))?.name ?? words.fallbackName.colleague,
        text: String(s.output?.text ?? ""),
      }));
  };

  log.info("run started", { runId, mode: pb?.mode ?? "adaptive", revision });

  let lastAgent: AgentRow | null = null;
  let finalText = "";
  let waiting = false;
  /** Set when the run ends without a delivery: out of scope, or stopped at a checkpoint. */
  let ended: "declined" | "cancelled" | null = null;

  try {
    if (!pb || pb.mode === "sequential") {
      let pos = 0;
      let flowSteps: FlowStep[];

      if (pb) {
        flowSteps = resolveFlow(pb.steps.filter((d) => byKey.has(d.agentKey)));
        if (flowSteps.length === 0) throw new Error("Playbook has no valid steps.");
      } else if (revision && req.flow) {
        // A revision follows the flow the lead chose the first time.
        flowSteps = resolveFlow(req.flow.steps.filter((d) => byKey.has(d.agentKey)));
      } else {
        // ── The lead plans a free-form request ───────────────────────────
        const lead = byKey.get(req.leadKey ?? "") ?? agents[0];
        if (!lead) throw new Error("Team has no agents.");
        const row = await ensureStep(pos++, lead, { kind: "triage", task: words.flow.planning });
        const wasDone = row.status === "done";
        if (row.status === "pending") await say(lead.id, words.flow.planning);
        const out = await agentTurn(
          row,
          lead,
          "triage",
          words.flowPrompt.triage(
            req.prompt,
            req.teamName,
            agents
              .map((a) => words.flowPrompt.roster(a.key, a.name, a.role, a.skills.join(", ")))
              .join("\n"),
            words.scopePrompt.scopeLines(
              (req.scope?.does ?? []).join("; "),
              (req.scope?.doesNot ?? []).join("; "),
            ),
          ),
          { noTools: true, effort: "low", maxOutputTokens: 800 },
        );
        if (out.status === "waiting") throw new Error("Planning can't wait.");
        const keys = agents.map((a) => a.key);
        const plan = parseFlowPlan(out.text, keys, lead.key) ?? {
          fit: "in" as const,
          title: "",
          steps: defaultFlow(keys, lead.key, req.prompt),
        };
        if (plan.fit === "out") {
          if (!wasDone) {
            const { alternatives } = await checkScope(db, {
              workspaceId: req.workspaceId,
              teamId: req.teamId,
              prompt: req.prompt,
            });
            await say(
              lead.id,
              describeOutOfScope(words, req.teamName, {
                fit: "out",
                reason: plan.reason,
                alternatives,
              }),
            );
          }
          ended = "declined";
          flowSteps = [];
        } else {
          flowSteps = plan.steps.length ? plan.steps : defaultFlow(keys, lead.key, req.prompt);
          if (!wasDone) {
            const title = plan.title || words.flow.customKind;
            await db
              .update(request)
              .set({ flow: { title, steps: flowSteps } })
              .where(eq(request.id, req.id));
            await db.update(delivery).set({ kind: title }).where(eq(delivery.id, del.id));
            await say(
              lead.id,
              words.flow.plan(title, describeSteps(words, flowSteps, byKey, true)),
            );
          }
        }
      }

      // ── Run the flow ──────────────────────────────────────────────────
      const todo = revision ? flowSteps.filter((s) => producesText(s.kind)) : flowSteps;
      const context: { by: string; text: string; decided: boolean }[] = [];
      let latest = current;
      // Set inside `draft`, so TypeScript must not narrow it to null.
      let writer = null as AgentRow | null;
      let notesForWriter = null as { by: string; notes: string } | null;

      const nextName = (i: number) => byKey.get(todo[i + 1]?.agentKey ?? "")?.name;

      /** One writing turn: a first draft, a revision after feedback, or a rewrite after review notes. */
      const draft = async (who: AgentRow, task: string, rework: boolean, next?: string) => {
        const row = await ensureStep(pos++, who, { kind: "draft", task });
        const wasDone = row.status === "done";
        if (row.status === "pending")
          await say(
            who.id,
            rework && notesForWriter
              ? words.flow.reworking
              : startLine(words, "draft", task, revision),
          );
        const out = await agentTurn(
          row,
          who,
          "draft",
          flowPrompt(words, {
            kind: "draft",
            task,
            prompt: req.prompt,
            context,
            latest,
            feedback: input.feedback,
            notes: notesForWriter,
          }),
          { rework: rework || revision },
        );
        if (out.status === "waiting") return false;
        if (!wasDone) {
          await addVersion(
            who,
            rework || revision ? words.version.adjustment : words.version.draft,
            out.text,
          );
          await say(who.id, endLine(words, "draft", next, 0));
        }
        latest = out.text;
        writer = who;
        lastAgent = who;
        notesForWriter = null;
        return true;
      };

      steps: for (let i = 0; i < todo.length && !ended; i++) {
        const def = todo[i];
        const who = def ? byKey.get(def.agentKey) : undefined;
        if (!def || !who) continue;

        switch (def.kind) {
          case "research": {
            const row = await ensureStep(pos++, who, { kind: "research", task: def.task });
            const wasDone = row.status === "done";
            if (row.status === "pending")
              await say(who.id, startLine(words, "research", def.task, revision));
            const out = await agentTurn(
              row,
              who,
              "research",
              flowPrompt(words, {
                kind: "research",
                task: def.task,
                prompt: req.prompt,
                context,
                latest: null,
              }),
            );
            if (out.status === "waiting") {
              waiting = true;
              break steps;
            }
            context.push({ by: who.name, text: out.text, decided: false });
            if (!wasDone) await say(who.id, endLine(words, "research", nextName(i), 0));
            lastAgent = who;
            break;
          }

          case "draft": {
            if (!(await draft(who, def.task, false, nextName(i)))) {
              waiting = true;
              break steps;
            }
            break;
          }

          case "review": {
            const rounds = def.rounds ?? 1;
            for (let round = 1; round <= rounds; round++) {
              const canSendBack = round < rounds && writer !== null && writer.id !== who.id;
              const row = await ensureStep(pos++, who, { kind: "review", task: def.task });
              const wasDone = row.status === "done";
              if (row.status === "pending" && round === 1)
                await say(who.id, startLine(words, "review", def.task, revision));
              const out = await agentTurn(
                row,
                who,
                "review",
                flowPrompt(words, {
                  kind: "review",
                  task: def.task,
                  prompt: req.prompt,
                  context,
                  latest,
                  verdict: canSendBack,
                }),
                { reviewing: latest ?? undefined, round, rounds: canSendBack ? rounds : 1 },
              );
              if (out.status === "waiting") {
                waiting = true;
                break steps;
              }
              const verdict = parseVerdict(out.text);
              const parsed = parseReview(verdict.text);
              const sendBack = canSendBack && verdict.revise;
              if (sendBack && writer) {
                // Back to the writer with the notes; the reviewer looks again next round.
                if (!wasDone)
                  await say(who.id, words.flow.sentBack(writer.name, parsed.notes.length));
                notesForWriter = {
                  by: who.name,
                  notes:
                    parsed.notes.map((n) => `- ${n.anchor}: ${n.body}`).join("\n") || parsed.text,
                };
                if (!(await draft(writer, def.task, true, who.name))) {
                  waiting = true;
                  break steps;
                }
                continue;
              }
              if (!wasDone) {
                await addVersion(
                  who,
                  words.version.review,
                  parsed.text || latest || "",
                  parsed.notes,
                );
                await say(who.id, endLine(words, "review", undefined, parsed.notes.length));
              }
              latest = parsed.text || latest;
              lastAgent = who;
              break;
            }
            break;
          }

          case "discuss": {
            const people = [who, ...(def.with ?? []).flatMap((k) => byKey.get(k) ?? [])];
            const lines: string[] = [];
            for (const [turn, person] of people.entries()) {
              const row = await ensureStep(pos++, person, { kind: "discussion", task: def.task });
              const wasDone = row.status === "done";
              if (row.status === "pending" && turn === 0)
                await say(who.id, words.flow.discussOpen(def.task));
              const out = await agentTurn(
                row,
                person,
                "discussion",
                [
                  words.prompt.request(req.prompt),
                  ...contextLines(words, context),
                  words.flowPrompt.discussion(def.task, lines.join("\n")),
                ].join("\n\n"),
                // The demo model reads the turn from `round`.
                { noTools: true, effort: "low", maxOutputTokens: 400, round: turn + 1 },
              );
              if (out.status === "waiting") {
                waiting = true;
                break steps;
              }
              lines.push(`${person.name}: ${out.text.replace(/\s+/g, " ").trim()}`);
              if (!wasDone) await say(person.id, out.text);
            }
            const row = await ensureStep(pos++, who, { kind: "summary", task: def.task });
            const wasDone = row.status === "done";
            const out = await agentTurn(
              row,
              who,
              "summary",
              words.flowPrompt.discussionSummary(def.task, lines.join("\n")),
              { noTools: true, effort: "low", maxOutputTokens: 600 },
            );
            if (out.status === "waiting") {
              waiting = true;
              break steps;
            }
            context.push({ by: who.name, text: out.text, decided: true });
            if (!wasDone) await say(who.id, words.flow.discussClosed);
            lastAgent = who;
            break;
          }

          case "checkpoint": {
            const row = await ensureStep(pos++, who, { kind: "checkpoint", task: def.task });
            if (row.status === "done") break;
            const pendingId = (row.checkpoint as { approvalId?: string } | null)?.approvalId;
            if (!pendingId) {
              const [a] = await db
                .insert(approval)
                .values({
                  workspaceId: req.workspaceId,
                  deliveryId: del.id,
                  stepId: row.id,
                  requestedByAgentId: who.id,
                  kind: "checkpoint",
                  question: def.task,
                })
                .returning({ id: approval.id });
              if (!a) throw new Error("Could not create approval.");
              await db
                .update(step)
                .set({ status: "waiting", startedAt: new Date(), checkpoint: { approvalId: a.id } })
                .where(eq(step.id, row.id));
              await say(who.id, words.flow.checkpointAsk(def.task), "system", { approvalId: a.id });
              await ping("delivery");
              waiting = true;
              break steps;
            }
            const [a] = await db.select().from(approval).where(eq(approval.id, pendingId));
            if (!a || a.status === "pending") {
              waiting = true;
              break steps;
            }
            await db
              .update(step)
              .set({ status: a.status === "approved" ? "done" : "skipped", finishedAt: new Date() })
              .where(eq(step.id, row.id));
            if (a.status !== "approved") ended = "cancelled";
            break;
          }
        }
        await ping("presence");
      }
      finalText = latest ?? "";
    } else {
      // coordinator or parallel
      const defs = pb.steps.filter((d) => byKey.has(d.agentKey));
      if (defs.length === 0) throw new Error("Playbook has no valid steps.");
      const lead = byKey.get(
        (pb.mode === "coordinator" ? defs[0] : defs.at(-1))?.agentKey ?? "",
      ) as AgentRow;
      let parts: { agentKey: string; task: string }[] = [];
      let contributions: { name: string; text: string }[] = [];

      if (revision) {
        contributions = await previousContributions();
      } else if (pb.mode === "coordinator") {
        const planRow = await ensureStep(0, lead, { kind: "plan", task: defs[0]?.task ?? "" });
        if (planRow.status === "pending") await say(lead.id, words.room.splitWork);
        const teammates = agents.filter((a) => a.id !== lead.id);
        const plan = await agentTurn(
          planRow,
          lead,
          "plan",
          planPrompt(words, req.prompt, defs[0]?.task ?? "", teammates),
        );
        if (plan.status === "waiting") waiting = true;
        else {
          parts = parsePlan(
            plan.text,
            teammates.map((t) => t.key),
          );
          if (parts.length === 0)
            parts = defs.slice(1).map((d) => ({ agentKey: d.agentKey, task: d.task }));
          if (planRow.status === "pending") {
            await say(
              lead.id,
              words.room.planAgreed(
                parts.map((p) => ({
                  agent: byKey.get(p.agentKey)?.name ?? p.agentKey,
                  task: p.task,
                })),
              ),
            );
          }
        }
      } else {
        parts = defs.slice(0, -1).map((d) => ({ agentKey: d.agentKey, task: d.task }));
      }

      if (!waiting && !revision) {
        const offset = pb.mode === "coordinator" ? 1 : 0;
        const results = await Promise.all(
          parts.map(async (p, i) => {
            const who = byKey.get(p.agentKey) as AgentRow;
            const row = await ensureStep(offset + i, who, { kind: "contribution", task: p.task });
            if (row.status === "pending") await say(who.id, words.room.tookPart(p.task));
            const out = await agentTurn(
              row,
              who,
              "contribution",
              contributionPrompt(words, req.prompt, p.task),
            );
            if (out.status === "done" && row.status !== "done")
              await say(who.id, words.room.partDone);
            return { who, out };
          }),
        );
        if (results.some((r) => r.out.status === "waiting")) waiting = true;
        contributions = results.flatMap((r) =>
          r.out.status === "done" ? [{ name: r.who.name, text: r.out.text }] : [],
        );
      }

      if (!waiting) {
        const position = revision ? 0 : (pb.mode === "coordinator" ? 1 : 0) + parts.length;
        const task =
          (pb.mode === "coordinator" ? defs[0]?.task : defs.at(-1)?.task) ??
          words.prompt.combineTask;
        const row = await ensureStep(position, lead, { kind: "synthesis", task });
        if (row.status === "pending")
          await say(lead.id, revision ? words.room.redoResult : words.room.combining);
        const out = await agentTurn(
          row,
          lead,
          "synthesis",
          synthesisPrompt(words, req.prompt, task, contributions, input.feedback, current),
        );
        if (out.status === "waiting") waiting = true;
        else {
          if (row.status !== "done") {
            await addVersion(
              lead,
              revision ? words.version.adjustment : words.version.result,
              out.text,
            );
            await say(lead.id, words.room.combined);
          }
          finalText = out.text;
          lastAgent = lead;
        }
      }
    }
  } catch (error) {
    if (error instanceof RunCancelledError) {
      log.info("run stopped: the request was cancelled", { runId });
      return { outcome: "cancelled", followUps };
    }
    const reason = friendlyError(error, locale);
    log.warn("run failed", { runId, error: String(error) });
    if (currentStepId)
      await db
        .update(step)
        .set({ status: "failed", finishedAt: new Date() })
        .where(eq(step.id, currentStepId));
    await db
      .update(run)
      .set({ status: "failed", error: reason, finishedAt: new Date() })
      .where(eq(run.id, runId));
    await db.update(request).set({ status: "failed" }).where(eq(request.id, req.id));
    await say(null, words.room.failed(reason), "system", { failed: true });
    await ping("request");
    return { outcome: "failed", followUps };
  }

  if (waiting) {
    await db.update(run).set({ status: "waiting" }).where(eq(run.id, runId));
    await db.update(request).set({ status: "waiting" }).where(eq(request.id, req.id));
    await ping("request");
    log.info("run waiting", { runId });
    return { outcome: "waiting", followUps };
  }

  if (ended) {
    await db.update(run).set({ status: "done", finishedAt: new Date() }).where(eq(run.id, runId));
    await db.update(request).set({ status: "cancelled" }).where(eq(request.id, req.id));
    await db.update(delivery).set({ status: "cancelled" }).where(eq(delivery.id, del.id));
    await ping("request");
    await ping("delivery");
    log.info("run ended without a delivery", { runId, reason: ended });
    return { outcome: ended, followUps };
  }

  await db.update(run).set({ status: "done", finishedAt: new Date() }).where(eq(run.id, runId));

  if (pb?.requiresApproval ?? true) {
    await db.update(delivery).set({ status: "awaiting_approval" }).where(eq(delivery.id, del.id));
    await db.insert(approval).values({
      workspaceId: req.workspaceId,
      deliveryId: del.id,
      requestedByAgentId: lastAgent?.id ?? null,
      kind: "delivery",
      question: words.approval.delivery,
    });
    await db.update(request).set({ status: "waiting" }).where(eq(request.id, req.id));
    await say(lastAgent?.id ?? null, words.room.readyForReview(del.title), "delivery", {
      deliveryId: del.id,
    });
    await ping("delivery");
    return { outcome: "awaiting_approval", followUps };
  }

  await db
    .update(delivery)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(eq(delivery.id, del.id));
  await db.update(request).set({ status: "done" }).where(eq(request.id, req.id));
  await say(lastAgent?.id ?? null, words.room.delivered(del.title), "delivery", {
    deliveryId: del.id,
  });
  await ping("delivery");
  followUps.push(...(await resolveHandoffsFor(db, req.id, finalText)));
  return { outcome: "delivered", followUps };
}

// ── Words ──────────────────────────────────────────────────────────────
// What agents say and read. The wording lives in ./words.ts, per locale.

function startLine(words: Words, kind: StepKind, task: string, revision: boolean): string {
  if (revision && kind !== "review") return words.room.startRevision;
  if (kind === "research") return words.room.startResearch(task);
  if (kind === "review") return words.room.startReview;
  return words.room.startDraft;
}

function endLine(
  words: Words,
  kind: StepKind,
  nextName: string | undefined,
  notes: number,
): string {
  if (kind === "research") return words.room.researchDone(nextName);
  if (kind === "review") return words.room.reviewDone(notes);
  return words.room.draftDone(nextName);
}

/** What earlier steps left for the next ones: research, and what discussions agreed. */
function contextLines(
  words: Words,
  context: { by: string; text: string; decided: boolean }[],
): string[] {
  return context.map((c) =>
    c.decided ? words.flowPrompt.decisions(c.by, c.text) : words.prompt.research(c.by, c.text),
  );
}

function flowPrompt(
  words: Words,
  input: {
    kind: "research" | "draft" | "review";
    task: string;
    prompt: string;
    context: { by: string; text: string; decided: boolean }[];
    latest: string | null;
    feedback?: string;
    /** A reviewer's notes the writer must address. */
    notes?: { by: string; notes: string } | null;
    /** The reviewer may send the draft back, so it starts with a verdict. */
    verdict?: boolean;
  },
): string {
  const w = words.prompt;
  const parts = [w.request(input.prompt)];
  if (input.feedback) parts.push(w.feedback(input.feedback));
  if (input.kind !== "research") parts.push(...contextLines(words, input.context));
  if (input.latest && input.kind === "review") parts.push(w.toReview(input.latest));
  else if (input.latest && (input.feedback || input.notes)) parts.push(w.current(input.latest));
  if (input.notes) parts.push(words.flowPrompt.reviewerNotes(input.notes.by, input.notes.notes));
  parts.push(w.taskNow(input.task));
  if (input.kind === "review") {
    if (input.verdict) parts.push(words.flowPrompt.verdict);
    parts.push(w.reviewFormat(REVIEW_NOTES_MARKER));
  } else if (input.kind === "draft") parts.push(w.draftFormat);
  else parts.push(w.researchFormat);
  return parts.join("\n\n");
}

/** "Lia researches → Téo writes → Bia reviews (up to 2 rounds) → you approve". */
export function describeSteps(
  words: Words,
  steps: FlowStep[],
  byKey: Map<string, { name: string }>,
  approval: boolean,
): string[] {
  const name = (key: string) => byKey.get(key)?.name ?? key;
  const lines = steps.map((s) => {
    switch (s.kind) {
      case "research":
        return words.flow.step.research(name(s.agentKey));
      case "draft":
        return words.flow.step.draft(name(s.agentKey));
      case "review":
        return words.flow.step.review(name(s.agentKey), s.rounds ?? 1);
      case "discuss":
        return words.flow.step.discuss([s.agentKey, ...(s.with ?? [])].map(name).join(", "));
      default:
        return words.flow.step.checkpoint;
    }
  });
  return approval ? [...lines, words.flow.step.approve] : lines;
}

function planPrompt(words: Words, prompt: string, task: string, teammates: AgentRow[]): string {
  const w = words.prompt;
  return [
    w.request(prompt),
    w.task(task),
    w.team(teammates.map((t) => `- ${t.key}: ${t.name} (${t.role})`).join("\n")),
    w.planFormat,
  ].join("\n\n");
}

function contributionPrompt(words: Words, prompt: string, task: string): string {
  const w = words.prompt;
  return [w.request(prompt), w.part(task), w.contributionFormat].join("\n\n");
}

function synthesisPrompt(
  words: Words,
  prompt: string,
  task: string,
  contributions: { name: string; text: string }[],
  feedback: string | undefined,
  current: string | null,
): string {
  const w = words.prompt;
  const parts = [w.request(prompt)];
  for (const c of contributions) parts.push(w.contribution(c.name, c.text));
  if (feedback) parts.push(w.feedback(feedback));
  if (feedback && current) parts.push(w.current(current));
  parts.push(w.taskNow(task), w.resultFormat);
  return parts.join("\n\n");
}
