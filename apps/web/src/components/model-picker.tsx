"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

export interface ModelOption {
  provider: string;
  /** How people see the provider ("OpenAI"). */
  label: string;
  /** Models the provider offered at its last check. Empty when it isn't connected. */
  models: string[];
  connected: boolean;
}

const CUSTOM = "__custom__";

function split(ref: string): { provider: string; model: string } {
  const at = ref.indexOf(":");
  return at < 0
    ? { provider: "", model: "" }
    : { provider: ref.slice(0, at), model: ref.slice(at + 1) };
}

/**
 * Picks a model as provider → model, from what each connected provider offers.
 * "Custom…" still accepts any model id, for ones the list doesn't show.
 * Submits a single "provider:model" value (or "" for none) under `name`.
 */
export function ModelPicker({
  name,
  defaultValue,
  options,
  label,
  allowNone = false,
  disabled = false,
}: {
  name: string;
  defaultValue: string;
  options: ModelOption[];
  /** Accessible name, e.g. "Main model for the Economy profile". */
  label: string;
  allowNone?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("modelPicker");
  const id = useId();
  const initial = split(defaultValue);

  // Connected providers, plus a saved choice whose provider isn't connected (or not listed).
  const providers = useMemo(() => {
    const list = options.filter((o) => o.connected || o.provider === initial.provider);
    if (initial.provider && !list.some((o) => o.provider === initial.provider)) {
      list.push({
        provider: initial.provider,
        label: initial.provider,
        models: [],
        connected: false,
      });
    }
    return list;
  }, [options, initial.provider]);

  const [provider, setProvider] = useState(initial.provider);
  const current = providers.find((p) => p.provider === provider);
  const listed = current?.models ?? [];
  const [model, setModel] = useState(initial.model);
  const [custom, setCustom] = useState(Boolean(initial.model) && !listed.includes(initial.model));

  const value = provider && model ? `${provider}:${model}` : "";
  const field =
    "h-11 min-w-0 rounded-[10px] border border-line-strong bg-[#F8F9FC] px-3 text-[13px] text-ink disabled:opacity-60";

  return (
    <fieldset aria-label={label} className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
      <input type="hidden" name={name} value={value} />
      <label htmlFor={`${id}-p`} className="sr-only">
        {t("provider")}
      </label>
      <select
        id={`${id}-p`}
        value={provider}
        disabled={disabled}
        onChange={(e) => {
          const next = providers.find((p) => p.provider === e.target.value);
          setProvider(e.target.value);
          const first = next?.models[0] ?? "";
          setModel(first);
          setCustom(Boolean(next) && !first);
        }}
        className={`${field} flex-[0_1_190px]`}
      >
        {(allowNone || !provider) && (
          <option value="">{allowNone ? t("none") : t("chooseProvider")}</option>
        )}
        {providers.map((p) => (
          <option key={p.provider} value={p.provider}>
            {p.connected ? p.label : t("notConnected", { provider: p.label })}
          </option>
        ))}
      </select>

      {provider && !custom && (
        <>
          <label htmlFor={`${id}-m`} className="sr-only">
            {t("model")}
          </label>
          <select
            id={`${id}-m`}
            value={model}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value === CUSTOM) {
                setCustom(true);
                return;
              }
              setModel(e.target.value);
            }}
            className={`${field} flex-[1_1_180px] font-mono`}
          >
            {listed.length === 0 && <option value="">{t("noModels")}</option>}
            {listed.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={CUSTOM}>{t("custom")}</option>
          </select>
        </>
      )}

      {provider && custom && (
        <span className="flex flex-[1_1_180px] gap-1.5">
          <label htmlFor={`${id}-c`} className="sr-only">
            {t("model")}
          </label>
          <input
            id={`${id}-c`}
            value={model}
            disabled={disabled}
            onChange={(e) => setModel(e.target.value.trim())}
            placeholder={t("customPlaceholder")}
            className={`${field} flex-1 font-mono`}
          />
          {listed.length > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setCustom(false);
                if (!listed.includes(model)) setModel(listed[0] ?? "");
              }}
              className="h-11 shrink-0 px-2 text-[13px] font-semibold text-brand-strong"
            >
              {t("fromList")}
            </button>
          )}
        </span>
      )}
    </fieldset>
  );
}
