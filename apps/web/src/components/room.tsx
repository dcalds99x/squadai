import { type AvatarSpec, formatList, type Locale } from "@squadai/core";
import { Avatar } from "@squadai/ui";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatTime } from "@/lib/format";
import { RoomComposer } from "./room-composer";

export interface RoomMessage {
  id: string;
  kind: "chat" | "handoff" | "delivery" | "system";
  body: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  agentName: string | null;
  avatar: AvatarSpec | null;
  userName: string | null;
}

export async function Room({
  teamId,
  messages,
  people,
  working,
  timeZone,
  agentNames,
}: {
  teamId: string;
  messages: RoomMessage[];
  people: number;
  working: string[];
  timeZone: string;
  agentNames: string[];
}) {
  const [t, locale] = await Promise.all([getTranslations("room"), getLocale()]);
  const words: MessageWords = {
    open: t("open"),
    team: t("teamFallback"),
    incoming: t("incoming"),
    between: t("between"),
    system: (await getTranslations("common"))("system"),
  };
  return (
    <aside
      aria-label={t("label")}
      className="flex max-h-screen max-w-full flex-[1_1_340px] flex-col border-line border-l bg-surface lg:sticky lg:top-0 lg:max-w-[400px]"
    >
      <div className="flex flex-col gap-0.5 border-[#EEF0F6] border-b px-5 py-[18px]">
        <strong>{t("label")}</strong>
        <span className="text-[13px] text-subtle">
          {t("people", { count: people })}
          {working.length > 0 ? t("working", { names: formatList(working, locale) }) : ""}
        </span>
      </div>
      {/* Reversed column: the scroll starts at the newest message, like any chat. */}
      <ol className="flex flex-1 flex-col-reverse gap-4 overflow-y-auto px-5 py-[18px]">
        {[...messages].reverse().map((m) => (
          <li key={m.id}>
            <MessageItem message={m} timeZone={timeZone} locale={locale} words={words} />
          </li>
        ))}
      </ol>
      <RoomComposer teamId={teamId} agentNames={agentNames} />
    </aside>
  );
}

interface MessageWords {
  open: string;
  team: string;
  incoming: string;
  between: string;
  system: string;
}

function MessageItem({
  message: m,
  timeZone,
  locale,
  words,
}: {
  message: RoomMessage;
  timeZone: string;
  locale: Locale;
  words: MessageWords;
}) {
  const time = formatTime(m.createdAt, timeZone, locale);
  if (m.kind === "delivery" && typeof m.payload?.deliveryId === "string") {
    return (
      <Link
        href={`/deliveries/${m.payload.deliveryId}`}
        className="flex items-center justify-between gap-3 rounded-2xl border-2 border-brand bg-brand-wash px-3.5 py-3"
      >
        <span className="flex flex-col gap-0.5">
          <strong className="text-sm">{m.body}</strong>
          <span className="text-xs text-muted">
            {m.agentName ?? words.team} · {time}
          </span>
        </span>
        <span className="text-sm font-semibold text-brand-strong">{words.open}</span>
      </Link>
    );
  }
  if (m.kind === "handoff") {
    const direction = m.payload?.direction;
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-[#BFD8FF] bg-[#F2F7FF] px-3.5 py-3">
        <span aria-hidden="true" className="mt-0.5 text-[#1E4FA0]">
          {direction === "answered" ? "✓" : direction === "incoming" ? "←" : "→"}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-bold tracking-wider text-[#1E4FA0] uppercase">
            {direction === "incoming" ? words.incoming : words.between}
          </span>
          <span className="text-sm leading-snug">{m.body}</span>
          <span className="text-xs text-subtle">
            {m.agentName ? `${m.agentName} · ` : ""}
            {time}
          </span>
        </span>
      </div>
    );
  }
  if (m.kind === "system") {
    const failed = m.payload?.failed === true;
    return (
      <p
        className={`rounded-xl px-3 py-2.5 text-sm leading-relaxed ${failed ? "bg-warn-soft text-warn" : "bg-canvas text-ink-2"}`}
      >
        {m.agentName && <strong>{m.agentName}: </strong>}
        {m.body} <span className="text-xs opacity-75">· {time}</span>
      </p>
    );
  }
  if (m.userName && !m.agentName) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-subtle">
          <strong className="text-ink">{m.userName}</strong> · {time}
        </span>
        <p className="max-w-[90%] rounded-[14px_4px_14px_14px] bg-brand px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line text-white">
          {m.body}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      {m.avatar ? <Avatar spec={m.avatar} name={m.agentName ?? ""} size={32} decorative /> : null}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-subtle">
          <strong className="text-ink">{m.agentName ?? words.system}</strong> · {time}
        </span>
        <p className="rounded-[4px_14px_14px_14px] bg-canvas px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line">
          {m.body}
        </p>
      </div>
    </div>
  );
}
