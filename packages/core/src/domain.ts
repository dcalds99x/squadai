/**
 * Shared vocabulary of the product. These values are stored in the database,
 * written in team templates and shown (translated) in the UI.
 */

/** What an agent may do with a tool: "Can", "Asks first", "Can't". */
export const TOOL_POLICIES = ["allow", "ask", "deny"] as const;
export type ToolPolicy = (typeof TOOL_POLICIES)[number];

/** How a playbook coordinates its agents. */
export const PLAYBOOK_MODES = ["sequential", "coordinator", "parallel"] as const;
export type PlaybookMode = (typeof PLAYBOOK_MODES)[number];

/** The "Mais preciso ↔ Mais criativo" control on the agent profile. */
export const AGENT_STYLES = ["precise", "balanced", "creative"] as const;
export type AgentStyle = (typeof AGENT_STYLES)[number];

/** Quality and cost profile, which picks a model for each agent. */
export const MODEL_TIERS = ["economy", "balanced", "max"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const REQUEST_STATUSES = [
  "queued",
  "running",
  "waiting",
  "done",
  "failed",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const DELIVERY_STATUSES = [
  "in_progress",
  "awaiting_approval",
  "delivered",
  "cancelled",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const STEP_STATUSES = [
  "pending",
  "running",
  "waiting",
  "done",
  "failed",
  "skipped",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** Kinds of entries in a team room. */
export const MESSAGE_KINDS = ["chat", "handoff", "delivery", "system"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const HANDOFF_STATUSES = ["open", "in_progress", "done", "declined"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "changes_requested", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "ollama",
  "openai-compatible",
] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Job queues shared by the web app (producer) and the worker (consumer). */
export const QUEUES = {
  heartbeat: "system-heartbeat",
  runRequest: "request-run",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
