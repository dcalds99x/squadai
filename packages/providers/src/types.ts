import type { AgentStyle, Locale, ModelRef, Provider } from "@squadai/core";

export type Effort = "low" | "medium" | "high";

/** What kind of work a call is doing. Only the demo model reads it. */
export type CallKind =
  | "research"
  | "draft"
  | "review"
  | "chat"
  | "plan"
  | "contribution"
  | "synthesis"
  /** The team lead deciding how to work on a free-form request. */
  | "triage"
  /** A short view in a team discussion. */
  | "discussion"
  /** Is a request in a team's scope? */
  | "scope"
  /** Summing up a team discussion. */
  | "summary";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  system: string;
  /** The first user message. */
  prompt: string;
  /** Later turns, e.g. tool calls and their results. */
  continuation?: ChatTurn[];
  style: AgentStyle;
  effort: Effort;
  maxOutputTokens?: number;
  /**
   * Called with each piece of text as the model writes it. Providers that can
   * stream do; the result is the same either way.
   */
  onDelta?: (text: string) => void;
  /** Called when a call failed part-way and another model starts over (Plan B). */
  onRestart?: () => void;
  hint?: {
    agentName: string;
    kind: CallKind;
    topic: string;
    /** The workspace language, for the demo model's templated text. */
    locale?: Locale;
    /** The text a review step is revising. */
    reviewing?: string;
    /** Tools the agent may call (names). */
    tools?: string[];
    /** Teammates, for coordinator plans. */
    teammates?: { key: string; name: string }[];
    /** Review steps that may send the draft back: which round this is, and how many there are. */
    round?: number;
    rounds?: number;
    /** A draft that rewrites an earlier version (after review notes or the person's feedback). */
    rework?: boolean;
    /** Other teams in the office, for handoffs. */
    teams?: { slug: string; name: string }[];
  };
}

export interface ModelOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatModel {
  readonly provider: string;
  readonly model: string;
  generate(request: ChatRequest): Promise<ModelOutput>;
}

export interface ChatResult extends ModelOutput {
  provider: string;
  model: string;
  /** Cost in millionths of a US dollar; 0 when the model has no known price. */
  costMicros: number;
  latencyMs: number;
  usedFallback: boolean;
}

export interface ProviderCredentials {
  provider: Provider;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export class ProviderNotConnectedError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`Provider "${provider}" is not connected.`);
    this.name = "ProviderNotConnectedError";
    this.provider = provider;
  }
}

export class ModelRefusalError extends Error {
  constructor(message = "The model declined this request.") {
    super(message);
    this.name = "ModelRefusalError";
  }
}

export class BudgetExceededError extends Error {
  constructor() {
    super("The monthly budget is used up.");
    this.name = "BudgetExceededError";
  }
}

export type ModelFactory = (ref: ModelRef) => ChatModel;
