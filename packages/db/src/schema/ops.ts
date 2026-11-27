/**
 * Operations: provider credentials, the cost ledger, budgets and the audit log.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { provider } from "./enums.ts";
import { agent, workspace } from "./office.ts";
import { run, step } from "./work.ts";

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();

export const providerCredential = pgTable(
  "provider_credential",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: provider().notNull(),
    label: text().notNull(),
    /** AES-256-GCM payload from @squadai/core/crypto. Never sent to the browser. */
    encryptedKey: text(),
    /** Last characters of the key, for display ("…a1b2"). */
    keyHint: text(),
    baseUrl: text(),
    /** Models the provider offered at the last check, for the model picker. */
    models: text().array().notNull().default([]),
    lastCheckedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId)],
);

/** One row per model call: the source of cost, latency and usage metrics. */
export const llmCall = pgTable(
  "llm_call",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    runId: uuid().references(() => run.id, { onDelete: "set null" }),
    stepId: uuid().references(() => step.id, { onDelete: "set null" }),
    agentId: uuid().references(() => agent.id, { onDelete: "set null" }),
    provider: text().notNull(),
    model: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    /** Cost in millionths of a US dollar, to avoid float rounding. */
    costMicros: integer().notNull().default(0),
    latencyMs: integer().notNull().default(0),
    usedFallback: boolean().notNull().default(false),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt)],
);

export const budget = pgTable("budget", {
  workspaceId: uuid()
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  monthlyLimitCents: integer(),
  currency: text().notNull().default("BRL"),
  alertAtPercent: integer().notNull().default(80),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    actorType: text().notNull(),
    actorId: text(),
    action: text().notNull(),
    target: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt)],
);
