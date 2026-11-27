/**
 * The AI judge: grades a delivery against the case's rubric, 1 to 5. Only runs
 * with a real model (EVAL_JUDGE_MODEL, default Claude Sonnet), never in demo
 * mode, where the text is templated and a grade would mean nothing.
 */
import type { ModelRef } from "@squadai/core";
import { generateWithFallback, type ModelFactory } from "@squadai/providers";

export interface Verdict {
  score: number;
  reason: string;
}

export const PASSING_SCORE = 3;

export async function judge(
  input: { prompt: string; rubric: string; text: string },
  model: ModelRef,
  factory: ModelFactory,
): Promise<Verdict> {
  const result = await generateWithFallback(
    { primary: model, fallback: null },
    {
      system:
        "You grade work delivered by an AI team against a rubric. Be strict and fair. Reply ONLY with JSON.",
      prompt: [
        `Request:\n${input.prompt}`,
        `Rubric:\n${input.rubric}`,
        `Delivery:\n${input.text.slice(0, 12_000)}`,
        'Reply {"score": 1-5, "reason": "one sentence"}. 5 = fully meets the rubric, 3 = usable with edits, 1 = misses the point.',
      ].join("\n\n"),
      style: "precise",
      effort: "low",
      maxOutputTokens: 300,
    },
    factory,
  );
  const json = result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as { score?: unknown; reason?: unknown };
  const score = Math.max(1, Math.min(5, Math.round(Number(parsed.score))));
  if (!Number.isFinite(score)) throw new Error(`The judge gave no score: ${result.text}`);
  return { score, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
}
