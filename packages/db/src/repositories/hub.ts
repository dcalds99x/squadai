/**
 * Read models for the Home hub: small, glanceable numbers and the things
 * that need attention. Nothing here should take more than a second to read.
 */
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { DbOrTx } from "../client.ts";
import {
  agent,
  approval,
  delivery,
  handoff,
  message,
  providerCredential,
  request,
  room,
  run,
  team,
  workspace,
} from "../schema/index.ts";

/** Deliveries approved per day, for the last 7 days (oldest first). */
export async function getWeekSeries(db: DbOrTx, workspaceId: string, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${delivery.deliveredAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(delivery)
    .innerJoin(team, eq(team.id, delivery.teamId))
    .where(
      and(
        eq(team.workspaceId, workspaceId),
        isNotNull(delivery.deliveredAt),
        gte(delivery.deliveredAt, start),
      ),
    )
    .groupBy(sql`1`);
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    return { day: key, count: byDay.get(key) ?? 0 };
  });
}

/** Per-team numbers for the team list. */
export async function getTeamStats(db: DbOrTx, workspaceId: string, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const rows = await db
    .select({
      teamId: delivery.teamId,
      delivered: sql<number>`count(*) filter (where ${delivery.status} = 'delivered' and ${delivery.deliveredAt} >= ${weekAgo}::timestamptz)::int`,
      firstPass: sql<number>`count(*) filter (where ${delivery.status} = 'delivered' and ${delivery.deliveredAt} >= ${weekAgo}::timestamptz and ${delivery.adjustmentCount} = 0)::int`,
      inProgress: sql<number>`count(*) filter (where ${delivery.status} = 'in_progress')::int`,
      waiting: sql<number>`count(*) filter (where ${delivery.status} = 'awaiting_approval')::int`,
    })
    .from(delivery)
    .innerJoin(team, eq(team.id, delivery.teamId))
    .where(eq(team.workspaceId, workspaceId))
    .groupBy(delivery.teamId);
  return new Map(rows.map((r) => [r.teamId, r]));
}

/** Everything that deserves a person's attention right now. */
export async function getAttention(db: DbOrTx, workspaceId: string) {
  const [approvals, failed, handoffs, providers, ws] = await Promise.all([
    db
      .select({ kind: approval.kind, createdAt: approval.createdAt })
      .from(approval)
      .where(and(eq(approval.workspaceId, workspaceId), eq(approval.status, "pending"))),
    db
      .select({
        requestId: request.id,
        teamSlug: team.slug,
        teamName: team.name,
        error: sql<
          string | null
        >`(select ${run.error} from ${run} where ${run.requestId} = ${request.id} order by ${run.createdAt} desc limit 1)`,
      })
      .from(request)
      .innerJoin(team, eq(team.id, request.teamId))
      .where(and(eq(request.workspaceId, workspaceId), eq(request.status, "failed")))
      .orderBy(desc(request.createdAt))
      .limit(5),
    db
      .select({
        id: handoff.id,
        fromTeamId: handoff.fromTeamId,
        toTeamId: handoff.toTeamId,
        ask: handoff.ask,
      })
      .from(handoff)
      .where(
        and(eq(handoff.workspaceId, workspaceId), inArray(handoff.status, ["open", "in_progress"])),
      ),
    db
      .select({ id: providerCredential.id })
      .from(providerCredential)
      .where(eq(providerCredential.workspaceId, workspaceId)),
    db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, workspaceId)),
  ]);
  const teamNames = new Map(
    (
      await db
        .select({ id: team.id, name: team.name })
        .from(team)
        .where(eq(team.workspaceId, workspaceId))
    ).map((t) => [t.id, t.name]),
  );
  const deliveries = approvals.filter((a) => a.kind === "delivery");
  return {
    deliveryApprovals: deliveries.length,
    oldestApproval: deliveries.reduce<Date | null>(
      (min, a) => (!min || a.createdAt < min ? a.createdAt : min),
      null,
    ),
    toolApprovals: approvals.filter((a) => a.kind === "tool").length,
    failed,
    handoffs: handoffs.map((h) => ({
      id: h.id,
      from: teamNames.get(h.fromTeamId) ?? "",
      to: teamNames.get(h.toTeamId) ?? "",
      ask: h.ask,
    })),
    noModels: providers.length === 0 && ws[0]?.settings.demoMode !== true,
    demoMode: ws[0]?.settings.demoMode === true,
  };
}

/** The latest things agents said, across all rooms. */
export async function getRecentActivity(db: DbOrTx, workspaceId: string, limit = 6) {
  return db
    .select({
      id: message.id,
      kind: message.kind,
      body: message.body,
      createdAt: message.createdAt,
      payload: message.payload,
      agentId: agent.id,
      agentName: agent.name,
      avatar: agent.avatar,
      teamName: team.name,
      teamSlug: team.slug,
    })
    .from(message)
    .innerJoin(room, eq(room.id, message.roomId))
    .innerJoin(team, eq(team.id, room.teamId))
    .innerJoin(agent, eq(agent.id, message.authorAgentId))
    .where(
      and(
        eq(team.workspaceId, workspaceId),
        inArray(message.kind, ["chat", "delivery", "handoff"]),
      ),
    )
    .orderBy(desc(message.createdAt))
    .limit(limit);
}
