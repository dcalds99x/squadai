"use client";

import { useEffect, useState } from "react";

/** An office event as the server sends it (see @squadai/engine events.ts). */
export interface LiveEvent {
  type: "room" | "request" | "delivery" | "presence" | "stream";
  teamId?: string;
  requestId?: string;
  deliveryId?: string;
  stream?: {
    id: string;
    seq: number;
    agentName: string;
    kind: string;
    text: string;
    reset?: boolean;
    done?: boolean;
  };
}

type Listener = (event: LiveEvent) => void;

/**
 * One EventSource per tab, shared by every component that listens: the page
 * refresher, the room's live text, the delivery's live draft.
 */
let source: EventSource | null = null;
const listeners = new Set<Listener>();
const statusListeners = new Set<(connected: boolean) => void>();
let connected = false;

function setConnected(value: boolean) {
  connected = value;
  for (const l of statusListeners) l(value);
}

function open() {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/events");
  source.onopen = () => setConnected(true);
  source.onerror = () => setConnected(false);
  source.onmessage = (e) => {
    let event: LiveEvent;
    try {
      event = JSON.parse(e.data) as LiveEvent;
    } catch {
      return;
    }
    for (const l of listeners) l(event);
  };
}

function closeIfUnused() {
  if (listeners.size === 0 && statusListeners.size === 0 && source) {
    source.close();
    source = null;
    connected = false;
  }
}

export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener);
  open();
  return () => {
    listeners.delete(listener);
    closeIfUnused();
  };
}

export function useLiveConnected(): boolean {
  const [value, setValue] = useState(connected);
  useEffect(() => {
    statusListeners.add(setValue);
    open();
    setValue(connected);
    return () => {
      statusListeners.delete(setValue);
      closeIfUnused();
    };
  }, []);
  return value;
}

export interface LiveText {
  id: string;
  agentName: string;
  kind: string;
  text: string;
  done: boolean;
}

/**
 * The text agents are writing right now, joined from the streamed pieces in
 * order. Finished streams stay until `keepUntil` changes (the real message or
 * version arrived), so nothing blinks out before it is replaced.
 */
export function useLiveTexts(
  filter: { teamId?: string; requestId?: string },
  keepUntil: unknown,
): LiveText[] {
  const [streams, setStreams] = useState<Map<string, LiveText & { pieces: Map<number, string> }>>(
    () => new Map(),
  );

  useEffect(
    () =>
      subscribeLive((event) => {
        const piece = event.stream;
        if (event.type !== "stream" || !piece) return;
        if (filter.teamId && event.teamId !== filter.teamId) return;
        if (filter.requestId && event.requestId !== filter.requestId) return;
        setStreams((prev) => {
          const next = new Map(prev);
          const current = next.get(piece.id) ?? {
            id: piece.id,
            agentName: piece.agentName,
            kind: piece.kind,
            text: "",
            done: false,
            pieces: new Map<number, string>(),
          };
          const pieces = piece.reset ? new Map<number, string>() : new Map(current.pieces);
          pieces.set(piece.seq, piece.text);
          // Join the pieces that arrived in order; a late one fills its gap later.
          let text = "";
          for (const seq of [...pieces.keys()].sort((a, b) => a - b)) text += pieces.get(seq);
          next.set(piece.id, {
            ...current,
            pieces,
            text,
            done: current.done || Boolean(piece.done),
          });
          return next;
        });
      }),
    [filter.teamId, filter.requestId],
  );

  // The real content arrived: drop the finished live texts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keepUntil is the trigger.
  useEffect(() => {
    setStreams((prev) => {
      const next = new Map([...prev].filter(([, s]) => !s.done));
      return next.size === prev.size ? prev : next;
    });
  }, [keepUntil]);

  return [...streams.values()].map(({ pieces: _, ...s }) => s);
}

/** What people should see of a step's live text: no tool calls, no review-notes block. */
export function readableLiveText(text: string): string {
  return (
    text
      .split(/<tool[\s>]/)[0]
      ?.split(/---NOTES---|---NOTAS---/)[0]
      ?.replace(/^\s*VERDICT:.*$/im, "")
      .trim() ?? ""
  );
}
