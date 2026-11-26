import type { DbOrTx } from "@squadai/db";
import { sql } from "drizzle-orm";

/**
 * Live updates go through Postgres NOTIFY: the worker writes, then notifies;
 * the web app LISTENs and streams to browsers (ADR-0002).
 * Events say *what changed*, never carry content, so payloads stay small and
 * permission checks happen when the browser reloads the data.
 */
export const EVENTS_CHANNEL = "squadai_events";

export type OfficeEventType = "room" | "request" | "delivery" | "presence";

export interface OfficeEvent {
  type: OfficeEventType;
  workspaceId: string;
  teamId?: string;
  requestId?: string;
  deliveryId?: string;
}

export async function notify(db: DbOrTx, event: OfficeEvent): Promise<void> {
  await db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
}

export function parseEvent(payload: string): OfficeEvent | null {
  try {
    const event = JSON.parse(payload) as OfficeEvent;
    return typeof event.workspaceId === "string" && typeof event.type === "string" ? event : null;
  } catch {
    return null;
  }
}
