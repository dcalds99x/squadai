/**
 * Built-in tools: web search, GitHub and asking another team for help.
 */
import type { Locale } from "@squadai/core";
import { anthropicWebSearch, costMicros } from "@squadai/providers";
import { requestHandoff } from "../handoffs.ts";
import type { ModelContext } from "../models.ts";
import { wordsFor } from "../words.ts";
import { str, type ToolDef } from "./types.ts";

/**
 * Names of the built-in tools. Stored in policies, so they are never translated;
 * migration 0003 renamed the one early builds called `pedir_ajuda`.
 */
export const BUILTIN_TOOLS = [
  "web_search",
  "github_read",
  "github_comment",
  "request_help",
  "github_merge",
  "ask_teammate",
] as const;
export type BuiltinTool = (typeof BUILTIN_TOOLS)[number];

const GITHUB_API = "https://api.github.com";

function githubToken(models: ModelContext): string | null {
  return models.integrations.find((i) => i.kind === "github")?.secret ?? null;
}

async function github(
  path: string,
  token: string | null,
  status: (code: number) => string,
  init: RequestInit = {},
) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "squadai",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(status(res.status));
  return res.json();
}

function parseRepo(input: Record<string, unknown>): { repo: string; pr: number } | null {
  const repo = str(input.repo, 200).trim();
  const pr = Number(input.pr);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isInteger(pr) || pr <= 0) return null;
  return { repo, pr };
}

/**
 * Tool names and input keys are protocol tokens, the same in every language.
 * Inputs also accept the Portuguese keys early builds used (`consulta`,
 * `pergunta`, `time`, `comentario`), so paused runs resume after the rename.
 * Labels, descriptions and results are in `locale`: the workspace's when the
 * engine offers them to an agent.
 */
export function builtinTools(
  models: ModelContext,
  otherTeams: { slug: string; name: string }[],
  locale: Locale,
): ToolDef[] {
  const token = githubToken(models);
  const canSearch = models.demoMode || models.anthropic !== null;
  const w = wordsFor(locale).tools;

  return [
    {
      name: "web_search" satisfies BuiltinTool,
      label: w.webSearch.label,
      description: w.webSearch.description,
      example: { query: w.webSearch.example },
      available: canSearch,
      defaultPolicy: "allow",
      async run(input, ctx) {
        const query = str(input.query ?? input.consulta, 300).trim();
        if (!query) return { kind: "result", text: w.webSearch.missingQuery };
        if (ctx.models.demoMode || !ctx.models.anthropic) {
          return { kind: "result", text: w.webSearch.demoResults(query) };
        }
        const found = await anthropicWebSearch({ ...ctx.models.anthropic, query });
        const sources = found.sources.map((s) => `- ${s.title} — ${s.url}`).join("\n");
        return {
          kind: "result",
          text: `${found.text}\n\n${w.webSearch.sources}:\n${sources}`.slice(0, 8000),
          costMicros: costMicros("anthropic", "claude-sonnet-5-5", found),
        };
      },
    },
    {
      name: "github_read" satisfies BuiltinTool,
      label: w.githubRead.label,
      description: w.githubRead.description,
      example: { repo: "owner/repository", pr: 42 },
      available: true,
      defaultPolicy: "allow",
      async run(input) {
        const target = parseRepo(input);
        if (!target) return { kind: "result", text: w.githubRead.missingTarget };
        try {
          const pr = (await github(
            `/repos/${target.repo}/pulls/${target.pr}`,
            token,
            w.githubRead.githubStatus,
          )) as {
            title: string;
            body: string | null;
            user: { login: string };
            additions: number;
            deletions: number;
          };
          const files = (await github(
            `/repos/${target.repo}/pulls/${target.pr}/files?per_page=40`,
            token,
            w.githubRead.githubStatus,
          )) as {
            filename: string;
            status: string;
            patch?: string;
          }[];
          let budget = 12_000;
          const parts = files.map((f) => {
            const patch = (f.patch ?? w.githubRead.noDiff).slice(0, Math.max(0, budget));
            budget -= patch.length;
            return `### ${f.filename} (${f.status})\n${patch}`;
          });
          return {
            kind: "result",
            text: `PR #${target.pr}: ${pr.title}\n${w.githubRead.author}: ${pr.user.login} · +${pr.additions} −${pr.deletions}\n\n${(pr.body ?? "").slice(0, 2000)}\n\n${parts.join("\n\n")}`,
          };
        } catch (error) {
          if (models.demoMode) {
            return {
              kind: "result",
              text: w.githubRead.demo(target.pr, target.repo),
            };
          }
          return {
            kind: "result",
            text: w.githubRead.failed(String(error)),
          };
        }
      },
    },
    {
      name: "github_comment" satisfies BuiltinTool,
      label: w.githubComment.label,
      description: w.githubComment.description,
      example: { repo: "owner/repository", pr: 42, comment: w.githubComment.example },
      available: token !== null || models.demoMode,
      defaultPolicy: "ask",
      async run(input) {
        const target = parseRepo(input);
        const body = str(input.comment ?? input.body ?? input.comentario, 6000).trim();
        if (!target || !body) return { kind: "result", text: w.githubComment.missingInput };
        if (!token) return { kind: "result", text: w.githubComment.simulated };
        const created = (await github(
          `/repos/${target.repo}/issues/${target.pr}/comments`,
          token,
          w.githubRead.githubStatus,
          {
            method: "POST",
            body: JSON.stringify({ body }),
          },
        )) as { html_url: string };
        return { kind: "result", text: w.githubComment.posted(created.html_url) };
      },
    },
    {
      name: "request_help" satisfies BuiltinTool,
      label: w.askForHelp.label,
      description: w.askForHelp.description(
        otherTeams.map((t) => `${t.slug} (${t.name})`).join(", "),
      ),
      example: {
        team: otherTeams[0]?.slug ?? w.askForHelp.exampleTeam,
        question: w.askForHelp.example,
      },
      available: otherTeams.length > 0,
      defaultPolicy: "allow",
      async run(input, ctx) {
        const target = str(input.team ?? input.time, 100).trim();
        const ask = str(input.question ?? input.pergunta, 1500).trim();
        if (!target || !ask) return { kind: "result", text: w.askForHelp.missingInput };
        const handoff = await requestHandoff(ctx.db, {
          workspaceId: ctx.workspaceId,
          fromTeamId: ctx.teamId,
          fromTeamName: ctx.teamName,
          agentId: ctx.agentId,
          agentName: ctx.agentName,
          originRequestId: ctx.requestId,
          toTeam: target,
          ask,
          locale,
        });
        if (!handoff) return { kind: "result", text: w.askForHelp.unknownTeam(target) };
        return {
          kind: "wait_handoff",
          handoffId: handoff.handoffId,
          helperRequestId: handoff.helperRequestId,
        };
      },
    },
    {
      name: "github_merge" satisfies BuiltinTool,
      label: w.githubMerge.label,
      description: w.githubMerge.description,
      example: {},
      available: false,
      defaultPolicy: "deny",
      async run() {
        return { kind: "result", text: w.githubMerge.never };
      },
    },
  ];
}
