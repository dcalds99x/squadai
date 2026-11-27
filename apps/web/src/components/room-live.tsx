"use client";

import type { AvatarSpec } from "@squadai/core";
import { Avatar } from "@squadai/ui";
import { useTranslations } from "next-intl";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** The last room lines, light enough to send to the browser. */
export interface RecentLine {
  id: string;
  agentName: string | null;
  fromUser: boolean;
  body: string;
}

export interface Activity {
  name: string;
  avatar: AvatarSpec;
  task: string;
}

interface Sent {
  key: string;
  body: string;
  /** How many identical lines from the person the room already had when this was sent. */
  seenBefore: number;
  /** Agents who will answer; filled once the server confirms. */
  repliers: string[];
}

interface RoomLive {
  agents: Map<string, AvatarSpec>;
  recent: RecentLine[];
  sent: Sent[];
  send(body: string): string;
  confirm(key: string, repliers: string[]): void;
  fail(key: string): void;
}

const Context = createContext<RoomLive | null>(null);

function useRoomLive(): RoomLive {
  const value = useContext(Context);
  if (!value) throw new Error("Room parts must be inside <RoomLiveProvider>.");
  return value;
}

/** How long to show someone typing before giving up on their answer. */
const TYPING_TIMEOUT_MS = 120_000;

/**
 * Shared state of one room in the browser: what the person just sent (shown
 * at once, before the server confirms) and who is about to answer.
 */
export function RoomLiveProvider({
  recent,
  agents,
  children,
}: {
  recent: RecentLine[];
  agents: { name: string; avatar: AvatarSpec }[];
  children: ReactNode;
}) {
  const [sent, setSent] = useState<Sent[]>([]);
  const counter = useRef(0);
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.name, a.avatar])), [agents]);

  const fromUser = useCallback(
    (body: string) => recent.filter((l) => l.fromUser && l.body === body).length,
    [recent],
  );

  const send = useCallback(
    (body: string) => {
      const key = `sent-${++counter.current}`;
      setSent((s) => [...s, { key, body, seenBefore: fromUser(body), repliers: [] }]);
      // Nobody answered in time: stop showing the dots.
      setTimeout(() => setSent((s) => s.filter((x) => x.key !== key)), TYPING_TIMEOUT_MS);
      return key;
    },
    [fromUser],
  );
  const confirm = useCallback(
    (key: string, repliers: string[]) =>
      setSent((s) => s.map((x) => (x.key === key ? { ...x, repliers } : x))),
    [],
  );
  const fail = useCallback((key: string) => setSent((s) => s.filter((x) => x.key !== key)), []);

  // Drop what the server has caught up with: the line arrived and everyone answered.
  useEffect(() => {
    setSent((s) =>
      s.filter((x) => {
        const arrived = fromUser(x.body) > x.seenBefore;
        if (!arrived) return true;
        const at = recent.findLastIndex((l) => l.fromUser && l.body === x.body);
        const after = recent.slice(at + 1);
        return x.repliers.some((name) => !after.some((l) => l.agentName === name));
      }),
    );
  }, [recent, fromUser]);

  const value = useMemo(
    () => ({ agents: agentMap, recent, sent, send, confirm, fail }),
    [agentMap, recent, sent, send, confirm, fail],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Composer hook: shows the line right away, then the repliers typing. */
export function useRoomSend() {
  const { send, confirm, fail } = useRoomLive();
  return { send, confirm, fail };
}

function Dots() {
  return (
    <span className="flex items-center gap-1 text-subtle" aria-hidden="true">
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}

/** A message (an <li>) that slides in only when it arrives after the page loaded. */
function Appear({
  item,
  live,
}: {
  item: ReactElement<{ className?: string }>;
  live: { current: boolean };
}) {
  const [animate] = useState(() => live.current);
  return animate ? cloneElement(item, { className: `${item.props.className ?? ""} msg-in` }) : item;
}

/**
 * The message list. Newest at the bottom; it stays pinned there unless the
 * person scrolled up, in which case a pill offers to jump to the new lines.
 */
export function RoomFeed({
  children,
  activity,
  userName,
}: {
  children: ReactNode;
  activity: Activity[];
  userName: string;
}) {
  const t = useTranslations("room");
  const { agents, recent, sent } = useRoomLive();
  const list = useRef<HTMLOListElement>(null);
  const live = useRef(false);
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(0);
  const lastId = recent.at(-1)?.id;
  const seen = useRef(lastId);

  useEffect(() => {
    live.current = true;
  }, []);

  // In a reversed column, scrollTop 0 is the bottom.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const onScroll = () => {
      const isAway = Math.abs(el.scrollTop) > 80;
      setAway(isAway);
      if (!isAway) setUnread(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (lastId === seen.current) return;
    seen.current = lastId;
    if (away) setUnread((n) => n + 1);
  }, [lastId, away]);

  const pending = sent.filter(
    (x) => recent.filter((l) => l.fromUser && l.body === x.body).length <= x.seenBefore,
  );
  const typing = [
    ...new Set(
      sent
        .filter((x) => !pending.includes(x))
        .flatMap((x) => {
          const at = recent.findLastIndex((l) => l.fromUser && l.body === x.body);
          const after = recent.slice(at + 1);
          return x.repliers.filter((name) => !after.some((l) => l.agentName === name));
        }),
    ),
  ];
  const busy = activity.filter((a) => !typing.includes(a.name));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ol
        ref={list}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col-reverse gap-4 overflow-y-auto px-5 py-[18px]"
      >
        {typing.map((name) => (
          <li key={`typing-${name}`} className="msg-in flex items-center gap-2.5">
            {agents.get(name) && (
              <Avatar spec={agents.get(name) as AvatarSpec} name={name} size={32} decorative />
            )}
            <span className="flex items-center gap-2 rounded-[4px_14px_14px_14px] bg-canvas px-3 py-3">
              <Dots />
              <span className="sr-only">{t("typing", { name })}</span>
            </span>
            <span className="text-xs text-subtle" aria-hidden="true">
              {t("typing", { name })}
            </span>
          </li>
        ))}
        {pending.map((x) => (
          <li key={x.key} className="msg-in flex flex-col items-end gap-1">
            <span className="text-xs text-subtle">
              <strong className="text-ink">{userName}</strong> · {t("sending")}
            </span>
            <p className="max-w-[90%] rounded-[14px_4px_14px_14px] bg-brand/70 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line text-white">
              {x.body}
            </p>
          </li>
        ))}
        {busy.map((a) => (
          <li key={`busy-${a.name}`} className="msg-in flex items-center gap-2.5">
            <Avatar spec={a.avatar} name={a.name} size={28} presence="working" decorative />
            <span className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 text-[13px] text-muted">
              <span className="min-w-0 flex-1 truncate">
                {t("workingOn", { name: a.name, task: a.task })}
              </span>
              <Dots />
            </span>
          </li>
        ))}
        {Children.map(children, (child) =>
          isValidElement<{ className?: string }>(child) ? (
            <Appear item={child} live={live} />
          ) : (
            child
          ),
        )}
      </ol>
      {away && unread > 0 && (
        <button
          type="button"
          onClick={() => list.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="msg-in absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg"
        >
          {t("newMessages", { count: unread })} ↓
        </button>
      )}
    </div>
  );
}
