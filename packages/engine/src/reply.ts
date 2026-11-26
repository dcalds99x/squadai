/**
 * When someone @mentions an agent in the room, the agent answers in character.
 */
import { createLogger, type Logger, resolveAgentModels, workspaceLocale } from "@squadai/core";
import { type DbOrTx, schema } from "@squadai/db";
import { friendlyError, generateWithFallback } from "@squadai/providers";
import { desc, eq } from "drizzle-orm";
import { notify } from "./events.ts";
import type { ModelContext } from "./models.ts";
import { wordsFor } from "./words.ts";

const { agent, llmCall, message, room, team, user } = schema;

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
        system: `${who.instructions}\n\n${words.prompt.chatSystem(who.name, who.role, who.teamName)}`,
        prompt: words.prompt.chat(transcript),
        style: who.style,
        effort: "low",
        maxOutputTokens: 1000,
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
