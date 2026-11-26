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
  LEGACY_REVIEW_NOTES_MARKER,
  parseToolCall,
  REVIEW_NOTES_MARKER,
  TOOL_CALL_PATTERN,
  toolInstructions,
} from "@squadai/providers";
import { and, asc, desc, eq, gte, inArray, max, ne, sql } from "drizzle-orm";
import { notify } from "./events.ts";
import { resolveHandoffsFor } from "./handoffs.ts";
import type { ModelContext } from "./models.ts";
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

export type RunOutcome = "awaiting_approval" | "delivered" | "waiting" | "failed" | "skipped";

export interface RunResult {
  outcome: RunOutcome;
  /** Other runs to start or resume (helper teams, or a team waiting on this one). */
  followUps: RunInput[];
}

const EFFORT: Record<ModelTier, Effort> = { economy: "low", balanced: "medium", max: "high" };
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
      return { anchor: (anchor ?? "").trim(), body: rest.join("::").trim() };
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

export async function runRequest(deps: RunDeps, input: RunInput): Promise<RunResult> {
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
      teamName: team.name,
    })
    .from(request)
    .innerJoin(team, eq(team.id, request.teamId))
    .where(eq(request.id, input.requestId));
  if (!req?.playbookId || req.status === "done" || req.status === "cancelled") return skipped;

  const [pb] = await db.select().from(playbook).where(eq(playbook.id, req.playbookId));
  const [del] = await db
    .select()
    .from(delivery)
    .where(eq(delivery.requestId, req.id))
    .orderBy(desc(delivery.createdAt))
    .limit(1);
  const [teamRoom] = await db.select({ id: room.id }).from(room).where(eq(room.teamId, req.teamId));
  if (!pb || !del || !teamRoom) return skipped;
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
  const allTools = workspaceTools(models, otherTeams, locale);

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
  if (!currentRun) {
    [currentRun] = await db
      .insert(run)
      .values({ requestId: req.id, status: "running", startedAt: new Date() })
      .returning();
  } else {
    await db.update(run).set({ status: "running", error: null }).where(eq(run.id, currentRun.id));
  }
  if (!currentRun) throw new Error("Could not create run.");
  const runId = currentRun.id;
  const rows = await db
    .select()
    .from(step)
    .where(eq(step.runId, runId))
    .orderBy(asc(step.position));

  const ensureStep = async (
    position: number,
    who: AgentRow,
    meta: { kind: StepKind; task: string },
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

  const agentTurn = async (
    row: StepRow,
    who: AgentRow,
    kind: StepKind,
    prompt: string,
    /** The text a review step revises (only the demo model reads it). */
    reviewing?: string,
  ): Promise<StepOutcome> => {
    if (row.status === "done") return { status: "done", text: String(row.output?.text ?? "") };
    currentStepId = row.id;
    const offered = toolsForAgent(allTools, policiesOf(who.id));
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
        if (!h || h.status === "open" || h.status === "in_progress") {
          await saveCheckpoint(row, cp, "waiting");
          return { status: "waiting" };
        }
        result = h.status === "done" ? (h.result ?? "") : words.toolResult.helpFailed;
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
        const outcome = await tool.def.run(toolInput, ctx);
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
      toolInstructions(toSpecs(offered), locale),
    ]
      .filter(Boolean)
      .join("\n\n");
    const hint = {
      agentName: who.name,
      kind,
      topic: req.prompt,
      locale,
      reviewing,
      tools: [...offered.keys()],
      teammates: agents.map((a) => ({ key: a.key, name: a.name })),
      teams: otherTeams,
    };

    while (cp.modelCalls < MAX_MODEL_CALLS) {
      await checkBudget(db, req.workspaceId);
      const result = await generateWithFallback(
        resolveAgentModels(who, models.settings),
        {
          system,
          prompt,
          continuation: cp.turns,
          style: who.style,
          effort: EFFORT[who.tier],
          hint,
        },
        models.factory,
      );
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

  log.info("run started", { runId, mode: pb.mode, revision });

  let lastAgent: AgentRow | null = null;
  let finalText = "";
  let waiting = false;

  try {
    const defs = pb.steps.filter((d) => byKey.has(d.agentKey));
    if (defs.length === 0) throw new Error("Playbook has no valid steps.");

    if (pb.mode === "sequential") {
      const firstProducing = defs.length > 1 ? 1 : 0;
      const todo = revision ? defs.slice(firstProducing) : defs;
      let research: { by: string; text: string } | null = null;
      let latest = current;
      for (let i = 0; i < todo.length; i++) {
        const def = todo[i];
        const who = def ? byKey.get(def.agentKey) : undefined;
        if (!def || !who) continue;
        const indexInAll = revision ? i + firstProducing : i;
        const kind: StepKind =
          defs.length > 1 && indexInAll === 0
            ? "research"
            : defs.length > 2 && indexInAll === defs.length - 1
              ? "review"
              : "draft";
        const row = await ensureStep(i, who, { kind, task: def.task });
        const fresh = row.status === "pending";
        if (fresh) await say(who.id, startLine(words, kind, def.task, revision));
        const outcome = await agentTurn(
          row,
          who,
          kind,
          sequentialPrompt(words, {
            kind,
            task: def.task,
            prompt: req.prompt,
            research,
            latest,
            feedback: input.feedback,
          }),
          kind === "review" ? (latest ?? undefined) : undefined,
        );
        if (outcome.status === "waiting") {
          waiting = true;
          break;
        }
        lastAgent = who;
        if (kind === "research") {
          research = { by: who.name, text: outcome.text };
        } else if (row.status !== "done") {
          const parsed =
            kind === "review" ? parseReview(outcome.text) : { text: outcome.text, notes: [] };
          await addVersion(
            who,
            kind === "review"
              ? words.version.review
              : revision
                ? words.version.adjustment
                : words.version.draft,
            parsed.text,
            parsed.notes,
          );
          latest = parsed.text;
          await say(
            who.id,
            endLine(
              words,
              kind,
              todo[i + 1] ? byKey.get(todo[i + 1]?.agentKey ?? "")?.name : undefined,
              parsed.notes.length,
            ),
          );
        } else {
          latest = outcome.text;
        }
        if (kind === "research" && row.status !== "done") {
          await say(
            who.id,
            endLine(
              words,
              kind,
              todo[i + 1] ? byKey.get(todo[i + 1]?.agentKey ?? "")?.name : undefined,
              0,
            ),
          );
        }
        finalText = latest ?? outcome.text;
        await ping("presence");
      }
    } else {
      // coordinator or parallel
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

  await db.update(run).set({ status: "done", finishedAt: new Date() }).where(eq(run.id, runId));

  if (pb.requiresApproval) {
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

function sequentialPrompt(
  words: Words,
  input: {
    kind: StepKind;
    task: string;
    prompt: string;
    research: { by: string; text: string } | null;
    latest: string | null;
    feedback?: string;
  },
): string {
  const w = words.prompt;
  const parts = [w.request(input.prompt)];
  if (input.feedback) parts.push(w.feedback(input.feedback));
  if (input.research && input.kind !== "research")
    parts.push(w.research(input.research.by, input.research.text));
  if (input.latest && input.kind === "review") parts.push(w.toReview(input.latest));
  else if (input.latest && input.feedback) parts.push(w.current(input.latest));
  parts.push(w.taskNow(input.task));
  if (input.kind === "review") parts.push(w.reviewFormat(REVIEW_NOTES_MARKER));
  else if (input.kind === "draft") parts.push(w.draftFormat);
  return parts.join("\n\n");
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
