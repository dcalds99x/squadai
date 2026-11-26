"use client";

import type { RouteOption } from "@squadai/engine";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { type ActionState, createRequestAction } from "../actions";
import { suggestRoutesAction } from "../actions-tools";

export function NewRequest() {
  const t = useTranslations("newRequest");
  const tf = useTranslations("requestForm");
  const tc = useTranslations("common");
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<RouteOption[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [thinking, startThinking] = useTransition();
  const [state, action, sending] = useActionState<ActionState, FormData>(createRequestAction, {});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Suggest while the person types, after a short pause.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (prompt.trim().length < 8) {
      setOptions([]);
      return;
    }
    timer.current = setTimeout(() => {
      startThinking(async () => {
        const found = await suggestRoutesAction(prompt);
        setOptions(found);
        setChosen((c) =>
          c && found.some((o) => o.playbookId === c) ? c : (found[0]?.playbookId ?? null),
        );
      });
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [prompt]);

  const pick = options.find((o) => o.playbookId === chosen);

  return (
    <form action={action} className="flex flex-col gap-5">
      <label htmlFor="request" className="sr-only">
        {tf("whatYouNeed")}
      </label>
      <textarea
        id="request"
        name="prompt"
        rows={4}
        required
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("placeholder")}
        className="resize-y rounded-2xl border border-line bg-surface p-4 text-[17px] leading-relaxed shadow-[0_6px_20px_rgba(27,29,42,0.05)]"
      />

      <fieldset className="flex flex-col gap-2" aria-busy={thinking}>
        <legend className="mb-2 text-xs font-semibold tracking-wider text-subtle uppercase">
          {thinking ? t("searching") : options.length > 0 ? t("options") : t("empty")}
        </legend>
        {options.map((o, i) => {
          const on = o.playbookId === chosen;
          return (
            <label
              key={o.playbookId}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border bg-surface px-4 py-3 ${on ? "border-2 border-brand" : "border-line"}`}
            >
              <input
                type="radio"
                name="choice"
                value={o.playbookId}
                checked={on}
                onChange={() => setChosen(o.playbookId)}
                className="size-4 accent-[#5B4CF0]"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px]">
                  <strong>{o.playbookName}</strong>{" "}
                  <span className="text-muted">· {o.teamName}</span>
                </span>
                <span className="truncate text-[13px] text-subtle">{o.description}</span>
              </span>
              {i === 0 && (
                <span className="rounded-full bg-brand-wash px-2.5 py-1 text-xs font-semibold text-brand-strong">
                  {t("suggested")}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>

      {pick && (
        <>
          <input type="hidden" name="teamId" value={pick.teamId} />
          <input type="hidden" name="playbookId" value={pick.playbookId} />
        </>
      )}
      {state.error && (
        <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={!pick || sending}
        className="h-12 self-start rounded-xl bg-brand px-6 font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
      >
        {sending ? tc("sending") : pick ? t("askTeam", { team: pick.teamName }) : t("ask")}
      </button>
    </form>
  );
}
