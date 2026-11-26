import type { Logger } from "@squadai/core";
import type { DbOrTx } from "@squadai/db";
import type { ModelContext } from "../models.ts";

export interface ToolContext {
  db: DbOrTx;
  log: Logger;
  workspaceId: string;
  teamId: string;
  teamName: string;
  agentId: string;
  agentName: string;
  requestId: string;
  models: ModelContext;
}

export type ToolOutcome =
  /** The tool finished; its text goes back to the agent. */
  | { kind: "result"; text: string; costMicros?: number }
  /** Another team is working on it; the step waits for the handoff. */
  | { kind: "wait_handoff"; handoffId: string; helperRequestId: string };

export interface ToolDef {
  name: string;
  /** How people see it ("Pesquisar na internet"), in the locale the tools were built for. */
  label: string;
  /** How the model sees it. */
  description: string;
  example: Record<string, unknown>;
  /** False when the workspace lacks what the tool needs. The web app explains why. */
  available: boolean;
  /** Policy when an agent has none set for this tool. */
  defaultPolicy: "allow" | "ask" | "deny";
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

export const str = (value: unknown, max = 2000): string =>
  typeof value === "string"
    ? value.slice(0, max)
    : value === undefined || value === null
      ? ""
      : String(value).slice(0, max);
