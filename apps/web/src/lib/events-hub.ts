import "server-only";
import { createListener } from "@squadai/db";
import { EVENTS_CHANNEL, type OfficeEvent, parseEvent } from "@squadai/engine";
import { env } from "./env";

type Subscriber = { workspaceId: string; send: (event: OfficeEvent) => void };

interface Hub {
  subscribers: Set<Subscriber>;
  ready: Promise<void>;
}

const globalForHub = globalThis as unknown as { squadaiHub?: Hub };

/**
 * One LISTEN connection per server process, fanned out to every open browser
 * tab of the same workspace. Events only say what changed; the browser then
 * re-fetches through the normal, permission-checked pages.
 */
function getHub(): Hub {
  if (!globalForHub.squadaiHub) {
    const subscribers = new Set<Subscriber>();
    const listener = createListener(env().DATABASE_URL);
    const ready = listener
      .listen(EVENTS_CHANNEL, (payload) => {
        const event = parseEvent(payload);
        if (!event) return;
        for (const s of subscribers) if (s.workspaceId === event.workspaceId) s.send(event);
      })
      .then(() => undefined);
    globalForHub.squadaiHub = { subscribers, ready };
  }
  return globalForHub.squadaiHub;
}

export async function subscribe(workspaceId: string, send: (event: OfficeEvent) => void) {
  const hub = getHub();
  await hub.ready;
  const subscriber = { workspaceId, send };
  hub.subscribers.add(subscriber);
  return () => hub.subscribers.delete(subscriber);
}
