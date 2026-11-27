"use client";

import { LOCALE_NAMES, LOCALES, type Locale, type Provider } from "@squadai/core";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import {
  type ActionState,
  refreshProviderModelsAction,
  removeProviderAction,
  saveBudgetAction,
  saveProviderAction,
  saveTierModelsAction,
  setDemoModeAction,
  setWorkspaceLocaleAction,
} from "@/app/(office)/actions";
import { type ModelOption, ModelPicker } from "@/components/model-picker";
import { formatDecimalInput } from "@/lib/format";

function Feedback({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p role="alert" className="text-sm text-warn">
        {state.error}
      </p>
    );
  if (state.message)
    return (
      <p role="status" className="text-sm text-ok">
        {state.message}
      </p>
    );
  return null;
}

export function DemoToggle({ on, canEdit }: { on: boolean; canEdit: boolean }) {
  const t = useTranslations("models.demo");
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  return (
    <section
      aria-label={t("title")}
      className={`flex items-center gap-4 rounded-[18px] border p-5 ${value ? "border-brand bg-brand-wash" : "border-line bg-surface"}`}
    >
      <div className="flex flex-1 flex-col gap-1">
        <strong>{t("title")}</strong>
        <span className="text-sm leading-relaxed text-muted">{t("body")}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={t("title")}
        disabled={!canEdit || pending}
        onClick={() =>
          start(async () => {
            setValue(!value);
            const result = await setDemoModeAction(!value);
            if (result.error) setValue(value);
          })
        }
        className={`flex h-8 w-14 shrink-0 items-center rounded-full p-[3px] transition ${value ? "justify-end bg-brand" : "justify-start bg-[#B6BBCC]"}`}
      >
        <span className="size-[26px] rounded-full bg-white shadow" />
      </button>
    </section>
  );
}

/** The language agents work in, for the whole office. Each person picks their own interface language. */
export function WorkspaceLocale({ locale, canEdit }: { locale: Locale; canEdit: boolean }) {
  const t = useTranslations("models.workspaceLanguage");
  const [value, setValue] = useState(locale);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section
      aria-labelledby="h-workspace-locale"
      className="flex flex-wrap items-center gap-4 rounded-[18px] border border-line bg-surface p-5"
    >
      <div className="flex flex-[1_1_320px] flex-col gap-1">
        <strong id="h-workspace-locale">{t("title")}</strong>
        <span className="text-sm leading-relaxed text-muted">{t("body")}</span>
        {error && (
          <span role="alert" className="text-sm text-warn">
            {error}
          </span>
        )}
      </div>
      <select
        aria-labelledby="h-workspace-locale"
        value={value}
        disabled={!canEdit || pending}
        onChange={(e) => {
          const previous = value;
          const next = e.target.value as Locale;
          setValue(next);
          start(async () => {
            const result = await setWorkspaceLocaleAction(next);
            setError(result.error ?? null);
            if (result.error) setValue(previous);
          });
        }}
        className="h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm font-medium text-ink disabled:opacity-60"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </section>
  );
}

const NEEDS_URL: Provider[] = ["ollama", "openai-compatible"];
const KEY_OPTIONAL: Provider[] = ["ollama", "openai-compatible"];

export function ProviderCard({
  provider,
  info,
  connected,
  canEdit,
}: {
  provider: Provider;
  info: { name: string; sub: string; initial: string; bg: string };
  connected: {
    id: string;
    keyHint: string | null;
    baseUrl: string | null;
    models: number;
  } | null;
  canEdit: boolean;
}) {
  const t = useTranslations("models");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProviderAction, {});
  const [removing, startRemove] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [refreshed, setRefreshed] = useState<ActionState>({});

  return (
    <article
      className={`flex flex-col gap-3.5 rounded-[18px] bg-surface p-[18px] ${open ? "border-2 border-brand" : "border border-line"}`}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid size-10 place-items-center rounded-xl font-bold"
          style={{ background: info.bg }}
        >
          {info.initial}
        </span>
        <div className="flex flex-1 flex-col">
          <strong>{info.name}</strong>
          <span className="text-[13px] text-subtle">{info.sub}</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${connected ? "bg-ok-soft text-ok" : "bg-[#EEF0F6] text-ink-2"}`}
        >
          {connected ? tc("connected") : t("notConnected")}
        </span>
      </div>

      {connected && (
        <span className="text-[13px] text-muted">
          {connected.keyHint ? t("keyHint", { hint: connected.keyHint }) : t("noKey")}
          {connected.baseUrl ? ` · ${connected.baseUrl}` : ""}
          {" · "}
          {t("modelCount", { count: connected.models })}
        </span>
      )}
      {connected && <Feedback state={refreshed} />}

      {canEdit && !open && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`h-11 rounded-[10px] px-3.5 text-sm font-semibold ${connected ? "border border-line-strong bg-surface" : "bg-brand text-white"}`}
          >
            {connected ? t("changeKey") : tc("connect")}
          </button>
          {connected && (
            <button
              type="button"
              disabled={refreshing}
              onClick={() =>
                startRefresh(async () =>
                  setRefreshed(await refreshProviderModelsAction(connected.id)),
                )
              }
              className="h-11 px-3.5 text-sm font-semibold text-brand-strong disabled:opacity-60"
            >
              {refreshing ? t("refreshing") : t("refreshModels")}
            </button>
          )}
          {connected && (
            <button
              type="button"
              disabled={removing}
              onClick={() =>
                startRemove(async () => void (await removeProviderAction(connected.id)))
              }
              className="h-11 px-3.5 text-sm font-semibold text-muted"
            >
              {removing ? tc("removing") : tc("remove")}
            </button>
          )}
        </div>
      )}

      {open && (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="provider" value={provider} />
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t("apiKey")}
            {KEY_OPTIONAL.includes(provider) ? t("optional") : ""}
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder={t("keyPlaceholder")}
              className="h-11 rounded-[10px] border border-line-strong px-3 font-normal"
            />
          </label>
          {(NEEDS_URL.includes(provider) || provider === "openrouter" || provider === "openai") && (
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              {t("baseUrl")}
              {NEEDS_URL.includes(provider) && provider === "openai-compatible"
                ? ""
                : t("optional")}
              <input
                name="baseUrl"
                placeholder={provider === "ollama" ? "http://localhost:11434/v1" : "https://…/v1"}
                className="h-11 rounded-[10px] border border-line-strong px-3 font-normal"
              />
            </label>
          )}
          <span className="text-[13px] text-subtle">{t("keyNote")}</span>
          <Feedback state={state} />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="h-11 rounded-xl bg-brand px-[18px] text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? tc("testing") : tc("testAndSave")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-11 px-3.5 text-sm font-semibold text-muted"
            >
              {tc("cancel")}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

export function TierForm({
  tiers,
  options,
  canEdit,
}: {
  tiers: { tier: string; label: string; primary: string; fallback: string }[];
  options: ModelOption[];
  canEdit: boolean;
}) {
  const t = useTranslations("models");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTierModelsAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-[18px] border border-line bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-subtle">
              <th scope="col" className="px-5 py-3.5 font-semibold">
                {t("profile")}
              </th>
              <th scope="col" className="px-5 py-3.5 font-semibold">
                {t("primary")}
              </th>
              <th scope="col" className="px-5 py-3.5 font-semibold">
                {t("fallback")}
              </th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.tier} className="border-[#EEF0F6] border-t">
                <th scope="row" className="px-5 py-3 text-left font-semibold">
                  {tier.label}
                </th>
                <td className="px-5 py-3">
                  <ModelPicker
                    label={t("primaryLabel", { tier: tier.label })}
                    name={`${tier.tier}.primary`}
                    defaultValue={tier.primary}
                    options={options}
                    disabled={!canEdit}
                  />
                </td>
                <td className="px-5 py-3">
                  <ModelPicker
                    label={t("fallbackLabel", { tier: tier.label })}
                    name={`${tier.tier}.fallback`}
                    defaultValue={tier.fallback}
                    options={options}
                    allowNone
                    disabled={!canEdit}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60"
          >
            {pending ? tc("saving") : t("saveModels")}
          </button>
          <Feedback state={state} />
        </div>
      )}
    </form>
  );
}

export function BudgetForm({ monthly, canEdit }: { monthly: number | null; canEdit: boolean }) {
  const t = useTranslations("models");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBudgetAction, {});
  if (!canEdit) return null;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {t("monthlyLimit")}
        <input
          name="monthly"
          inputMode="decimal"
          defaultValue={monthly === null ? "" : formatDecimalInput(monthly / 100, locale)}
          placeholder={t("noLimitPlaceholder")}
          className="h-11 w-36 rounded-[10px] border border-line-strong px-3 font-normal"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? tc("saving") : tc("save")}
      </button>
      <Feedback state={state} />
    </form>
  );
}
