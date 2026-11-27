/**
 * Taking work back: cancel a delivery, delete it, or remove a whole team.
 * Each returns the runs to resume, because a team waiting on the work that
 * goes away (a handoff) must carry on without it.
 */
import { workspaceLocale } from "@squadai/core";
import { type DbOrTx, schema } from "@squadai/db";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { notify } from "./events.ts";
import type { RunInput } from "./runner.ts";
import { wordsFor } from "./words.ts";
import { WorkError } from "./work.ts";

const {
  agent,
  approval,
  auditLog,
  delivery,
  department,
  handoff,
  llmCall,
  message,
  request,
  room,
  run,
  step,
  team,
} = schema;

/**
 * Keeps the cost ledger when its runs, steps or agents are deleted: the month's
 * spend must not change. (Postgres can't null these through several cascades
 * in one statement, so it is done first, by hand.)
 */
async function detachLedger(db: DbOrTx, input: { requestIds: string[]; agentIds?: string[] }) {
  const runIds = input.requestIds.length
    ? (
        await db.select({ id: run.id }).from(run).where(inArray(run.requestId, input.requestIds))
      ).map((r) => r.id)
    : [];
  if (runIds.length > 0)
    await db
      .update(llmCall)
      .set({ runId: null, stepId: null })
      .where(inArray(llmCall.runId, runIds));
  if (input.agentIds?.length)
    await db
      .update(llmCall)
      .set({ agentId: null, runId: null, stepId: null })
      .where(inArray(llmCall.agentId, input.agentIds));
}

async function loadDelivery(db: DbOrTx, workspaceId: string, deliveryId: string) {
  const [row] = await db
    .select({
      id: delivery.id,
      title: delivery.title,
      status: delivery.status,
      teamId: delivery.teamId,
      requestId: delivery.requestId,
    })
    .from(delivery)
    .innerJoin(request, eq(request.id, delivery.requestId))
    .where(and(eq(delivery.id, deliveryId), eq(request.workspaceId, workspaceId)));
  if (!row) throw new WorkError("delivery_not_found");
  return row;
}

/** Stops a request's work and releases whoever waits on it. Returns the runs to resume. */
async function stopRequests(db: DbOrTx, requestIds: string[]): Promise<RunInput[]> {
  if (requestIds.length === 0) return [];
  await db
    .update(request)
    .set({ status: "cancelled" })
    .where(and(inArray(request.id, requestIds), notInArray(request.status, ["done"])));
  // A worker in the middle of one of these runs stops at its next model call.
  await db
    .update(run)
    .set({ status: "cancelled", leaseUntil: null, finishedAt: new Date() })
    .where(
      and(
        inArray(run.requestId, requestIds),
        inArray(run.status, ["queued", "running", "waiting", "failed"]),
      ),
    );
  const runIds = (
    await db.select({ id: run.id }).from(run).where(inArray(run.requestId, requestIds))
  ).map((r) => r.id);
  if (runIds.length > 0) {
    await db
      .update(step)
      .set({ status: "skipped", finishedAt: new Date() })
      .where(
        and(inArray(step.runId, runIds), inArray(step.status, ["pending", "running", "waiting"])),
      );
  }
  const deliveryIds = (
    await db
      .select({ id: delivery.id })
      .from(delivery)
      .where(inArray(delivery.requestId, requestIds))
  ).map((d) => d.id);
  if (deliveryIds.length > 0) {
    await db
      .update(delivery)
      .set({ status: "cancelled" })
      .where(and(inArray(delivery.id, deliveryIds), notInArray(delivery.status, ["delivered"])));
    await db
      .update(approval)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(and(inArray(approval.deliveryId, deliveryIds), eq(approval.status, "pending")));
  }
  // Teams that asked these requests for help go on without the answer.
  const waiting = await db
    .update(handoff)
    .set({ status: "declined", resolvedAt: new Date() })
    .where(
      and(
        inArray(handoff.helperRequestId, requestIds),
        inArray(handoff.status, ["open", "in_progress"]),
      ),
    )
    .returning({ origin: handoff.originRequestId });
  return waiting.flatMap((h) => (h.origin ? [{ requestId: h.origin }] : []));
}

async function audit(
  db: DbOrTx,
  input: { workspaceId: string; userId: string; action: string; target: string },
) {
  await db.insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorType: "user",
    actorId: input.userId,
    action: input.action,
    target: input.target,
  });
}

/** "Cancel": the team stops; the delivery stays on record as cancelled. */
export async function cancelDelivery(
  db: DbOrTx,
  input: { workspaceId: string; deliveryId: string; userId: string },
): Promise<{ followUps: RunInput[] }> {
  const d = await loadDelivery(db, input.workspaceId, input.deliveryId);
  if (d.status === "delivered" || d.status === "cancelled") throw new WorkError("delivery_closed");
  const [ws] = await db
    .select({ settings: schema.workspace.settings })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, input.workspaceId));
  const words = wordsFor(workspaceLocale(ws?.settings ?? {}));

  const followUps = await db.transaction(async (tx) => {
    const resume = await stopRequests(tx, [d.requestId]);
    const [teamRoom] = await tx.select({ id: room.id }).from(room).where(eq(room.teamId, d.teamId));
    if (teamRoom) {
      await tx.insert(message).values({
        roomId: teamRoom.id,
        kind: "system",
        authorUserId: input.userId,
        requestId: d.requestId,
        body: words.room.cancelled(d.title),
      });
    }
    await audit(tx, { ...input, action: "delivery.cancelled", target: d.id });
    return resume;
  });
  await notify(db, {
    type: "delivery",
    workspaceId: input.workspaceId,
    teamId: d.teamId,
    deliveryId: d.id,
  });
  return { followUps };
}

/** "Delete": the request, its delivery, versions, runs and its room thread are gone. */
export async function deleteDelivery(
  db: DbOrTx,
  input: { workspaceId: string; deliveryId: string; userId: string },
): Promise<{ followUps: RunInput[] }> {
  const d = await loadDelivery(db, input.workspaceId, input.deliveryId);
  const followUps = await db.transaction(async (tx) => {
    const resume = await stopRequests(tx, [d.requestId]);
    await tx.delete(message).where(eq(message.requestId, d.requestId));
    await detachLedger(tx, { requestIds: [d.requestId] });
    // Cascades to the delivery, its versions and notes, runs, steps and approvals.
    await tx.delete(request).where(eq(request.id, d.requestId));
    await audit(tx, { ...input, action: "delivery.deleted", target: d.id });
    return resume;
  });
  await notify(db, { type: "request", workspaceId: input.workspaceId, teamId: d.teamId });
  return { followUps };
}

/**
 * "Remove team": the team, its agents, room and all its work. Its department
 * goes too when nothing else is in it. The catalog template is untouched, so
 * the team can be hired again.
 */
export async function deleteTeam(
  db: DbOrTx,
  input: { workspaceId: string; teamId: string; userId: string },
): Promise<{ followUps: RunInput[]; name: string }> {
  const [t] = await db
    .select({ id: team.id, name: team.name, departmentId: team.departmentId })
    .from(team)
    .where(and(eq(team.id, input.teamId), eq(team.workspaceId, input.workspaceId)));
  if (!t) throw new WorkError("team_not_found");

  const followUps = await db.transaction(async (tx) => {
    const requestIds = (
      await tx.select({ id: request.id }).from(request).where(eq(request.teamId, t.id))
    ).map((r) => r.id);
    const resume = await stopRequests(tx, requestIds);
    // Other teams' requests this team was asked to help with also end.
    const asked = await tx
      .update(handoff)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(and(eq(handoff.toTeamId, t.id), inArray(handoff.status, ["open", "in_progress"])))
      .returning({ origin: handoff.originRequestId });
    const agentIds = (
      await tx.select({ id: agent.id }).from(agent).where(eq(agent.teamId, t.id))
    ).map((a) => a.id);
    await detachLedger(tx, { requestIds, agentIds });
    // The work first (requests take their runs and steps with them), then the
    // team: one cascade at a time, so no row is reached by two at once.
    if (requestIds.length > 0) await tx.delete(request).where(inArray(request.id, requestIds));
    await tx.delete(team).where(eq(team.id, t.id));
    const [left] = await tx
      .select({ id: team.id })
      .from(team)
      .where(eq(team.departmentId, t.departmentId))
      .limit(1);
    if (!left) await tx.delete(department).where(eq(department.id, t.departmentId));
    await audit(tx, { ...input, action: "team.removed", target: t.id });
    const origins = asked.flatMap((h) => (h.origin ? [{ requestId: h.origin }] : []));
    // Only resume requests that still exist (not this team's own).
    return [...resume, ...origins].filter((f) => !requestIds.includes(f.requestId));
  });
  await notify(db, { type: "request", workspaceId: input.workspaceId });
  return { followUps, name: t.name };
}
