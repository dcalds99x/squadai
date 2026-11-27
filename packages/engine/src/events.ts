import type { DbOrTx } from "@squadai/db";
import { sql } from "drizzle-orm";

/**
 * Live updates go through Postgres NOTIFY: the worker writes, then notifies;
 * the web app LISTENs and streams to browsers (ADR-0002).
 * Events say *what changed*, never carry content, so payloads stay small and
 * permission checks happen when the browser reloads the data. The exception is
 * "stream": the text an agent is writing right now, sent in small numbered
 * pieces to the browsers of that workspace only, so people watch it appear.
 */
export const EVENTS_CHANNEL = "squadai_events";

export type OfficeEventType = "room" | "request" | "delivery" | "presence" | "stream";

export interface OfficeEvent {
  type: OfficeEventType;
  workspaceId: string;
  teamId?: string;
  requestId?: string;
  deliveryId?: string;
  /** "stream" only: one piece of text an agent is writing. */
  stream?: StreamPiece;
}

export interface StreamPiece {
  /** One model call; pieces with the same id join in `seq` order. */
  id: string;
  seq: number;
  agentName: string;
  /** What the text is for: a room reply ("chat"), a step ("draft", "review"…). */
  kind: string;
  text: string;
  /** Start over (Plan B took over after a failure). */
  reset?: boolean;
  done?: boolean;
}

/** NOTIFY payloads must stay under 8 kB. */
const MAX_PIECE = 1500;
const FLUSH_MS = 100;

/**
 * Sends what an agent writes as it writes it, batched every 100 ms. Pieces go
 * out one at a time and are numbered, so the browser joins them in order.
 */
export function createStreamer(
  db: DbOrTx,
  base: {
    workspaceId: string;
    teamId: string;
    requestId?: string;
    agentName: string;
    kind: string;
  },
  /** Where pieces go; tests pass their own. */
  publish: (event: OfficeEvent) => Promise<void> = (event) => notify(db, event),
) {
  const id = crypto.randomUUID();
  let seq = 0;
  let buffer = "";
  let reset = false;
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const send = (piece: Omit<StreamPiece, "id" | "seq" | "agentName" | "kind">) => {
    const stream: StreamPiece = {
      id,
      seq: seq++,
      agentName: base.agentName,
      kind: base.kind,
      ...piece,
    };
    chain = chain
      .then(() =>
        publish({
          type: "stream",
          workspaceId: base.workspaceId,
          teamId: base.teamId,
          requestId: base.requestId,
          stream,
        }),
      )
      .catch(() => {});
  };
  const flush = () => {
    timer = null;
    while (buffer.length > 0 || reset) {
      const text = buffer.slice(0, MAX_PIECE);
      buffer = buffer.slice(MAX_PIECE);
      send({ text, ...(reset ? { reset: true } : {}) });
      reset = false;
    }
  };
  return {
    onDelta(text: string) {
      buffer += text;
      timer ??= setTimeout(flush, FLUSH_MS);
    },
    onRestart() {
      buffer = "";
      reset = true;
      timer ??= setTimeout(flush, FLUSH_MS);
    },
    /** The call ended (well or not): the browser drops the live text once the real one arrives. */
    async done() {
      if (timer) clearTimeout(timer);
      flush();
      send({ text: "", done: true });
      await chain;
    },
  };
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
