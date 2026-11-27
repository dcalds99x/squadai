import Anthropic from "@anthropic-ai/sdk";
import { type ChatModel, type ChatRequest, type ModelOutput, ModelRefusalError } from "./types.ts";

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

const STYLE_GUIDE: Record<ChatRequest["style"], string> = {
  precise: "Seja preciso e factual. Prefira frases curtas e verificáveis.",
  balanced: "Equilibre clareza e naturalidade.",
  creative: "Pode ser criativo no estilo e nas imagens, mas nunca invente fatos.",
};

/**
 * Claude through the official Anthropic SDK. Current models take no sampling
 * parameters, so the agent's style goes into the system prompt and depth is
 * set with `effort`.
 */
export function createAnthropicModel(
  model: string,
  options: { apiKey: string; baseUrl?: string | null },
): ChatModel {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseUrl ?? undefined,
    maxRetries: 2,
  });

  return {
    provider: "anthropic",
    model,
    async generate(request: ChatRequest): Promise<ModelOutput> {
      const withFallback = FALLBACK_MODELS.has(model);
      const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: request.maxOutputTokens ?? 16000,
        system: `${request.system}\n\n${STYLE_GUIDE[request.style]}`,
        messages: [
          { role: "user", content: request.prompt },
          ...(request.continuation ?? []).map((t) => ({ role: t.role, content: t.content })),
        ],
        output_config: { effort: request.effort },
        ...(withFallback
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      };
      let response: Awaited<ReturnType<typeof client.beta.messages.create>>;
      if (request.onDelta) {
        // Stream when someone is watching; the final message is the same.
        const stream = client.beta.messages.stream(params);
        stream.on("text", (delta) => request.onDelta?.(delta));
        response = await stream.finalMessage();
      } else {
        response = await client.beta.messages.create(params);
      }

      if (response.stop_reason === "refusal") {
        throw new ModelRefusalError(
          response.stop_details?.explanation ?? "The model declined this request.",
        );
      }

      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n")
        .trim();
      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}

export async function listAnthropicModels(options: {
  apiKey: string;
  baseUrl?: string | null;
}): Promise<string[]> {
  const client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl ?? undefined });
  const ids: string[] = [];
  for await (const model of client.models.list({ limit: 50 })) {
    ids.push(model.id);
    if (ids.length >= 50) break;
  }
  return ids;
}

/**
 * Web search through Claude's server-side web search tool. Used as the
 * `web_search` tool for every agent, whatever model the agent itself runs on.
 */
export async function anthropicWebSearch(options: {
  apiKey: string;
  query: string;
  baseUrl?: string | null;
}): Promise<{
  text: string;
  sources: { title: string; url: string }[];
  inputTokens: number;
  outputTokens: number;
}> {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseUrl ?? undefined,
    maxRetries: 2,
  });
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Pesquise na web: ${options.query}\n\nResponda em português do Brasil com até 8 tópicos curtos. Em cada tópico, cite a fonte (título e URL).`,
    },
  ];
  const sources = new Map<string, string>();
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  // Server tools can pause a long turn; continue it a couple of times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages,
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) sources.set(r.url, r.title);
      }
    }
    if (response.stop_reason === "refusal") throw new ModelRefusalError();
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  return {
    text: text.trim(),
    sources: [...sources].slice(0, 10).map(([url, title]) => ({ url, title })),
    inputTokens,
    outputTokens,
  };
}
