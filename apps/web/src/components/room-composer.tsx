"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";
import { type ActionState, sendRoomMessageAction } from "@/app/(office)/actions";

export function RoomComposer({ teamId, agentNames }: { teamId: string; agentNames: string[] }) {
  const t = useTranslations("room");
  const [state, action, pending] = useActionState<ActionState, FormData>(sendRoomMessageAction, {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  const example = agentNames[1] ?? agentNames[0];
  return (
    <form
      ref={form}
      action={action}
      className="flex flex-col gap-2 border-[#EEF0F6] border-t px-4 py-3.5"
    >
      <input type="hidden" name="teamId" value={teamId} />
      <label className="flex items-center gap-2 rounded-2xl border border-line-strong py-1.5 pr-1.5 pl-3.5">
        <span className="sr-only">{t("composerLabel")}</span>
        <input
          name="body"
          required
          autoComplete="off"
          placeholder={t("composerPlaceholder")}
          className="min-h-10 flex-1 bg-transparent outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          aria-label={t("send")}
          className="grid size-10 place-items-center rounded-xl bg-brand text-white disabled:opacity-60"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </button>
      </label>
      {state.error ? (
        <span role="alert" className="text-xs text-warn">
          {state.error}
        </span>
      ) : (
        <span className="text-xs text-subtle">
          {example ? t("mentionHintExample", { example: example.toLowerCase() }) : t("mentionHint")}
        </span>
      )}
    </form>
  );
}
