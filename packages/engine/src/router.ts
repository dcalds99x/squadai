/**
 * "New request" without choosing a team: suggest who should do it.
 * A keyword score always runs (fast, free, explainable). When a real model is
 * connected, a cheap model re-ranks the top candidates.
 */
import { resolveAgentModels, workspaceLocale } from "@squadai/core";
import { type DbOrTx, schema } from "@squadai/db";
import { generateWithFallback } from "@squadai/providers";
import { asc, eq } from "drizzle-orm";
import type { ModelContext } from "./models.ts";
import { wordsFor } from "./words.ts";

export interface RouteOption {
  teamId: string;
  teamName: string;
  teamSlug: string;
  playbookId: string;
  playbookName: string;
  description: string;
  score: number;
  /** Words that matched, to explain the suggestion. */
  matched: string[];
}

/** Words that say nothing about the kind of work, in every language people may write in. */
const STOP = new Set([
  "para",
  "sobre",
  "como",
  "mais",
  "menos",
  "preciso",
  "quero",
  "fazer",
  "favor",
  "isso",
  "esse",
  "essa",
  "uma",
  "umas",
  "uns",
  "com",
  "sem",
  "que",
  "dos",
  "das",
  "nos",
  "nas",
  "meu",
  "minha",
  "nosso",
  "nossa",
  "the",
  "and",
  "for",
  "about",
  "with",
  "without",
  "need",
  "want",
  "please",
  "make",
  "this",
  "that",
  "our",
  "your",
  "can",
  "you",
  // Short function words, which match almost any text.
  "in",
  "on",
  "of",
  "to",
  "at",
  "by",
  "as",
  "an",
  "or",
  "is",
  "it",
  "my",
  "we",
  "us",
  "em",
  "de",
  "do",
  "da",
  "no",
  "na",
  "ao",
  "os",
  "as",
  "um",
  "se",
  "eu",
]);

/** Words people use that point to a kind of work, mapped to words in playbooks. */
const SYNONYMS: Record<string, string[]> = {
  post: ["artigo", "blog", "conteudo"],
  texto: ["artigo", "conteudo"],
  materia: ["artigo"],
  email: ["newsletter"],
  pr: ["pull", "request", "revisar", "codigo"],
  pull: ["revisar", "codigo"],
  bug: ["codigo", "testes"],
  codigo: ["revisar", "codigo"],
  concorrente: ["concorrentes"],
  concorrencia: ["concorrentes"],
  preco: ["mercado", "precos", "concorrentes"],
  precos: ["mercado", "concorrentes"],
  mercado: ["mercado", "pesquisa"],
  dados: ["pesquisa", "mercado"],
  // English requests, matched against English or Portuguese playbooks.
  article: ["artigo", "blog", "post"],
  blog: ["blog", "post", "artigo"],
  newsletter: ["newsletter"],
  code: ["code", "review", "codigo"],
  review: ["review", "revisar"],
  tests: ["testes", "test"],
  competitor: ["competitor", "concorrentes"],
  competitors: ["competitor", "concorrentes"],
  price: ["market", "pricing", "precos", "mercado"],
  prices: ["market", "pricing", "precos", "mercado"],
  pricing: ["market", "precos", "mercado"],
  market: ["market", "mercado", "research", "pesquisa"],
  data: ["research", "market", "pesquisa"],
  research: ["research", "pesquisa"],
};

export function normalize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/**
 * How well a prompt matches a text: 2 per word found, 1 per synonym. Words
 * also match on their first `stem` letters ("articles" ~ "article"); a longer
 * stem is stricter ("checkout" stops matching "checking" at 6).
 */
export function scoreText(
  prompt: string,
  corpus: string,
  stem = 5,
): { score: number; matched: string[] } {
  const words = new Set(normalize(corpus));
  const stems = [...words].map((w) => w.slice(0, stem));
  const matched = new Set<string>();
  let score = 0;
  for (const w of normalize(prompt)) {
    const candidates = [w, ...(SYNONYMS[w] ?? [])];
    for (const c of candidates) {
      if (words.has(c) || (c.length >= stem && stems.includes(c.slice(0, stem)))) {
        score += c === w ? 2 : 1;
        matched.add(w);
        break;
      }
    }
  }
  return { score, matched: [...matched] };
}

export async function suggestRoutes(
  db: DbOrTx,
  workspaceId: string,
  prompt: string,
  models?: ModelContext,
): Promise<RouteOption[]> {
  const rows = await db
    .select({
      teamId: schema.team.id,
      teamName: schema.team.name,
      teamSlug: schema.team.slug,
      teamDescription: schema.team.description,
      playbookId: schema.playbook.id,
      playbookName: schema.playbook.name,
      description: schema.playbook.description,
    })
    .from(schema.playbook)
    .innerJoin(schema.team, eq(schema.team.id, schema.playbook.teamId))
    .where(eq(schema.team.workspaceId, workspaceId))
    .orderBy(asc(schema.team.createdAt), asc(schema.playbook.position));

  let ranked = rows
    .map((r) => {
      const { score, matched } = scoreText(
        prompt,
        `${r.playbookName} ${r.playbookName} ${r.description} ${r.teamName} ${r.teamDescription}`,
      );
      return { ...r, score, matched };
    })
    .sort((a, b) => b.score - a.score);

  // Re-rank with a cheap model when one is available and the choice is not obvious.
  const top = ranked.slice(0, 5);
  if (
    models &&
    !models.demoMode &&
    top.length > 1 &&
    (top[0]?.score ?? 0) - (top[1]?.score ?? 0) < 3
  ) {
    try {
      const words = wordsFor(workspaceLocale(models.settings)).prompt;
      const result = await generateWithFallback(
        resolveAgentModels({ tier: "economy", model: null, fallbackModel: null }, models.settings),
        {
          system: words.routerSystem,
          prompt: words.router(
            prompt,
            top
              .map((o, i) => words.routerOption(i + 1, o.playbookName, o.teamName, o.description))
              .join("\n"),
          ),
          style: "precise",
          effort: "low",
          maxOutputTokens: 200,
        },
        models.factory,
      );
      const pick = Number(/\d+/.exec(result.text)?.[0]) - 1;
      const chosen = top[pick];
      if (chosen) ranked = [chosen, ...ranked.filter((o) => o !== chosen)];
    } catch {
      // The keyword ranking is a fine answer on its own.
    }
  }

  return ranked.slice(0, 3).map(({ teamDescription: _, ...o }) => o);
}
