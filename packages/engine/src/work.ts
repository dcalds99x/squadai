/**
 * What people do: ask for work, approve it, ask for changes, talk in the room.
 * Each function writes in one transaction and returns what the caller must
 * enqueue, so the web app never runs models inside a request.
 */
import { type Locale, workspaceLocale } from "@squadai/core";
import type { DbOrTx } from "@squadai/db";
import { schema } from "@squadai/db";
import { and, desc, eq } from "drizzle-orm";
import { notify } from "./events.ts";
import { latestDeliveryText, resolveHandoffsFor } from "./handoffs.ts";
import { wordsFor } from "./words.ts";

const {
  agent,
  approval,
  auditLog,
  delivery,
  message,
  playbook,
  request,
  room,
  run,
  step,
  team,
  workspace,
} = schema;

/**
 * Why a person's action was refused. The engine does not word it: the web app
 * shows each code in the person's language (`errors.work.<code>` in its catalogs).
 */
export const WORK_ERRORS = [
  "no_room",
  "prompt_too_short",
  "unknown_playbook",
  "request_not_saved",
  "delivery_not_created",
  "delivery_not_found",
  "delivery_not_waiting",
  "approval_not_found",
  "approval_decided",
  "feedback_too_short",
  "empty_message",
  "team_not_found",
  "message_not_sent",
] as const;
export type WorkErrorCode = (typeof WORK_ERRORS)[number];

export class WorkError extends Error {
  readonly code: WorkErrorCode;
  constructor(code: WorkErrorCode) {
    super(`Work refused: ${code}`);
    this.name = "WorkError";
    this.code = code;
  }
}

/** Room lines are written in the workspace's language, whoever acts. */
async function localeOf(db: DbOrTx, workspaceId: string): Promise<Locale> {
  const [ws] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  return workspaceLocale(ws?.settings);
}

function titleFrom(prompt: string): string {
  const firstLine = prompt.trim().split("\n")[0] ?? "";
  const clean = firstLine.replace(
    /^(preciso de|quero|gostaria de|faça|faz|i need|i want|i'd like|we need|please)\s+/i,
    "",
  );
  const title = clean.charAt(0).toUpperCase() + clean.slice(1);
  return title.length > 80 ? `${title.slice(0, 77).trimEnd()}…` : title;
}

async function roomOf(db: DbOrTx, teamId: string): Promise<string> {
  const [row] = await db.select({ id: room.id }).from(room).where(eq(room.teamId, teamId));
  if (!row) throw new WorkError("no_room");
  return row.id;
}

export async function createRequest(
  db: DbOrTx,
  input: {
    workspaceId: string;
    teamId: string;
    playbookId: string;
    userId: string;
    prompt: string;
  },
): Promise<{ requestId: string; deliveryId: string; teamId: string }> {
  const prompt = input.prompt.trim();
  if (prompt.length < 5) throw new WorkError("prompt_too_short");
  const words = wordsFor(await localeOf(db, input.workspaceId));

  const result = await db.transaction(async (tx) => {
    const [pb] = await tx
      .select({ id: playbook.id, name: playbook.name, minutes: playbook.estimatedHumanMinutes })
      .from(playbook)
      .innerJoin(team, eq(team.id, playbook.teamId))
      .where(
        and(
          eq(playbook.id, input.playbookId),
          eq(playbook.teamId, input.teamId),
          eq(team.workspaceId, input.workspaceId),
        ),
      );
    if (!pb) throw new WorkError("unknown_playbook");

    const [req] = await tx
      .insert(request)
      .values({
        workspaceId: input.workspaceId,
        teamId: input.teamId,
        playbookId: pb.id,
        requestedBy: input.userId,
        prompt,
      })
      .returning({ id: request.id });
    if (!req) throw new WorkError("request_not_saved");

    const [del] = await tx
      .insert(delivery)
      .values({
        requestId: req.id,
        teamId: input.teamId,
        title: titleFrom(prompt),
        kind: pb.name,
        estimatedHumanMinutes: pb.minutes,
      })
      .returning({ id: delivery.id });
    if (!del) throw new WorkError("delivery_not_created");

    await tx.insert(message).values({
      roomId: await roomOf(tx, input.teamId),
      kind: "chat",
      authorUserId: input.userId,
      requestId: req.id,
      body: words.room.newRequest(pb.name, prompt),
    });
    await tx.insert(auditLog).values({
      workspaceId: input.workspaceId,
      actorType: "user",
      actorId: input.userId,
      action: "request.created",
      target: req.id,
    });
    return { requestId: req.id, deliveryId: del.id, teamId: input.teamId };
  });

  await notify(db, {
    type: "request",
    workspaceId: input.workspaceId,
    teamId: input.teamId,
    requestId: result.requestId,
  });
  return result;
}

async function loadDeliveryForDecision(db: DbOrTx, workspaceId: string, deliveryId: string) {
  const [row] = await db
    .select({
      id: delivery.id,
      status: delivery.status,
      teamId: delivery.teamId,
      requestId: delivery.requestId,
      title: delivery.title,
    })
    .from(delivery)
    .innerJoin(team, eq(team.id, delivery.teamId))
    .where(and(eq(delivery.id, deliveryId), eq(team.workspaceId, workspaceId)));
  if (!row) throw new WorkError("delivery_not_found");
  if (row.status !== "awaiting_approval") throw new WorkError("delivery_not_waiting");
  return row;
}

export async function approveDelivery(
  db: DbOrTx,
  input: { workspaceId: string; deliveryId: string; userId: string },
): Promise<{ followUps: { requestId: string }[] }> {
  const words = wordsFor(await localeOf(db, input.workspaceId));
  const d = await db.transaction(async (tx) => {
    const d = await loadDeliveryForDecision(tx, input.workspaceId, input.deliveryId);
    const now = new Date();
    await tx
      .update(delivery)
      .set({ status: "delivered", deliveredAt: now })
      .where(eq(delivery.id, d.id));
    await tx
      .update(approval)
      .set({ status: "approved", decidedBy: input.userId, decidedAt: now })
      .where(
        and(
          eq(approval.deliveryId, d.id),
          eq(approval.kind, "delivery"),
          eq(approval.status, "pending"),
        ),
      );
    await tx.update(request).set({ status: "done" }).where(eq(request.id, d.requestId));
    await tx.insert(message).values({
      roomId: await roomOf(tx, d.teamId),
      kind: "system",
      requestId: d.requestId,
      payload: { deliveryId: d.id },
      body: words.room.approved(d.title),
    });
    await tx.insert(auditLog).values({
      workspaceId: input.workspaceId,
      actorType: "user",
      actorId: input.userId,
      action: "delivery.approved",
      target: d.id,
    });
    return d;
  });
  await notify(db, {
    type: "delivery",
    workspaceId: input.workspaceId,
    teamId: d.teamId,
    deliveryId: d.id,
  });
  // If this delivery was helping another team, that team can continue now.
  const followUps = await resolveHandoffsFor(
    db,
    d.requestId,
    await latestDeliveryText(db, d.requestId),
  );
  return { followUps };
}

/**
 * A person allows or refuses a tool an agent asked to use ("Pede antes").
 * Returns the request to resume: the paused step picks up the decision.
 */
export async function decideToolApproval(
  db: DbOrTx,
  input: { workspaceId: string; approvalId: string; userId: string; allow: boolean },
): Promise<{ requestId: string }> {
  const [row] = await db
    .select({
      id: approval.id,
      status: approval.status,
      payload: approval.payload,
      requestId: run.requestId,
      teamId: delivery.teamId,
      agentName: agent.name,
    })
    .from(approval)
    .innerJoin(step, eq(step.id, approval.stepId))
    .innerJoin(run, eq(run.id, step.runId))
    .leftJoin(delivery, eq(delivery.id, approval.deliveryId))
    .leftJoin(agent, eq(agent.id, approval.requestedByAgentId))
    .where(
      and(
        eq(approval.id, input.approvalId),
        eq(approval.workspaceId, input.workspaceId),
        eq(approval.kind, "tool"),
      ),
    );
  if (!row) throw new WorkError("approval_not_found");
  if (row.status !== "pending") throw new WorkError("approval_decided");
  const words = wordsFor(await localeOf(db, input.workspaceId));

  await db
    .update(approval)
    .set({
      status: input.allow ? "approved" : "rejected",
      decidedBy: input.userId,
      decidedAt: new Date(),
    })
    .where(eq(approval.id, row.id));
  await db.update(request).set({ status: "queued" }).where(eq(request.id, row.requestId));
  if (row.teamId) {
    await db.insert(message).values({
      roomId: await roomOf(db, row.teamId),
      kind: "system",
      requestId: row.requestId,
      body: input.allow
        ? words.room.toolAllowed(row.agentName)
        : words.room.toolRefused(row.agentName),
    });
  }
  await db.insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorType: "user",
    actorId: input.userId,
    action: input.allow ? "tool.allowed" : "tool.refused",
    target: row.id,
    metadata: { tool: row.payload?.tool ?? null, input: row.payload?.input ?? null },
  });
  await notify(db, {
    type: "request",
    workspaceId: input.workspaceId,
    teamId: row.teamId ?? undefined,
    requestId: row.requestId,
  });
  return { requestId: row.requestId };
}

/** Returns the request to re-run with the person's feedback. */
export async function requestChanges(
  db: DbOrTx,
  input: { workspaceId: string; deliveryId: string; userId: string; feedback: string },
): Promise<{ requestId: string; feedback: string }> {
  const feedback = input.feedback.trim();
  if (feedback.length < 3) throw new WorkError("feedback_too_short");
  const words = wordsFor(await localeOf(db, input.workspaceId));
  const d = await db.transaction(async (tx) => {
    const d = await loadDeliveryForDecision(tx, input.workspaceId, input.deliveryId);
    const [current] = await tx
      .select({ count: delivery.adjustmentCount })
      .from(delivery)
      .where(eq(delivery.id, d.id));
    await tx
      .update(delivery)
      .set({ status: "in_progress", adjustmentCount: (current?.count ?? 0) + 1 })
      .where(eq(delivery.id, d.id));
    await tx
      .update(approval)
      .set({ status: "changes_requested", decidedBy: input.userId, decidedAt: new Date() })
      .where(
        and(
          eq(approval.deliveryId, d.id),
          eq(approval.kind, "delivery"),
          eq(approval.status, "pending"),
        ),
      );
    await tx.update(request).set({ status: "queued" }).where(eq(request.id, d.requestId));
    await tx.insert(message).values({
      roomId: await roomOf(tx, d.teamId),
      kind: "chat",
      authorUserId: input.userId,
      requestId: d.requestId,
      body: words.room.changesRequested(d.title, feedback),
    });
    await tx.insert(auditLog).values({
      workspaceId: input.workspaceId,
      actorType: "user",
      actorId: input.userId,
      action: "delivery.changes_requested",
      target: d.id,
    });
    return d;
  });
  await notify(db, {
    type: "delivery",
    workspaceId: input.workspaceId,
    teamId: d.teamId,
    deliveryId: d.id,
  });
  return { requestId: d.requestId, feedback };
}

/** Posts a person's message. Returns the agents it mentions, who should reply. */
export async function postUserMessage(
  db: DbOrTx,
  input: { workspaceId: string; teamId: string; userId: string; body: string },
): Promise<{ messageId: string; mentionedAgentIds: string[] }> {
  const body = input.body.trim();
  if (!body) throw new WorkError("empty_message");
  const [t] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, input.teamId), eq(team.workspaceId, input.workspaceId)));
  if (!t) throw new WorkError("team_not_found");

  const [msg] = await db
    .insert(message)
    .values({
      roomId: await roomOf(db, input.teamId),
      kind: "chat",
      authorUserId: input.userId,
      body,
    })
    .returning({ id: message.id });
  if (!msg) throw new WorkError("message_not_sent");

  const agents = await db
    .select({ id: agent.id, name: agent.name })
    .from(agent)
    .where(eq(agent.teamId, input.teamId));
  const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const text = normalize(body);
  const mentioned = agents.filter((a) => text.includes(`@${normalize(a.name)}`)).map((a) => a.id);

  await notify(db, { type: "room", workspaceId: input.workspaceId, teamId: input.teamId });
  return { messageId: msg.id, mentionedAgentIds: mentioned };
}

/** The latest delivery of a request, used by the retry action. */
export async function latestDeliveryOf(db: DbOrTx, requestId: string) {
  const [row] = await db
    .select()
    .from(delivery)
    .where(eq(delivery.requestId, requestId))
    .orderBy(desc(delivery.createdAt))
    .limit(1);
  return row ?? null;
}
