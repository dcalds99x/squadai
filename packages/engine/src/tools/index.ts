import type { Locale, ToolPolicy } from "@squadai/core";
import type { ToolSpec } from "@squadai/providers";
import type { ModelContext } from "../models.ts";
import { builtinTools } from "./builtin.ts";
import { mcpTools } from "./mcp.ts";
import { teammateTool } from "./teammate.ts";
import type { ToolDef } from "./types.ts";

export { BUILTIN_TOOLS, type BuiltinTool } from "./builtin.ts";
export * from "./mcp.ts";
export { ASK_TEAMMATE } from "./teammate.ts";
export * from "./types.ts";

/**
 * Every tool the workspace has, built-in and from integrations, described in
 * `locale`: the workspace locale for agents, the person's for the interface.
 */
export function workspaceTools(
  models: ModelContext,
  otherTeams: { slug: string; name: string }[],
  locale: Locale,
  /** The agent's teammates, during a run. Left out when listing tools on a profile. */
  teammates?: { key: string; name: string }[],
): ToolDef[] {
  return [
    ...builtinTools(models, otherTeams, locale),
    teammateTool(teammates, locale),
    ...mcpTools(models.integrations, locale),
  ];
}

export interface OfferedTool {
  def: ToolDef;
  policy: ToolPolicy;
}

/**
 * The tools an agent may use: available ones whose policy is "allow" or "ask".
 * "deny" tools are never shown to the model.
 */
export function toolsForAgent(
  all: ToolDef[],
  policies: Map<string, ToolPolicy>,
): Map<string, OfferedTool> {
  const offered = new Map<string, OfferedTool>();
  for (const def of all) {
    const policy = policies.get(def.name) ?? def.defaultPolicy;
    if (def.available && policy !== "deny") offered.set(def.name, { def, policy });
  }
  return offered;
}

export function toSpecs(offered: Map<string, OfferedTool>): ToolSpec[] {
  return [...offered.values()].map(({ def, policy }) => ({
    name: def.name,
    description: def.description,
    example: def.example,
    needsApproval: policy === "ask",
  }));
}
