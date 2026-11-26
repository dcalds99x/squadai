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
  | "synthesis";

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
