import {
  AGENT_STYLES,
  APPROVAL_STATUSES,
  DELIVERY_STATUSES,
  HANDOFF_STATUSES,
  MEMBER_ROLES,
  MESSAGE_KINDS,
  MODEL_TIERS,
  PLAYBOOK_MODES,
  PROVIDERS,
  REQUEST_STATUSES,
  STEP_STATUSES,
  TOOL_POLICIES,
} from "@squadai/core";
import { pgEnum } from "drizzle-orm/pg-core";

export const memberRole = pgEnum("member_role", MEMBER_ROLES);
export const toolPolicy = pgEnum("tool_policy_value", TOOL_POLICIES);
export const playbookMode = pgEnum("playbook_mode", PLAYBOOK_MODES);
export const agentStyle = pgEnum("agent_style", AGENT_STYLES);
export const modelTier = pgEnum("model_tier", MODEL_TIERS);
export const requestStatus = pgEnum("request_status", REQUEST_STATUSES);
export const deliveryStatus = pgEnum("delivery_status", DELIVERY_STATUSES);
export const stepStatus = pgEnum("step_status", STEP_STATUSES);
export const messageKind = pgEnum("message_kind", MESSAGE_KINDS);
export const handoffStatus = pgEnum("handoff_status", HANDOFF_STATUSES);
export const approvalStatus = pgEnum("approval_status", APPROVAL_STATUSES);
export const provider = pgEnum("provider", PROVIDERS);
