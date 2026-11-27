/**
 * The office: workspaces, departments, teams, agents and their rooms.
 */
import type { AvatarSpec, FlowStepKind, WorkspaceSettings } from "@squadai/core";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import {
  agentStyle,
  handoffStatus,
  memberRole,
  messageKind,
  modelTier,
  playbookMode,
  toolPolicy,
} from "./enums.ts";
import { request } from "./work.ts";

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();
const workspaceRef = () =>
  uuid()
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" });

export const workspace = pgTable("workspace", {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  settings: jsonb().$type<WorkspaceSettings>().notNull().default({}),
  createdAt: createdAt(),
});

export const membership = pgTable(
  "membership",
  {
    workspaceId: workspaceRef(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole().notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index().on(t.userId)],
);

/** A category in the sidebar, such as "Marketing". */
export const department = pgTable(
  "department",
  {
    id: id(),
    workspaceId: workspaceRef(),
    name: text().notNull(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.name)],
);

export const team = pgTable(
  "team",
  {
    id: id(),
    workspaceId: workspaceRef(),
    departmentId: uuid()
      .notNull()
      .references(() => department.id, { onDelete: "restrict" }),
    slug: text().notNull(),
    name: text().notNull(),
    description: text().notNull(),
    color: text().notNull(),
    /** Key of the agent who plans free-form requests. Null means the first agent. */
    leadKey: text(),
    /** What the team does and doesn't do. Null means "judge by the description and playbooks". */
    scope: jsonb().$type<TeamScope>(),
    /** Catalog template this team was hired from, e.g. "content-seo@1". */
    templateRef: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.slug)],
);

export const agent = pgTable(
  "agent",
  {
    id: id(),
    workspaceId: workspaceRef(),
    teamId: uuid()
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    role: text().notNull(),
    bio: text().notNull(),
    skills: text().array().notNull().default([]),
    prefers: text().notNull(),
    never: text().notNull(),
    instructions: text().notNull(),
    avatar: jsonb().$type<AvatarSpec>().notNull(),
    tier: modelTier().notNull().default("balanced"),
    /** "provider:model". Null means "use the tier default". */
    model: text(),
    fallbackModel: text(),
    style: agentStyle().notNull().default("balanced"),
    /** Order inside the team, as in the template. */
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.teamId, t.key)],
);

/** "Can / Asks first / Can't" for each tool an agent can use. */
export const agentToolPolicy = pgTable(
  "agent_tool_policy",
  {
    agentId: uuid()
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    tool: text().notNull(),
    policy: toolPolicy().notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.tool] })],
);

export interface PlaybookStepDef {
  agentKey: string;
  task: string;
  /** See FLOW_STEP_KINDS. Left out, the position decides. */
  kind?: FlowStepKind;
  /** discuss: teammates who join. */
  with?: string[];
  /** review: rounds allowed, sending the draft back in between. */
  rounds?: number;
}

export interface TeamScope {
  does: string[];
  doesNot: string[];
}

/** Something a team knows how to deliver ("Blog post"). */
export const playbook = pgTable(
  "playbook",
  {
    id: id(),
    teamId: uuid()
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull(),
    mode: playbookMode().notNull(),
    steps: jsonb().$type<PlaybookStepDef[]>().notNull(),
    estimatedHumanMinutes: integer().notNull(),
    requiresApproval: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.teamId, t.key)],
);

/** Each team has one room: the chat beside its work. */
export const room = pgTable("room", {
  id: id(),
  teamId: uuid()
    .notNull()
    .unique()
    .references(() => team.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const message = pgTable(
  "message",
  {
    id: id(),
    roomId: uuid()
      .notNull()
      .references(() => room.id, { onDelete: "cascade" }),
    kind: messageKind().notNull().default("chat"),
    authorAgentId: uuid().references(() => agent.id, { onDelete: "set null" }),
    authorUserId: text().references(() => user.id, { onDelete: "set null" }),
    body: text().notNull(),
    /** The request this message is about, so a delivery can show its own thread. */
    requestId: uuid().references((): AnyPgColumn => request.id, { onDelete: "set null" }),
    /** Extra data for handoff and delivery cards. */
    payload: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.roomId, t.createdAt), index().on(t.requestId)],
);

/** A team asking another team for help. */
export const handoff = pgTable(
  "handoff",
  {
    id: id(),
    workspaceId: workspaceRef(),
    fromTeamId: uuid()
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    toTeamId: uuid()
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    requestedByAgentId: uuid().references((): AnyPgColumn => agent.id, { onDelete: "set null" }),
    ask: text().notNull(),
    status: handoffStatus().notNull().default("open"),
    result: text(),
    /** The request the asking team is waiting on. */
    originRequestId: uuid().references((): AnyPgColumn => request.id, { onDelete: "cascade" }),
    /** The request created for the helping team. */
    helperRequestId: uuid().references((): AnyPgColumn => request.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.workspaceId, t.createdAt), index().on(t.helperRequestId)],
);

/**
 * Systems agents can reach: GitHub, Notion, or any MCP server.
 * Secrets are encrypted like provider keys (ADR-0006).
 */
export const integration = pgTable(
  "integration",
  {
    id: id(),
    workspaceId: workspaceRef(),
    kind: text().$type<"github" | "notion" | "mcp">().notNull(),
    name: text().notNull(),
    url: text(),
    encryptedSecret: text(),
    secretHint: text(),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Tools discovered on the last check (MCP). */
    tools: jsonb().$type<{ name: string; description: string }[]>().notNull().default([]),
    lastCheckedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.kind, t.name)],
);
