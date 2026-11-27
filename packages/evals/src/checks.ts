/**
 * Rule checks: cheap, deterministic, and run on every CI build, even without
 * an API key. They catch broken flows; the AI judge (judge.ts) grades quality.
 */
import type { EvalCase } from "./cases.ts";

export interface Observed {
  /** What the scope check decided, and the first team it suggested. */
  scope: "in" | "out";
  suggested: string | null;
  /** Filled only when the request ran. */
  outcome?: string;
  text?: string;
  reviewNotes?: number;
  checkpoints?: number;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function runChecks(c: EvalCase, seen: Observed): CheckResult[] {
  const e = c.expect;
  const out: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail: string) => out.push({ name, pass, detail });

  check("scope", seen.scope === e.scope, `expected ${e.scope}, got ${seen.scope}`);
  if (e.scope === "out") {
    if (e.suggests)
      check(
        "suggests",
        seen.suggested === e.suggests,
        `expected ${e.suggests}, got ${seen.suggested ?? "none"}`,
      );
    return out;
  }
  if (seen.scope === "out") return out;

  const text = seen.text ?? "";
  if (e.outcome) check("outcome", seen.outcome === e.outcome, `got ${seen.outcome ?? "none"}`);
  for (const phrase of e.mention) {
    check(
      `mentions "${phrase}"`,
      text.toLowerCase().includes(phrase.toLowerCase()),
      text ? "" : "no delivery text",
    );
  }
  if (e.minWords !== undefined)
    check(`at least ${e.minWords} words`, words(text) >= e.minWords, `${words(text)} words`);
  if (e.headings) check("uses headings", /^#{1,3} \S/m.test(text), "");
  if (e.reviewNotes)
    check("review notes", (seen.reviewNotes ?? 0) > 0, `${seen.reviewNotes ?? 0} notes`);
  if (e.checkpoints !== undefined)
    check(
      `${e.checkpoints} checkpoint(s)`,
      seen.checkpoints === e.checkpoints,
      `got ${seen.checkpoints ?? 0}`,
    );
  return out;
}
