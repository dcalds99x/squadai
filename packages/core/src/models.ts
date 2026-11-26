import type { ModelTier } from "./domain.ts";
import { isLocale, LEGACY_WORKSPACE_LOCALE, type Locale } from "./locale.ts";

/** A model reference in the form "provider:model-id". */
export type ModelRef = `${string}:${string}`;

export interface TierModels {
  primary: ModelRef;
  fallback: ModelRef | null;
}

/**
 * Defaults used when a team is hired. Each workspace can override them on the
 * "Models & costs" page, and each agent can override its own.
 */
export const DEFAULT_TIER_MODELS: Record<ModelTier, TierModels> = {
  economy: { primary: "anthropic:claude-haiku-5-5", fallback: null },
  balanced: { primary: "anthropic:claude-sonnet-5-5", fallback: "anthropic:claude-haiku-5-5" },
  max: { primary: "anthropic:claude-opus-5-5", fallback: "anthropic:claude-sonnet-5-5" },
};

/** Per-workspace preferences, stored as JSON on the workspace. */
export interface WorkspaceSettings {
  /** Every agent answers with the built-in demo model. No API key, no cost. */
  demoMode?: boolean;
  /** Overrides DEFAULT_TIER_MODELS for this workspace. */
  tierModels?: Partial<Record<ModelTier, TierModels>>;
  /**
   * The language agents work in: room lines, prompts, demo text and the content
   * of teams hired from now on. Set from the person who created the workspace.
   * Workspaces created before it existed have none, so they read as pt-BR.
   */
  locale?: Locale;
}

/** The workspace's working language, with a safe default for older or invalid settings. */
export function workspaceLocale(settings: WorkspaceSettings | null | undefined): Locale {
  return isLocale(settings?.locale) ? settings.locale : LEGACY_WORKSPACE_LOCALE;
}

export function tierModelsFor(settings: WorkspaceSettings, tier: ModelTier): TierModels {
  return settings.tierModels?.[tier] ?? DEFAULT_TIER_MODELS[tier];
}

/** Picks the model an agent uses: its own override, else its tier's model. */
export function resolveAgentModels(
  agent: { tier: ModelTier; model: string | null; fallbackModel: string | null },
  settings: WorkspaceSettings,
): TierModels {
  const tier = tierModelsFor(settings, agent.tier);
  return {
    primary: (agent.model as ModelRef | null) ?? tier.primary,
    fallback: (agent.fallbackModel as ModelRef | null) ?? tier.fallback,
  };
}

export function parseModelRef(ref: string): { provider: string; model: string } {
  const index = ref.indexOf(":");
  if (index <= 0 || index === ref.length - 1) {
    throw new Error(`Invalid model reference "${ref}". Expected "provider:model".`);
  }
  return { provider: ref.slice(0, index), model: ref.slice(index + 1) };
}
