/**
 * Teams helping teams. An agent asks another team for something; that team
 * gets a normal request (visible on its board and in its room), and the asking
 * step waits. When the helper's delivery is done, the asking run resumes with
 * the answer.
 */
import { type Locale, workspaceLocale } from "@squadai/core";
import { type DbOrTx, schema } from "@squadai/db";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { notify } from "./events.ts";
import { wordsFor } from "./words.ts";

const { delivery, handoff, message, playbook, request, room, team, workspace } = schema;

async function roomId(db: DbOrTx, teamId: string) {
  const [r] = await db.select({ id: room.id }).from(room).where(eq(room.teamId, teamId));
  return r?.id ?? null;
}

export async function requestHandoff(
  db: DbOrTx,
  input: {
    workspaceId: string;
    fromTeamId: string;
    fromTeamName: string;
    agentId: string;
    agentName: string;
    originRequestId: string;
    toTeam: string;
    ask: string;
    /** The workspace locale: both teams are in the same office. */
    locale: Locale;
  },
): Promise<{ handoffId: string; helperRequestId: string } | null> {
  const words = wordsFor(input.locale);
  const wanted = input.toTeam.toLowerCase();
  const [target] = await db
    .select({ id: team.id, name: team.name })
    .from(team)
    .where(
      and(
        eq(team.workspaceId, input.workspaceId),
        ne(team.id, input.fromTeamId),
        or(eq(team.slug, wanted), sql`lower(${team.name}) = ${wanted}`),
      ),
    )
    .limit(1);
  if (!target) return null;

  // Prefer a playbook that does not need a person's approval: the asking team is waiting.
  const [pb] = await db
    .select()
    .from(playbook)
    .where(eq(playbook.teamId, target.id))
    .orderBy(asc(playbook.requiresApproval), asc(playbook.position))
    .limit(1);
  if (!pb) return null;

  const result = await db.transaction(async (tx) => {
    const [req] = await tx
      .insert(request)
      .values({
        workspaceId: input.workspaceId,
        teamId: target.id,
        playbookId: pb.id,
        prompt: words.prompt.helperRequest(input.ask, input.agentName, input.fromTeamName),
      })
      .returning({ id: request.id });
    if (!req) throw new Error("Could not create helper request.");
    await tx.insert(delivery).values({
      requestId: req.id,
      teamId: target.id,
      title: input.ask.length > 80 ? `${input.ask.slice(0, 77)}…` : input.ask,
      kind: pb.name,
      estimatedHumanMinutes: pb.estimatedHumanMinutes,
    });
    const [h] = await tx
      .insert(handoff)
      .values({
        workspaceId: input.workspaceId,
        fromTeamId: input.fromTeamId,
        toTeamId: target.id,
        requestedByAgentId: input.agentId,
        ask: input.ask,
        status: "in_progress",
        originRequestId: input.originRequestId,
        helperRequestId: req.id,
      })
      .returning({ id: handoff.id });
    if (!h) throw new Error("Could not create handoff.");

    const helperRoom = await roomId(tx, target.id);
    const originRoom = await roomId(tx, input.fromTeamId);
    if (helperRoom) {
      await tx.insert(message).values({
        roomId: helperRoom,
        kind: "handoff",
        requestId: req.id,
        authorAgentId: input.agentId,
        body: words.room.handoffIncoming(input.fromTeamName, input.ask),
        payload: { handoffId: h.id, direction: "incoming", fromTeam: input.fromTeamName },
      });
    }
    if (originRoom) {
      await tx.insert(message).values({
        roomId: originRoom,
        kind: "handoff",
        requestId: input.originRequestId,
        authorAgentId: input.agentId,
        body: words.room.handoffOutgoing(target.name, input.ask),
        payload: { handoffId: h.id, direction: "outgoing", toTeam: target.name },
      });
    }
    return { handoffId: h.id, helperRequestId: req.id };
  });

  await notify(db, { type: "room", workspaceId: input.workspaceId, teamId: target.id });
  await notify(db, { type: "room", workspaceId: input.workspaceId, teamId: input.fromTeamId });
  return result;
}

/**
 * Called when a request is delivered. If it was helping another team, closes
 * the handoff and returns the runs to resume.
 */
export async function resolveHandoffsFor(
  db: DbOrTx,
  helperRequestId: string,
  answer: string,
): Promise<{ requestId: string }[]> {
  const open = await db
    .select({
      id: handoff.id,
      workspaceId: handoff.workspaceId,
      fromTeamId: handoff.fromTeamId,
      toTeamName: team.name,
      originRequestId: handoff.originRequestId,
      settings: workspace.settings,
    })
    .from(handoff)
    .innerJoin(team, eq(team.id, handoff.toTeamId))
    .innerJoin(workspace, eq(workspace.id, handoff.workspaceId))
    .where(
      and(
        eq(handoff.helperRequestId, helperRequestId),
        inArray(handoff.status, ["open", "in_progress"]),
      ),
    );

  const resumes: { requestId: string }[] = [];
  for (const h of open) {
    await db
      .update(handoff)
      .set({ status: "done", result: answer.slice(0, 20_000), resolvedAt: new Date() })
      .where(eq(handoff.id, h.id));
    const originRoom = await roomId(db, h.fromTeamId);
    if (originRoom) {
      await db.insert(message).values({
        roomId: originRoom,
        kind: "handoff",
        requestId: h.originRequestId,
        body: wordsFor(workspaceLocale(h.settings)).room.handoffAnswered(h.toTeamName),
        payload: { handoffId: h.id, direction: "answered" },
      });
    }
    await notify(db, { type: "room", workspaceId: h.workspaceId, teamId: h.fromTeamId });
    if (h.originRequestId) resumes.push({ requestId: h.originRequestId });
  }
  return resumes;
}

/** The final text of a request's delivery, used as the handoff answer. */
export async function latestDeliveryText(db: DbOrTx, requestId: string): Promise<string> {
  const rows = await db
    .select({ content: schema.deliveryVersion.content })
    .from(schema.deliveryVersion)
    .innerJoin(delivery, eq(delivery.id, schema.deliveryVersion.deliveryId))
    .where(eq(delivery.requestId, requestId))
    .orderBy(sql`${schema.deliveryVersion.number} desc`)
    .limit(1);
  return rows[0]?.content ?? "";
}
