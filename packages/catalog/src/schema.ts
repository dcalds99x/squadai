import {
  AGENT_STYLES,
  DEFAULT_LOCALE,
  LOCALES,
  MODEL_TIERS,
  PLAYBOOK_MODES,
  TOOL_POLICIES,
} from "@squadai/core";
import { z } from "zod";

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase letters, numbers and hyphens");

export const AgentTemplateSchema = z.object({
  key: slug,
  name: z.string().min(1),
  role: z.string().min(1),
  /** First-person bio shown on the agent profile. */
  bio: z.string().min(1),
  skills: z.array(z.string().min(1)).min(1),
  /** "Likes to get": what helps this agent do good work. */
  prefers: z.string().min(1),
  /** "Never does": the agent's hard limits. */
  never: z.string().min(1),
  tier: z.enum(MODEL_TIERS),
  style: z.enum(AGENT_STYLES).default("balanced"),
  /** Tool name → "allow" | "ask" | "deny". Tools not listed are denied. */
  tools: z.record(z.string(), z.enum(TOOL_POLICIES)).default({}),
  instructions: z.string().min(1),
});

export const PlaybookStepSchema = z.object({
  agent: slug,
  task: z.string().min(1),
});

/**
 * How `mode` reads the steps:
 * - sequential: each step gets the previous step's output.
 * - coordinator: the first step's agent plans and delegates to the others.
 * - parallel: all steps but the last run at the same time; the last one combines them.
 */
export const PlaybookSchema = z.object({
  key: slug,
  name: z.string().min(1),
  description: z.string().min(1),
  mode: z.enum(PLAYBOOK_MODES),
  /** How long a person would take by hand. Feeds the "Time saved" metric. */
  estimatedHumanMinutes: z.number().int().positive(),
  /** Ask the person to approve before the delivery is final. */
  approval: z.boolean().default(true),
  steps: z.array(PlaybookStepSchema).min(1),
});

/**
 * A team in another language. Only the words change: keys, tools, tiers and
 * steps come from the template itself. A translation must be complete (every
 * agent, every playbook, one task per step), so a hired team never mixes languages.
 */
export const AgentTranslationSchema = z.object({
  role: z.string().min(1),
  bio: z.string().min(1),
  skills: z.array(z.string().min(1)).min(1),
  prefers: z.string().min(1),
  never: z.string().min(1),
  instructions: z.string().min(1),
});

export const PlaybookTranslationSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  /** One per step, in the same order. */
  tasks: z.array(z.string().min(1)).min(1),
});

export const TeamTranslationSchema = z.object({
  department: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  /** Agent key → its words. */
  agents: z.record(slug, AgentTranslationSchema),
  /** Playbook key → its words. */
  playbooks: z.record(slug, PlaybookTranslationSchema),
});

export const TeamTemplateSchema = z
  .object({
    id: slug,
    version: z.number().int().positive(),
    /** The language the template itself is written in. */
    locale: z.enum(LOCALES).default(DEFAULT_LOCALE),
    department: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    agents: z.array(AgentTemplateSchema).min(1),
    playbooks: z.array(PlaybookSchema).min(1),
    /** Optional versions in other languages, picked by the workspace locale on hire. */
    translations: z.partialRecord(z.enum(LOCALES), TeamTranslationSchema).default({}),
  })
  .superRefine((team, ctx) => {
    const keys = team.agents.map((a) => a.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["agents"], message: "agent keys must be unique" });
    }
    const playbookKeys = team.playbooks.map((p) => p.key);
    if (new Set(playbookKeys).size !== playbookKeys.length) {
      ctx.addIssue({
        code: "custom",
        path: ["playbooks"],
        message: "playbook keys must be unique",
      });
    }
    team.playbooks.forEach((playbook, p) => {
      playbook.steps.forEach((step, s) => {
        if (!keys.includes(step.agent)) {
          ctx.addIssue({
            code: "custom",
            path: ["playbooks", p, "steps", s, "agent"],
            message: `unknown agent "${step.agent}"`,
          });
        }
      });
      if (playbook.mode !== "sequential" && playbook.steps.length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["playbooks", p, "steps"],
          message: `${playbook.mode} playbooks need at least 2 steps`,
        });
      }
    });
    for (const [locale, translation] of Object.entries(team.translations)) {
      if (!translation) continue;
      const path = ["translations", locale];
      if (locale === team.locale) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `the template is already written in ${locale}`,
        });
      }
      const sameKeys = (label: string, expected: string[], actual: string[]) => {
        const missing = expected.filter((k) => !actual.includes(k));
        const unknown = actual.filter((k) => !expected.includes(k));
        if (missing.length > 0)
          ctx.addIssue({
            code: "custom",
            path: [...path, label],
            message: `missing ${missing.join(", ")}`,
          });
        if (unknown.length > 0)
          ctx.addIssue({
            code: "custom",
            path: [...path, label],
            message: `unknown ${unknown.join(", ")}`,
          });
      };
      sameKeys("agents", keys, Object.keys(translation.agents));
      sameKeys("playbooks", playbookKeys, Object.keys(translation.playbooks));
      for (const playbook of team.playbooks) {
        const tasks = translation.playbooks[playbook.key]?.tasks;
        if (tasks && tasks.length !== playbook.steps.length) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "playbooks", playbook.key, "tasks"],
            message: `needs ${playbook.steps.length} tasks, one per step`,
          });
        }
      }
    }
  });

export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;
export type Playbook = z.infer<typeof PlaybookSchema>;
export type TeamTemplate = z.infer<typeof TeamTemplateSchema>;
export type TeamTranslation = z.infer<typeof TeamTranslationSchema>;
