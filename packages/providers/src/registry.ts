import { type Locale, type ModelRef, type Provider, parseModelRef } from "@squadai/core";
import { createAiSdkModel, DEFAULT_BASE_URLS } from "./aisdk.ts";
import { createAnthropicModel, listAnthropicModels } from "./anthropic.ts";
import { createDemoModel } from "./demo.ts";
import { costMicros } from "./pricing.ts";
import {
  BudgetExceededError,
  type ChatModel,
  type ChatRequest,
  type ChatResult,
  type ModelFactory,
  ModelRefusalError,
  type ProviderCredentials,
  ProviderNotConnectedError,
} from "./types.ts";

/** Providers that work without an API key. */
const KEYLESS = new Set<Provider>(["ollama", "openai-compatible"]);

export function createModelFactory(options: {
  credentials: ProviderCredentials[];
  demoMode: boolean;
  demoDelayMs?: number;
}): ModelFactory {
  const byProvider = new Map(options.credentials.map((c) => [c.provider, c]));
  const demo = createDemoModel({ delayMs: options.demoDelayMs });

  return (ref: ModelRef): ChatModel => {
    if (options.demoMode) return demo;
    const { provider, model } = parseModelRef(ref);
    const credentials = byProvider.get(provider as Provider);
    if (!credentials || (!credentials.apiKey && !KEYLESS.has(credentials.provider))) {
      throw new ProviderNotConnectedError(provider);
    }
    if (provider === "anthropic") {
      return createAnthropicModel(model, {
        apiKey: credentials.apiKey as string,
        baseUrl: credentials.baseUrl,
      });
    }
    return createAiSdkModel(model, credentials);
  };
}

/**
 * Calls the primary model and, if it fails (provider down, not connected,
 * rate limited, refusal), tries the fallback once. Measures cost and latency.
 */
export async function generateWithFallback(
  models: { primary: ModelRef; fallback: ModelRef | null },
  request: ChatRequest,
  factory: ModelFactory,
): Promise<ChatResult> {
  const attempt = async (ref: ModelRef, usedFallback: boolean): Promise<ChatResult> => {
    const model = factory(ref);
    const started = performance.now();
    const output = await model.generate(request);
    return {
      ...output,
      provider: model.provider,
      model: model.model,
      costMicros: costMicros(model.provider, model.model, output),
      latencyMs: Math.round(performance.now() - started),
      usedFallback,
    };
  };

  try {
    return await attempt(models.primary, false);
  } catch (error) {
    if (!models.fallback || models.fallback === models.primary) throw error;
    try {
      return await attempt(models.fallback, true);
    } catch {
      throw error;
    }
  }
}

export interface ConnectionCheck {
  ok: boolean;
  models: string[];
  error?: string;
}

/** What a person reads when a provider call fails, in their language. */
const PT_BR = {
  missingKey: "Falta a chave de API.",
  googleStatus: (status: number) => `O Google respondeu ${status}.`,
  missingBaseUrl: "Informe a URL base.",
  providerStatus: (status: number) => `O provedor respondeu ${status}.`,
  notConnected: (provider: string) =>
    `O provedor ${provider} não está conectado. Conecte em Modelos e custos.`,
  refused: "O modelo recusou esse pedido. Tente reformular.",
  budget: "O orçamento do mês acabou. Aumente o limite em Modelos e custos para continuar.",
  badKey: "A chave de API foi recusada. Confira em Modelos e custos.",
  rateLimited: "O provedor está no limite de uso. Tente de novo em alguns minutos.",
  unreachable: "Não consegui falar com o provedor. Ele está no ar?",
  unknown: "Algo deu errado ao falar com o modelo.",
};

const ERRORS: Record<Locale, typeof PT_BR> = {
  "pt-BR": PT_BR,
  en: {
    missingKey: "The API key is missing.",
    googleStatus: (status: number) => `Google responded with ${status}.`,
    missingBaseUrl: "Enter the base URL.",
    providerStatus: (status: number) => `The provider responded with ${status}.`,
    notConnected: (provider: string) =>
      `The ${provider} provider isn't connected. Connect it in Models & costs.`,
    refused: "The model declined this request. Try rephrasing it.",
    budget: "This month's budget is used up. Raise the limit in Models & costs to continue.",
    badKey: "The API key was rejected. Check it in Models & costs.",
    rateLimited: "The provider is rate limiting us. Try again in a few minutes.",
    unreachable: "Couldn't reach the provider. Is it up?",
    unknown: "Something went wrong while talking to the model.",
  },
};

/** Validates credentials by listing models. Costs nothing and spends no tokens. */
export async function checkConnection(
  credentials: ProviderCredentials,
  locale: Locale,
): Promise<ConnectionCheck> {
  const words = ERRORS[locale];
  try {
    if (credentials.provider === "anthropic") {
      if (!credentials.apiKey) return { ok: false, models: [], error: words.missingKey };
      return {
        ok: true,
        models: await listAnthropicModels({
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
        }),
      };
    }
    if (credentials.provider === "google") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(credentials.apiKey ?? "")}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { ok: false, models: [], error: words.googleStatus(res.status) };
      const body = (await res.json()) as { models?: { name: string }[] };
      return {
        ok: true,
        models: (body.models ?? []).map((m) => m.name.replace(/^models\//, "")).slice(0, 50),
      };
    }
    const baseUrl = credentials.baseUrl ?? DEFAULT_BASE_URLS[credentials.provider];
    if (!baseUrl) return { ok: false, models: [], error: words.missingBaseUrl };
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, models: [], error: words.providerStatus(res.status) };
    const body = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, models: (body.data ?? []).map((m) => m.id).slice(0, 50) };
  } catch (error) {
    return { ok: false, models: [], error: friendlyError(error, locale) };
  }
}

/** Turns provider errors into something a person can act on, in their language. */
export function friendlyError(error: unknown, locale: Locale): string {
  const words = ERRORS[locale];
  if (error instanceof ProviderNotConnectedError) return words.notConnected(error.provider);
  if (error instanceof ModelRefusalError) return words.refused;
  if (error instanceof BudgetExceededError) return words.budget;
  const message = error instanceof Error ? error.message : String(error);
  if (/401|authentication|invalid.*key|unauthorized/i.test(message)) return words.badKey;
  if (/429|rate.?limit/i.test(message)) return words.rateLimited;
  if (/ECONNREFUSED|fetch failed|timeout|ENOTFOUND/i.test(message)) return words.unreachable;
  return words.unknown;
}
