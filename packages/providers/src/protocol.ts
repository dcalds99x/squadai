/**
 * A text protocol for tool calls that works with every provider, including
 * local models and the demo model, and that serializes to plain text so a run
 * can pause (waiting for a person or another team) and resume later.
 *
 *   <tool name="web_search">{"query": "home solar panel prices"}</tool>
 *
 * The result goes back as a user turn:
 *
 *   <result name="web_search">…</result>
 *
 * The tags are protocol tokens, not copy: they are the same in every locale,
 * because stored checkpoints contain them and a run must resume whatever
 * language the workspace uses today. Only the instructions around them are
 * translated. See ADR-0008 and ADR-0009.
 *
 * Early builds used Portuguese tokens (`<ferramenta nome="…">`, `pedir_ajuda`).
 * The parser still reads them, so a run paused before the rename resumes.
 */
import type { Locale } from "@squadai/core";

const CALL = /<(tool|ferramenta)\s+(?:name|nome)="([a-zA-Z0-9_.:-]+)"\s*>([\s\S]*?)<\/\1>/;

/** A whole tool call inside a model answer, for removing it from text people read. */
export const TOOL_CALL_PATTERN = /<(tool|ferramenta)[\s>][\s\S]*<\/\1>/;

/** Tool names from before the protocol was in English, mapped to today's names. */
const LEGACY_TOOL_NAMES: Record<string, string> = { pedir_ajuda: "request_help" };

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  /** Text the model wrote before the call, if any. */
  preface: string;
}

export function formatToolCall(name: string, input: Record<string, unknown>): string {
  return `<tool name="${name}">${JSON.stringify(input)}</tool>`;
}

export function formatToolResult(name: string, result: string): string {
  return `<result name="${name}">\n${result}\n</result>`;
}

/** Returns the first tool call in a model answer, or null when it is a final answer. */
export function parseToolCall(text: string): ToolCall | null {
  const match = CALL.exec(text);
  if (!match) return null;
  const [, , rawName = "", raw] = match;
  let input: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse((raw ?? "").trim() || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed;
  } catch {
    input = { _invalid: (raw ?? "").trim() };
  }
  return {
    name: LEGACY_TOOL_NAMES[rawName] ?? rawName,
    input,
    preface: text.slice(0, match.index).trim(),
  };
}

export interface ToolSpec {
  name: string;
  description: string;
  /** Example input, shown to the model. */
  example: Record<string, unknown>;
  /** "ask" tools need a person's OK before running. */
  needsApproval: boolean;
}

const PT_BR = {
  needsApproval: " (precisa da aprovação de uma pessoa)",
  example: "Exemplo",
  intro:
    "Você pode usar ferramentas. Para usar uma, responda APENAS com a chamada, neste formato exato, e mais nada:",
  format: '<tool name="NOME">{JSON}</tool>',
  after:
    "Você receberá o resultado em <result> e então continua o trabalho. Use no máximo 4 ferramentas por tarefa. Quando terminar, responda com o trabalho final, sem chamadas.",
  available: "Ferramentas disponíveis:",
};

const WORDS: Record<Locale, typeof PT_BR> = {
  "pt-BR": PT_BR,
  en: {
    needsApproval: " (needs a person's approval)",
    example: "Example",
    intro:
      "You can use tools. To use one, reply with ONLY the call, in this exact format, and nothing else:",
    format: '<tool name="NAME">{JSON}</tool>',
    after:
      "You will get the result inside <result> and then carry on with the work. Use at most 4 tools per task. When you are done, reply with the final work and no calls.",
    available: "Available tools:",
  },
};

/** The part of the system prompt that teaches the protocol, in the workspace language. */
export function toolInstructions(tools: ToolSpec[], locale: Locale): string {
  if (tools.length === 0) return "";
  const w = WORDS[locale];
  const list = tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description}${t.needsApproval ? w.needsApproval : ""}\n  ${w.example}: ${formatToolCall(t.name, t.example)}`,
    )
    .join("\n");
  return [w.intro, w.format, w.after, w.available, list].join("\n");
}
