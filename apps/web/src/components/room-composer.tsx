"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { sendRoomMessageAction } from "@/app/(office)/actions";
import { useRoomSend } from "./room-live";

/**
 * Writes to the room. The line shows up at once (marked "sending"), the box
 * clears, and whoever will answer shows as typing until their reply lands.
 */
export function RoomComposer({ teamId, agentNames }: { teamId: string; agentNames: string[] }) {
  const t = useTranslations("room");
  const { send, confirm, fail } = useRoomSend();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    const body = value.trim();
    if (!body) return;
    // Outside the transition, so the bubble appears before the server answers.
    const key = send(body);
    setValue("");
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set("teamId", teamId);
      form.set("body", body);
      const result = await sendRoomMessageAction({}, form);
      if (result.error) {
        fail(key);
        setValue(body);
        setError(result.error);
      } else {
        confirm(key, result.replying ?? []);
      }
    });
  };

  const example = agentNames[1] ?? agentNames[0];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2 border-[#EEF0F6] border-t px-4 py-3.5"
    >
      <label className="flex items-end gap-2 rounded-2xl border border-line-strong py-1.5 pr-1.5 pl-3.5 transition focus-within:border-brand focus-within:shadow-[0_0_0_3px_rgba(91,76,240,0.12)]">
        <span className="sr-only">{t("composerLabel")}</span>
        <textarea
          name="body"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          autoComplete="off"
          placeholder={t("composerPlaceholder")}
          className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 leading-snug outline-none"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          aria-label={t("send")}
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white transition hover:bg-brand-strong active:scale-95 disabled:opacity-40"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className={pending ? "animate-pulse" : undefined}
          >
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </button>
      </label>
      {error ? (
        <span role="alert" className="text-xs text-warn">
          {error}
        </span>
      ) : (
        <span className="text-xs text-subtle">
          {example ? t("leadAnswers", { example: example.toLowerCase() }) : t("mentionHint")}
        </span>
      )}
    </form>
  );
}
