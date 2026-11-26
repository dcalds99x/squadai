"use client";

import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";
import { type ActionState, createRequestAction } from "@/app/(office)/actions";

interface TeamOption {
  id: string;
  name: string;
  playbooks: { id: string; name: string; description: string }[];
}

/** "Ask for something": choose who does it and what kind of delivery, then describe it. */
export function RequestForm({
  teams,
  defaultTeamId,
  stay = false,
  placeholder,
}: {
  teams: TeamOption[];
  defaultTeamId?: string;
  stay?: boolean;
  placeholder?: string;
}) {
  const t = useTranslations("requestForm");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState<ActionState, FormData>(createRequestAction, {});
  const [teamId, setTeamId] = useState(defaultTeamId ?? teams[0]?.id ?? "");
  const team = useMemo(() => teams.find((t) => t.id === teamId), [teams, teamId]);
  const [playbookId, setPlaybookId] = useState(team?.playbooks[0]?.id ?? "");
  const playbook = team?.playbooks.find((p) => p.id === playbookId) ?? team?.playbooks[0];

  if (teams.length === 0) {
    return <p className="text-muted">{t("noTeams")}</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="stay" value={stay ? "1" : "0"} />
      <label className="sr-only" htmlFor="prompt">
        {t("whatYouNeed")}
      </label>
      <textarea
        id="prompt"
        name="prompt"
        required
        minLength={5}
        rows={3}
        placeholder={placeholder ?? t("placeholder")}
        className="resize-y bg-transparent text-[17px] leading-relaxed outline-none"
      />
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-brand-wash p-3">
        {!defaultTeamId && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            {t("team")}
            <select
              name="teamId"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setPlaybookId(teams.find((t) => t.id === e.target.value)?.playbooks[0]?.id ?? "");
              }}
              className="h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm font-medium text-ink"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {defaultTeamId && <input type="hidden" name="teamId" value={teamId} />}
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {t("kind")}
          <select
            name="playbookId"
            value={playbook?.id ?? ""}
            onChange={(e) => setPlaybookId(e.target.value)}
            className="h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm font-medium text-ink"
          >
            {team?.playbooks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span className="min-w-0 flex-[1_1_200px] pb-2.5 text-sm text-muted">
          {playbook?.description}
        </span>
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-xl bg-brand px-5 font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? tc("sending") : t("submit")}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}
