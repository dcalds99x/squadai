/**
 * `ask_teammate`: a quick question to someone on the same team, answered on the
 * spot. Both the question and the answer show up in the room, so people see
 * the team talking, not just a funnel of steps.
 */
import { type Locale, resolveAgentModels, workspaceLocale } from "@squadai/core";
import { schema } from "@squadai/db";
import { friendlyError, generateWithFallback } from "@squadai/providers";
import { and, eq, ne } from "drizzle-orm";
import { notify } from "../events.ts";
import { wordsFor } from "../words.ts";
import type { BuiltinTool } from "./builtin.ts";
import { str, type ToolDef } from "./types.ts";

export const ASK_TEAMMATE = "ask_teammate" satisfies BuiltinTool;

export function teammateTool(
  /** The asker's teammates. Undefined when listing tools outside a run (always available). */
  teammates: { key: string; name: string }[] | undefined,
  locale: Locale,
): ToolDef {
  const w = wordsFor(locale).tools.askTeammate;
  return {
    name: ASK_TEAMMATE,
    label: w.label,
    description: w.description((teammates ?? []).map((t) => `${t.key} (${t.name})`).join(", ")),
    example: { teammate: teammates?.[0]?.key ?? "key", question: w.example },
    available: teammates === undefined || teammates.length > 0,
    defaultPolicy: "allow",
    async run(input, ctx) {
      const wanted = str(input.teammate ?? input.colega, 100)
        .trim()
        .toLowerCase();
      const question = str(input.question ?? input.pergunta, 1500).trim();
      if (!wanted || !question) return { kind: "result", text: w.missingInput };
      const { agent, llmCall, message, request, room } = schema;

      const candidates = await ctx.db
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
        .where(and(eq(agent.teamId, ctx.teamId), ne(agent.id, ctx.agentId)));
      const who = candidates.find((a) => a.key === wanted || a.name.toLowerCase() === wanted);
      if (!who) return { kind: "result", text: w.unknownTeammate(wanted) };

      const [teamRoom] = await ctx.db
        .select({ id: room.id })
        .from(room)
        .where(eq(room.teamId, ctx.teamId));
      const [req] = await ctx.db
        .select({ prompt: request.prompt })
        .from(request)
        .where(eq(request.id, ctx.requestId));
      const workLocale = workspaceLocale(ctx.models.settings);
      const words = wordsFor(workLocale);
      const post = async (authorAgentId: string, body: string) => {
        if (!teamRoom) return;
        await ctx.db.insert(message).values({
          roomId: teamRoom.id,
          kind: "chat",
          authorAgentId,
          requestId: ctx.requestId,
          body,
        });
        await notify(ctx.db, { type: "room", workspaceId: ctx.workspaceId, teamId: ctx.teamId });
      };

      await post(ctx.agentId, words.flow.askTeammate(who.name, question));
      try {
        const result = await generateWithFallback(
          resolveAgentModels(who, ctx.models.settings),
          {
            system: `${who.instructions}\n\n${words.flowPrompt.teammateSystem(who.name, who.role, ctx.teamName)}`,
            prompt: words.flowPrompt.teammateQuestion(ctx.agentName, question, req?.prompt ?? ""),
            style: who.style,
            effort: "low",
            maxOutputTokens: 600,
            hint: {
              agentName: who.name,
              kind: "discussion",
              topic: req?.prompt ?? question,
              locale: workLocale,
            },
          },
          ctx.models.factory,
        );
        await ctx.db.insert(llmCall).values({
          workspaceId: ctx.workspaceId,
          agentId: who.id,
          provider: result.provider,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costMicros: result.costMicros,
          latencyMs: result.latencyMs,
          usedFallback: result.usedFallback,
        });
        await post(who.id, result.text);
        return { kind: "result", text: `${who.name}: ${result.text}` };
      } catch (error) {
        ctx.log.warn("teammate answer failed", { teammate: who.key, error: String(error) });
        return { kind: "result", text: w.failed(friendlyError(error, workLocale)) };
      }
    },
  };
}
