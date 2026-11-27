/**
 * Eval cases: reference requests per team, in `cases/<team>.yaml`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const ExpectSchema = z.object({
  /** "out": the team must refuse it and point to `suggests`. Default "in". */
  scope: z.enum(["in", "out"]).default("in"),
  /** Template id of the team a refused request should be sent to. */
  suggests: z.string().optional(),
  /** How the run ends, after any checkpoints are confirmed. */
  outcome: z.enum(["awaiting_approval", "delivered"]).optional(),
  /** Phrases the delivery must contain (case-insensitive). */
  mention: z.array(z.string()).default([]),
  minWords: z.number().int().positive().optional(),
  /** The delivery uses Markdown headings. */
  headings: z.boolean().optional(),
  /** The reviewer left margin notes. */
  reviewNotes: z.boolean().optional(),
  /** How many checkpoints the team stopped at. */
  checkpoints: z.number().int().nonnegative().optional(),
});

export const CaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  prompt: z.string().min(5),
  /** Playbook key. Left out, the team decides how to work. */
  playbook: z.string().optional(),
  expect: ExpectSchema,
  /** What a good answer looks like, for the AI judge. */
  rubric: z.string().optional(),
});

export const SuiteSchema = z.object({
  team: z.string(),
  cases: z.array(CaseSchema).min(1),
});

export type EvalCase = z.infer<typeof CaseSchema>;
export type Suite = z.infer<typeof SuiteSchema>;

export function loadSuites(dir: string, only?: string): Suite[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => SuiteSchema.parse(parse(readFileSync(join(dir, f), "utf8"))))
    .filter((s) => !only || s.team === only);
}
