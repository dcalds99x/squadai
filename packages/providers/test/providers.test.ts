import { describe, expect, it } from "vitest";
import {
  type ChatModel,
  type ChatRequest,
  chatModels,
  costMicros,
  createDemoModel,
  createModelFactory,
  friendlyError,
  generateWithFallback,
  ProviderNotConnectedError,
  parseToolCall,
  REVIEW_NOTES_MARKER,
  subjectOf,
  toolInstructions,
} from "../src/index.ts";

const request: ChatRequest = {
  system: "Você é a Bia.",
  prompt: "Texto para revisar:\n# Energia solar: o guia direto ao ponto\nDepende do seu caso.",
  style: "precise",
  effort: "low",
  hint: { agentName: "Bia", kind: "review", topic: "energia solar" },
};

describe("pricing", () => {
  it("charges per million tokens, in micro-dollars", () => {
    // 1,000 in × $2/M + 500 out × $10/M = $0.007 = 7,000 micros
    expect(
      costMicros("anthropic", "claude-sonnet-5-5", { inputTokens: 1000, outputTokens: 500 }),
    ).toBe(7000);
  });

  it("records unknown models as free rather than guessing", () => {
    expect(costMicros("openai", "some-model", { inputTokens: 1000, outputTokens: 1000 })).toBe(0);
  });
});

describe("demo model", () => {
  it("finds the subject of a request", () => {
    expect(subjectOf("Preciso de um artigo sobre energia solar residencial.")).toBe(
      "energia solar residencial",
    );
    expect(subjectOf("Uma newsletter curta sobre o mês de novembro")).toBe("o mês de novembro");
    expect(subjectOf("I need a blog post about home solar panels.")).toBe("home solar panels");
    expect(subjectOf("A short newsletter about November")).toBe("november");
  });

  it("writes in the workspace language", async () => {
    const model = createDemoModel();
    const draft = (locale: "pt-BR" | "en") =>
      model.generate({
        ...request,
        prompt: "",
        hint: { agentName: "Téo", kind: "draft", topic: "solar energy", locale },
      });
    expect((await draft("en")).text).toContain("the no-nonsense guide");
    expect((await draft("pt-BR")).text).toContain("o guia direto ao ponto");
  });

  it("reviews the text it is given and notes each change", async () => {
    const out = await createDemoModel().generate({
      ...request,
      prompt: "Text to review: (ignored, the hint carries the text)",
      hint: {
        agentName: "Bia",
        kind: "review",
        topic: "solar energy",
        locale: "en",
        reviewing: "# Solar energy: the no-nonsense guide",
      },
    });
    const [text, notes] = out.text.split(REVIEW_NOTES_MARKER);
    expect(text?.trim()).toBe("# Solar energy: the complete, no-fluff guide");
    expect(notes).toContain("the complete, no-fluff guide :: ");
  });

  it("writes a review with notes after the marker", async () => {
    const out = await createDemoModel().generate(request);
    expect(out.text).toContain(REVIEW_NOTES_MARKER);
    expect(out.outputTokens).toBeGreaterThan(0);
  });

  it("is deterministic", async () => {
    const model = createDemoModel();
    expect((await model.generate(request)).text).toBe((await model.generate(request)).text);
  });
});

describe("createModelFactory", () => {
  it("uses the demo model for everything in demo mode", () => {
    const factory = createModelFactory({ credentials: [], demoMode: true });
    expect(factory("anthropic:claude-opus-5-5").provider).toBe("demo");
  });

  it("refuses a provider that is not connected", () => {
    const factory = createModelFactory({ credentials: [], demoMode: false });
    expect(() => factory("anthropic:claude-opus-5-5")).toThrow(ProviderNotConnectedError);
  });

  it("lets Ollama run without a key", () => {
    const factory = createModelFactory({
      credentials: [{ provider: "ollama", baseUrl: "http://localhost:11434/v1" }],
      demoMode: false,
    });
    expect(factory("ollama:llama3").provider).toBe("ollama");
  });
});

describe("generateWithFallback", () => {
  const ok = (provider: string): ChatModel => ({
    provider,
    model: "m",
    generate: async () => ({ text: provider, inputTokens: 1, outputTokens: 1 }),
  });
  const broken: ChatModel = {
    provider: "anthropic",
    model: "m",
    generate: async () => {
      throw new Error("529 overloaded");
    },
  };

  it("uses the primary when it works", async () => {
    const result = await generateWithFallback({ primary: "a:m", fallback: "b:m" }, request, (ref) =>
      ok(ref.split(":")[0] as string),
    );
    expect(result.text).toBe("a");
    expect(result.usedFallback).toBe(false);
  });

  it("switches to the fallback when the primary fails", async () => {
    const result = await generateWithFallback(
      { primary: "a:m", fallback: "b:m" },
      request,
      (ref) => (ref.startsWith("a") ? broken : ok("b")),
    );
    expect(result.text).toBe("b");
    expect(result.usedFallback).toBe(true);
  });

  it("surfaces the original error when there is no fallback", async () => {
    await expect(
      generateWithFallback({ primary: "a:m", fallback: null }, request, () => broken),
    ).rejects.toThrow("529");
  });
});

describe("friendlyError", () => {
  it("explains a missing provider in plain words", () => {
    expect(friendlyError(new ProviderNotConnectedError("anthropic"), "pt-BR")).toContain(
      "Modelos e custos",
    );
    expect(friendlyError(new ProviderNotConnectedError("anthropic"), "en")).toContain(
      "Models & costs",
    );
  });
});

describe("tool protocol", () => {
  const tools = [
    { name: "web_search", description: "Searches.", example: {}, needsApproval: true },
  ];

  it("teaches the same tags in every language", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      expect(toolInstructions(tools, locale)).toContain('<tool name="web_search">{}</tool>');
    }
    expect(toolInstructions(tools, "en")).toContain("needs a person's approval");
    expect(toolInstructions([], "en")).toBe("");
  });

  it("parses a call whatever language surrounds it", () => {
    const call = parseToolCall('Vou verificar.\n<tool name="web_search">{"query":"x"}</tool>');
    expect(call).toEqual({ name: "web_search", input: { query: "x" }, preface: "Vou verificar." });
  });

  it("still parses calls in the legacy Portuguese tags, with legacy tool names", () => {
    const call = parseToolCall('<ferramenta nome="pedir_ajuda">{"time":"x"}</ferramenta>');
    expect(call).toEqual({ name: "request_help", input: { time: "x" }, preface: "" });
  });

  it("does not match mismatched tags", () => {
    expect(parseToolCall('<tool name="web_search">{}</ferramenta>')).toBeNull();
  });
});

describe("chatModels", () => {
  it("keeps chat models, drops the rest, sorted and without repeats", () => {
    expect(
      chatModels([
        "gpt-5.5",
        "text-embedding-3-large",
        "whisper-1",
        "gpt-4o-mini-tts",
        "dall-e-3",
        "gpt-5.5",
        "gpt-5.5-mini",
        "omni-moderation-latest",
      ]),
    ).toEqual(["gpt-5.5", "gpt-5.5-mini"]);
  });
});
