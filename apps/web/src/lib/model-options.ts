import { PROVIDERS, type Provider } from "@squadai/core";
import type { ModelOption } from "@/components/model-picker";

/** Brand names stay as they are; what each provider offers is translated. */
export const PROVIDER_BRANDS: Record<
  Provider,
  { name: string | null; initial: string; bg: string }
> = {
  anthropic: { name: "Anthropic", initial: "A", bg: "#F3E7DA" },
  openai: { name: "OpenAI", initial: "O", bg: "#DCF5E8" },
  google: { name: "Google", initial: "G", bg: "#DCEBFF" },
  openrouter: { name: "OpenRouter", initial: "R", bg: "#FDE2EF" },
  ollama: { name: "Ollama", initial: "L", bg: "#EEF0F6" },
  "openai-compatible": { name: null, initial: "+", bg: "#F4F5FA" },
};

/**
 * Every provider, in the order of the provider cards, for the model pickers.
 * Pickers list the connected ones, plus a saved choice whose provider isn't.
 */
export function modelOptions(
  credentials: { provider: string; models: string[] }[],
  otherProviderName: string,
): ModelOption[] {
  return PROVIDERS.map((p) => {
    const cred = credentials.find((c) => c.provider === p);
    return {
      provider: p,
      label: PROVIDER_BRANDS[p].name ?? otherProviderName,
      models: cred?.models ?? [],
      connected: Boolean(cred),
    };
  });
}
