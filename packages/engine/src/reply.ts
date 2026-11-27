/**
 * When someone writes in the room, the agent they @mention (or the team lead)
 * answers in character, knowing where the team's work stands.
 */
import { createLogger, type Logger, resolveAgentModels, workspaceLocale } from "@squadai/core";
import { type DbOrTx, schema } from "@squadai/db";
import { friendlyError, generateWithFallback } from "@squadai/providers";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { notify } from "./events.ts";
import type { ModelContext } from "./models.ts";
import { scopeInstructions } from "./scope.ts";
import { wordsFor } from "./words.ts";

const { agent, delivery, deliveryVersion, llmCall, message, request, room, run, team, user } =
  schema;

const STATUS: Record<string, string> = {
  in_progress: "the team is working on it",
  awaiting_approval: "ready for the person to review and approve",
  delivered: "approved and delivered",
  cancelled: "closed without a delivery",
};

/**
 * What the team has on its plate, so an agent can answer "what's done so far?"
 * truthfully. Written for the model; it answers in the workspace language.
 */
async function workStatus(db: DbOrTx, teamId: string): Promise<string> {
  const rows = await db
    .select({
      id: delivery.id,
      title: delivery.title,
      kind: delivery.kind,
      status: delivery.status,
      requestStatus: request.status,
      error: sql<
        string | null
      >`(select ${run.error} from ${run} where ${run.requestId} = ${request.id} order by ${run.createdAt} desc limit 1)`,
    })
    .from(delivery)
    .innerJoin(request, eq(request.id, delivery.requestId))
    .where(eq(delivery.teamId, teamId))
    .orderBy(desc(delivery.createdAt))
    .limit(5);
  const lines: string[] = [];
  for (const row of rows) {
    const [latest] = await db
      .select({ n: deliveryVersion.number, content: deliveryVersion.content })
      .from(deliveryVersion)
      .where(eq(deliveryVersion.deliveryId, row.id))
      .orderBy(desc(deliveryVersion.number))
      .limit(1);
    const state =
      row.requestStatus === "failed"
        ? `stuck: ${row.error ?? "an error"}`
        : row.requestStatus === "waiting" && row.status === "in_progress"
          ? "paused, waiting for the person's OK in Waiting on you"
          : (STATUS[row.status] ?? row.status);
    lines.push(
      `- "${row.title}" (${row.kind}): ${state}; ${latest ? `${latest.n} version(s)` : "no version yet"}.`,
    );
    if (latest && rows.indexOf(row) === 0)
      lines.push(`  Latest version starts: ${latest.content.replace(/\s+/g, " ").slice(0, 500)}`);
  }
  return lines.join("\n");
}

export async function replyInRoom(
  deps: { db: DbOrTx; loadModels: (workspaceId: string) => Promise<ModelContext>; log?: Logger },
  input: { messageId: string; agentId: string },
): Promise<void> {
  const { db } = deps;
  const log = deps.log ?? createLogger({ service: "engine" });

  const [who] = await db
    .select({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      instructions: agent.instructions,
      tier: agent.tier,
      model: agent.model,
      fallbackModel: agent.fallbackModel,
      style: agent.style,
      teamId: agent.teamId,
      workspaceId: agent.workspaceId,
      teamName: team.name,
      scope: team.scope,
    })
    .from(agent)
    .innerJoin(team, eq(team.id, agent.teamId))
    .where(eq(agent.id, input.agentId));
  const [teamRoom] = who
    ? await db.select({ id: room.id }).from(room).where(eq(room.teamId, who.teamId))
    : [];
  if (!who || !teamRoom) return;

  const { settings, factory } = await deps.loadModels(who.workspaceId);
  const locale = workspaceLocale(settings);
  const words = wordsFor(locale);
  const otherTeams = await db
    .select({ name: team.name })
    .from(team)
    .where(and(eq(team.workspaceId, who.workspaceId), ne(team.id, who.teamId)));

  const recent = await db
    .select({ body: message.body, agentName: agent.name, userName: user.name })
    .from(message)
    .leftJoin(agent, eq(agent.id, message.authorAgentId))
    .leftJoin(user, eq(user.id, message.authorUserId))
    .where(eq(message.roomId, teamRoom.id))
    .orderBy(desc(message.createdAt))
    .limit(12);
  const transcript = recent
    .reverse()
    .map((m) => `${m.agentName ?? m.userName ?? words.fallbackName.system}: ${m.body}`)
    .join("\n");

  let body: string;
  try {
    const result = await generateWithFallback(
      resolveAgentModels(who, settings),
      {
        system: [
          who.instructions,
          words.prompt.chatSystem(who.name, who.role, who.teamName),
          scopeInstructions(words, who.scope, otherTeams),
        ].join("\n\n"),
        prompt: words.prompt.chat(transcript, await workStatus(db, who.teamId)),
        style: who.style,
        effort: "low",
        maxOutputTokens: 1500,
        hint: { agentName: who.name, kind: "chat", topic: "", locale },
      },
      factory,
    );
    await db.insert(llmCall).values({
      workspaceId: who.workspaceId,
      agentId: who.id,
      provider: result.provider,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costMicros: result.costMicros,
      latencyMs: result.latencyMs,
      usedFallback: result.usedFallback,
    });
    body = result.text;
  } catch (error) {
    log.warn("reply failed", { agentId: who.id, error: String(error) });
    body = words.room.replyFailed(friendlyError(error, locale));
  }

  await db
    .insert(message)
    .values({ roomId: teamRoom.id, kind: "chat", authorAgentId: who.id, body });
  await notify(db, { type: "room", workspaceId: who.workspaceId, teamId: who.teamId });
}
