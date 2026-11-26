/**
 * List prices in US dollars per million tokens. Multiplying by a token count
 * gives micro-dollars directly, which is how llm_call.cost_micros is stored.
 *
 * Models missing here are recorded with cost 0 and still count tokens.
 * Source: Anthropic pricing, November 2026.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "anthropic:claude-opus-5-5": { input: 4, output: 20 },
  "anthropic:claude-sonnet-5-5": { input: 2, output: 10 },
  "anthropic:claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "demo:squadai-demo": { input: 0, output: 0 },
};

export function priceOf(provider: string, model: string) {
  return PRICES[`${provider}:${model}`] ?? null;
}

export function costMicros(
  provider: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const price = priceOf(provider, model);
  if (!price) return 0;
  return Math.round(price.input * usage.inputTokens + price.output * usage.outputTokens);
}
