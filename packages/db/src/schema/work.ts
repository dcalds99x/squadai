/**
 * The work: requests people make, the deliveries teams produce, and the
 * internal runs and steps that produced them.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { approvalStatus, deliveryStatus, requestStatus, stepStatus } from "./enums.ts";
import { agent, type PlaybookStepDef, playbook, team, workspace } from "./office.ts";

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();

export const request = pgTable(
  "request",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    teamId: uuid()
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    playbookId: uuid().references(() => playbook.id, { onDelete: "set null" }),
    requestedBy: text().references(() => user.id, { onDelete: "set null" }),
    prompt: text().notNull(),
    /**
     * The steps the team lead chose for a request without a playbook. Kept so a
     * revision follows the same flow and the delivery page can show it.
     */
    flow: jsonb().$type<{ title: string; steps: PlaybookStepDef[] }>(),
    status: requestStatus().notNull().default("queued"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt)],
);

export const delivery = pgTable(
  "delivery",
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .references(() => request.id, { onDelete: "cascade" }),
    teamId: uuid()
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    title: text().notNull(),
    kind: text().notNull(),
    status: deliveryStatus().notNull().default("in_progress"),
    /** Times the person asked for changes. Feeds "Aprovadas de primeira". */
    adjustmentCount: integer().notNull().default(0),
    estimatedHumanMinutes: integer().notNull().default(0),
    createdAt: createdAt(),
    deliveredAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.teamId, t.status), index().on(t.deliveredAt)],
);

export const deliveryVersion = pgTable(
  "delivery_version",
  {
    id: id(),
    deliveryId: uuid()
      .notNull()
      .references(() => delivery.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    label: text().notNull(),
    content: text().notNull(),
    authorAgentId: uuid().references(() => agent.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.deliveryId, t.number)],
);

/** A margin note on a version, like the reviewer's comments. */
export const reviewNote = pgTable("review_note", {
  id: id(),
  versionId: uuid()
    .notNull()
    .references(() => deliveryVersion.id, { onDelete: "cascade" }),
  agentId: uuid().references(() => agent.id, { onDelete: "set null" }),
  /** The passage the note refers to. */
  anchor: text().notNull(),
  body: text().notNull(),
  createdAt: createdAt(),
});

/** One attempt at carrying out a request. Internal: people see deliveries. */
export const run = pgTable(
  "run",
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .references(() => request.id, { onDelete: "cascade" }),
    status: requestStatus().notNull().default("queued"),
    error: text(),
    /**
     * While a worker holds the run. Another worker skips it until the lease
     * runs out, so a request queued twice never runs twice at once, and a run
     * whose worker died can be picked up again.
     */
    leaseUntil: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // At most one unfinished run per request.
    uniqueIndex("run_one_active_per_request")
      .on(t.requestId)
      .where(sql`${t.status} in ('queued', 'running', 'waiting')`),
  ],
);

/** A checkpointed unit of work, so a run can resume after a crash or an approval. */
export const step = pgTable(
  "step",
  {
    id: id(),
    runId: uuid()
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    agentId: uuid().references(() => agent.id, { onDelete: "set null" }),
    position: integer().notNull(),
    status: stepStatus().notNull().default("pending"),
    input: jsonb().$type<Record<string, unknown>>(),
    output: jsonb().$type<Record<string, unknown>>(),
    checkpoint: jsonb().$type<Record<string, unknown>>(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex().on(t.runId, t.position)],
);

/** Anything waiting on a person: "Waiting on you". */
export const approval = pgTable(
  "approval",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    deliveryId: uuid().references(() => delivery.id, { onDelete: "cascade" }),
    stepId: uuid().references(() => step.id, { onDelete: "cascade" }),
    requestedByAgentId: uuid().references(() => agent.id, { onDelete: "set null" }),
    /**
     * "delivery": approve a finished delivery. "tool": let an agent use an "ask" tool.
     * "checkpoint": let the team go on past a checkpoint step.
     */
    kind: text().$type<"delivery" | "tool" | "checkpoint">().notNull().default("delivery"),
    /** For tool approvals: the tool name and input the agent wants to use. */
    payload: jsonb().$type<{ tool?: string; input?: Record<string, unknown> }>(),
    question: text().notNull(),
    status: approvalStatus().notNull().default("pending"),
    decidedBy: text().references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.status)],
);
