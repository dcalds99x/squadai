import type { Locale } from "@squadai/core";
import type { TeamTemplate } from "./schema.ts";

/**
 * The template in a language: its own words when it is written in that
 * language or has no translation for it, else the translation. Names, keys,
 * tools and steps never change, so a team is the same team in every language.
 */
export function localizeTemplate(template: TeamTemplate, locale: Locale): TeamTemplate {
  const words = template.translations[locale];
  if (template.locale === locale || !words) return template;
  return {
    ...template,
    locale,
    department: words.department,
    name: words.name,
    description: words.description,
    scope: words.scope ?? template.scope,
    agents: template.agents.map((agent) => {
      const w = words.agents[agent.key];
      return w ? { ...agent, ...w } : agent;
    }),
    playbooks: template.playbooks.map((playbook) => {
      const w = words.playbooks[playbook.key];
      if (!w) return playbook;
      return {
        ...playbook,
        name: w.name,
        description: w.description,
        steps: playbook.steps.map((step, i) => ({ ...step, task: w.tasks[i] ?? step.task })),
      };
    }),
  };
}
