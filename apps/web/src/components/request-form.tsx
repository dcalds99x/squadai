"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useState } from "react";
import { type ActionState, createRequestAction } from "@/app/(office)/actions";

interface TeamOption {
  id: string;
  name: string;
  playbooks: { id: string; name: string; description: string }[];
}

/** No delivery type: the team lead reads the request and decides how the team works. */
const TEAM_DECIDES = "";

/**
 * "Ask for something": describe it in your own words. The delivery types a
 * team knows are suggestions; by default the team decides how to do it.
 * When the request is outside the team's work, the form says who fits better.
 */
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
  const team = useMemo(() => teams.find((x) => x.id === teamId), [teams, teamId]);
  const [playbookId, setPlaybookId] = useState(TEAM_DECIDES);
  // Controlled, so the text survives a refusal and can be sent to another team.
  const [prompt, setPrompt] = useState("");
  const playbook = team?.playbooks.find((p) => p.id === playbookId);
  useEffect(() => {
    if (state.ok) setPrompt("");
  }, [state]);

  if (teams.length === 0) {
    return <p className="text-muted">{t("noTeams")}</p>;
  }

  const chip = (on: boolean) =>
    `flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-[13px] font-semibold transition ${
      on
        ? "border-brand bg-surface text-brand-strong shadow-sm"
        : "border-transparent bg-surface/60 text-ink-2 hover:border-line-strong"
    }`;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="stay" value={stay ? "1" : "0"} />
      <input type="hidden" name="playbookId" value={playbookId} />
      <label className="sr-only" htmlFor="prompt">
        {t("whatYouNeed")}
      </label>
      <textarea
        id="prompt"
        name="prompt"
        required
        minLength={5}
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={placeholder ?? t("placeholder")}
        className="resize-y bg-transparent text-[17px] leading-relaxed outline-none"
      />
      <div className="flex flex-col gap-2.5 rounded-2xl bg-brand-wash p-3">
        <div className="flex flex-wrap items-end gap-3">
          {!defaultTeamId && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              {t("team")}
              <select
                name="teamId"
                value={teamId}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setPlaybookId(TEAM_DECIDES);
                }}
                className="h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm font-medium text-ink"
              >
                {teams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {defaultTeamId && <input type="hidden" name="teamId" value={teamId} />}
          <fieldset className="m-0 flex min-w-0 flex-[1_1_260px] flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 text-xs font-semibold text-muted">{t("kind")}</legend>
            <div className="flex flex-wrap gap-1.5">
              <label className={chip(playbookId === TEAM_DECIDES)}>
                <input
                  type="radio"
                  name="kindChoice"
                  className="sr-only"
                  checked={playbookId === TEAM_DECIDES}
                  onChange={() => setPlaybookId(TEAM_DECIDES)}
                />
                <span aria-hidden="true" className="mr-1.5 text-brand">
                  ✦
                </span>
                {t("teamDecides")}
              </label>
              {team?.playbooks.map((p) => (
                <label key={p.id} className={chip(playbookId === p.id)}>
                  <input
                    type="radio"
                    name="kindChoice"
                    className="sr-only"
                    checked={playbookId === p.id}
                    onChange={() => setPlaybookId(p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-xl bg-brand px-5 font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? tc("sending") : t("submit")}
          </button>
        </div>
        <span className="text-sm text-muted">
          {playbook ? playbook.description : t("teamDecidesHint")}
        </span>
      </div>

      {state.outOfScope && (
        <div
          role="alert"
          className="flex flex-col gap-2.5 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3"
        >
          <p className="text-sm text-ink">
            <strong>{t("outOfScope.title", { team: team?.name ?? "" })}</strong>
            {state.outOfScope.reason ? ` ${state.outOfScope.reason}` : ""}
          </p>
          {state.outOfScope.alternatives.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-muted">{t("outOfScope.tryInstead")}</span>
              {state.outOfScope.alternatives.map((a) => (
                <button
                  key={a.teamId}
                  type="submit"
                  name="sendTo"
                  value={a.teamId}
                  disabled={pending}
                  className="h-10 rounded-xl border border-line-strong bg-surface px-3.5 text-sm font-semibold text-ink hover:border-brand disabled:opacity-60"
                >
                  {a.agentName
                    ? t("outOfScope.sendToAgent", { team: a.teamName, agent: a.agentName })
                    : t("outOfScope.sendTo", { team: a.teamName })}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted">{t("outOfScope.noTeam")}</p>
          )}
        </div>
      )}
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
