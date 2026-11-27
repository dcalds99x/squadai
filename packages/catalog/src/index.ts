import { TEAM_TEMPLATES } from "./generated.ts";
import type { TeamTemplate } from "./schema.ts";

export { translateCatalogText } from "./display.ts";
export { localizeTemplate } from "./localize.ts";
export * from "./schema.ts";
export { TEAM_TEMPLATES };

/** The team every new office starts with. */
export const STARTER_TEAM_ID = "content-seo";

export function getTeamTemplate(id: string): TeamTemplate {
  const template = TEAM_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Unknown team template "${id}".`);
  return template;
}

/** Every team in the catalog, in display order. */
export function listTeamTemplates(): TeamTemplate[] {
  return [...TEAM_TEMPLATES];
}
