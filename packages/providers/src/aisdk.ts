/**
 * Non-Anthropic providers through the Vercel AI SDK: OpenAI, Google, and any
 * OpenAI-compatible API (OpenRouter, Ollama, LM Studio, vLLM…).
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";
import type { ChatModel, ChatRequest, ModelOutput, ProviderCredentials } from "./types.ts";

export const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
};

const TEMPERATURE: Record<ChatRequest["style"], number> = {
  precise: 0.2,
  balanced: 0.7,
  creative: 1,
};

function languageModel(model: string, credentials: ProviderCredentials): LanguageModel {
  const apiKey = credentials.apiKey ?? undefined;
  switch (credentials.provider) {
    case "openai":
      return createOpenAI({ apiKey, baseURL: credentials.baseUrl ?? undefined })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model);
    case "openrouter":
    case "ollama":
    case "openai-compatible": {
      const baseURL = credentials.baseUrl ?? DEFAULT_BASE_URLS[credentials.provider];
      if (!baseURL) throw new Error(`${credentials.provider} needs a base URL.`);
      return createOpenAICompatible({ name: credentials.provider, baseURL, apiKey })(model);
    }
    default:
      throw new Error(`Provider "${credentials.provider}" is not handled by the AI SDK adapter.`);
  }
}

export function createAiSdkModel(model: string, credentials: ProviderCredentials): ChatModel {
  const lm = languageModel(model, credentials);
  return {
    provider: credentials.provider,
    model,
    async generate(request: ChatRequest): Promise<ModelOutput> {
      const result = await generateText({
        model: lm,
        system: request.system,
        messages: [
          { role: "user" as const, content: request.prompt },
          ...(request.continuation ?? []).map((t) => ({ role: t.role, content: t.content })),
        ],
        temperature: TEMPERATURE[request.style],
        maxOutputTokens: request.maxOutputTokens ?? 8000,
      });
      return {
        text: result.text.trim(),
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      };
    },
  };
}
