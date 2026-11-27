/**
 * Keeps each team on its own kind of work. Before a request runs, checkScope
 * decides whether it fits the team; when it doesn't, it names the teams (and
 * the agent there) that fit better. A keyword score always runs (free and
 * explainable, and all demo mode uses). With a real model connected, a cheap
 * model has the last word, since keywords miss paraphrases.
 */
import { resolveAgentModels, workspaceLocale } from "@squadai/core";
import { type DbOrTx, schema, type TeamScope } from "@squadai/db";
import { generateWithFallback } from "@squadai/providers";
import { asc, eq } from "drizzle-orm";
import type { ModelContext } from "./models.ts";
import { scoreText } from "./router.ts";
import { type Words, wordsFor } from "./words.ts";

export interface ScopeAlternative {
  teamId: string;
  teamName: string;
  teamSlug: string;
  /** The agent on that team whose skills fit best, when one stands out. */
  agentName: string | null;
}

export interface ScopeVerdict {
  fit: "in" | "out";
  /** One sentence on why, when the model gave one. */
  reason: string;
  alternatives: ScopeAlternative[];
}

const STEM = 6;

interface TeamProfile {
  id: string;
  slug: string;
  name: string;
  description: string;
  scope: TeamScope | null;
  corpus: string;
  agents: { name: string; corpus: string }[];
}

async function loadProfiles(db: DbOrTx, workspaceId: string): Promise<TeamProfile[]> {
  const { agent, playbook, team } = schema;
  const [teams, playbooks, agents] = await Promise.all([
    db
      .select({
        id: team.id,
        slug: team.slug,
        name: team.name,
        description: team.description,
        scope: team.scope,
      })
      .from(team)
      .where(eq(team.workspaceId, workspaceId))
      .orderBy(asc(team.createdAt)),
    db
      .select({ teamId: playbook.teamId, name: playbook.name, description: playbook.description })
      .from(playbook)
      .innerJoin(team, eq(team.id, playbook.teamId))
      .where(eq(team.workspaceId, workspaceId)),
    db
      .select({ teamId: agent.teamId, name: agent.name, role: agent.role, skills: agent.skills })
      .from(agent)
      .where(eq(agent.workspaceId, workspaceId))
      .orderBy(asc(agent.position)),
  ]);
  return teams.map((t) => {
    const mine = agents.filter((a) => a.teamId === t.id);
    return {
      ...t,
      corpus: [
        t.name,
        t.description,
        ...(t.scope?.does ?? []),
        ...playbooks.filter((p) => p.teamId === t.id).flatMap((p) => [p.name, p.description]),
        ...mine.flatMap((a) => [a.role, ...a.skills]),
      ].join(" "),
      agents: mine.map((a) => ({ name: a.name, corpus: `${a.role} ${a.skills.join(" ")}` })),
    };
  });
}

function bestAgent(prompt: string, profile: TeamProfile): string | null {
  const ranked = profile.agents
    .map((a) => ({ name: a.name, score: scoreText(prompt, a.corpus, STEM).score }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score > 0 ? ranked[0].name : null;
}

const toAlternative = (prompt: string, p: TeamProfile): ScopeAlternative => ({
  teamId: p.id,
  teamName: p.name,
  teamSlug: p.slug,
  agentName: bestAgent(prompt, p),
});

/** The scope lines agents read in their system prompt. */
export function scopeInstructions(
  words: Words,
  scope: TeamScope | null,
  otherTeams: { name: string }[],
): string {
  return words.scopePrompt.system(
    (scope?.does ?? []).join("; "),
    (scope?.doesNot ?? []).join("; "),
    otherTeams.map((t) => t.name).join(", "),
  );
}

export async function checkScope(
  db: DbOrTx,
  input: { workspaceId: string; teamId: string; prompt: string },
  models?: ModelContext,
): Promise<ScopeVerdict> {
  const profiles = await loadProfiles(db, input.workspaceId);
  const target = profiles.find((p) => p.id === input.teamId);
  if (!target) return { fit: "in", reason: "", alternatives: [] };
  const others = profiles.filter((p) => p.id !== target.id);

  // Stricter stems than the router: here a false match lets off-topic work through.
  const own = scoreText(input.prompt, target.corpus, STEM).score;
  const against = target.scope?.doesNot.length
    ? scoreText(input.prompt, target.scope.doesNot.join(" "), STEM).score
    : 0;
  const ranked = others
    .map((p) => ({ p, score: scoreText(input.prompt, p.corpus, STEM).score }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  const bestOther = ranked[0]?.score ?? 0;
  const alternatives = ranked.slice(0, 2).map((r) => toAlternative(input.prompt, r.p));
  let verdict: ScopeVerdict = {
    // Out when the "doesn't do" list fits better, or nothing of ours fits and another team's does.
    fit: against > own || (own === 0 && bestOther >= 2) ? "out" : "in",
    reason: "",
    alternatives,
  };

  if (models && !models.demoMode) {
    try {
      const words = wordsFor(workspaceLocale(models.settings)).scopePrompt;
      const result = await generateWithFallback(
        resolveAgentModels({ tier: "economy", model: null, fallbackModel: null }, models.settings),
        {
          system: words.classifierSystem,
          prompt: words.classifier(
            input.prompt,
            `${target.name}. ${target.description}`,
            words.scopeLines(
              (target.scope?.does ?? []).join("; "),
              (target.scope?.doesNot ?? []).join("; "),
            ),
            others.map((o) => words.teamLine(o.slug, o.name, o.description)).join("\n"),
          ),
          style: "precise",
          effort: "low",
          maxOutputTokens: 200,
          hint: { agentName: "router", kind: "scope", topic: input.prompt },
        },
        models.factory,
      );
      const json = result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json) as { fit?: unknown; reason?: unknown; better?: unknown };
      if (parsed.fit === "in" || parsed.fit === "out") {
        const better = others.find((o) => o.slug === parsed.better);
        verdict = {
          fit: parsed.fit,
          reason: typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 240) : "",
          alternatives: better
            ? [
                toAlternative(input.prompt, better),
                ...alternatives.filter((a) => a.teamId !== better.id),
              ].slice(0, 2)
            : alternatives,
        };
      }
    } catch {
      // The keyword verdict stands.
    }
  }
  return verdict;
}

/** "That's outside what X does: … Who can help: the Y team (Ana)." */
export function describeOutOfScope(words: Words, teamName: string, verdict: ScopeVerdict): string {
  const who = verdict.alternatives
    .map((a) =>
      a.agentName
        ? words.flow.teamWithAgent(a.teamName, a.agentName)
        : words.flow.teamOnly(a.teamName),
    )
    .join(", ");
  return [words.flow.outOfScope(teamName, verdict.reason), who ? words.flow.tryInstead(who) : ""]
    .filter(Boolean)
    .join(" ");
}
