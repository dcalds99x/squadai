"use client";

import {
  AGENT_STYLES,
  type AgentStyle,
  MODEL_TIERS,
  type ModelTier,
  type TierModels,
  TOOL_POLICIES,
  type ToolPolicy,
} from "@squadai/core";
import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { type ActionState, setToolPolicyAction, updateAgentAction } from "@/app/(office)/actions";

export function BrainForm({
  agent,
  canEdit,
  tierDefaults,
}: {
  agent: {
    id: string;
    name: string;
    tier: ModelTier;
    style: AgentStyle;
    model: string;
    fallbackModel: string;
    instructions: string;
  };
  canEdit: boolean;
  tierDefaults: Record<ModelTier, TierModels>;
}) {
  const t = useTranslations("agent.brain");
  const tc = useTranslations("common");
  const tTiers = useTranslations("tiers");
  const tStyles = useTranslations("styles");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState<ActionState, FormData>(updateAgentAction, {});
  const [tier, setTier] = useState(agent.tier);
  const tierDefault = tierDefaults[tier];
  const strong = (chunks: React.ReactNode) => <strong className="text-ink">{chunks}</strong>;
  const [advanced, setAdvanced] = useState(Boolean(agent.model || agent.fallbackModel));

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-[18px] border border-line bg-surface p-5"
    >
      <input type="hidden" name="agentId" value={agent.id} />
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-bold">{t("title")}</h2>
        <span className="text-sm text-muted">{t("intro", { name: agent.name })}</span>
      </div>

      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <div
          role="radiogroup"
          aria-label={t("profile")}
          className="grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1"
        >
          {MODEL_TIERS.map((value) => (
            <label
              key={value}
              className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-[13px] font-semibold ${
                tier === value ? "bg-surface text-brand-strong shadow-sm" : "text-muted"
              }`}
            >
              <input
                type="radio"
                name="tier"
                value={value}
                checked={tier === value}
                onChange={() => setTier(value)}
                className="sr-only"
              />
              {tTiers(value)}
            </label>
          ))}
        </div>
        <p className="text-[13px] text-muted">
          {tierDefault.fallback
            ? t.rich("usesWithFallback", {
                primary: tierDefault.primary.split(":")[1] ?? "",
                fallback: tierDefault.fallback.split(":")[1] ?? "",
                strong,
              })
            : t.rich("uses", { primary: tierDefault.primary.split(":")[1] ?? "", strong })}
        </p>

        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
          {t("style")}
          <select
            name="style"
            defaultValue={agent.style}
            className="h-11 rounded-xl border border-line-strong bg-[#F8F9FC] px-3 text-sm text-ink"
          >
            {AGENT_STYLES.map((value) => (
              <option key={value} value={value}>
                {tStyles(value)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="self-start text-sm font-semibold text-brand-strong"
        >
          {advanced ? t("hideCustom") : t("useCustom")}
        </button>
        <div className={advanced ? "flex flex-col gap-3" : "hidden"}>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
            {t("primary")}
            <input
              name="model"
              defaultValue={agent.model}
              placeholder={t("primaryPlaceholder")}
              className="h-11 rounded-xl border border-line-strong px-3 font-mono text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
            {t("fallback")}
            <input
              name="fallbackModel"
              defaultValue={agent.fallbackModel}
              placeholder={t("fallbackPlaceholder")}
              className="h-11 rounded-xl border border-line-strong px-3 font-mono text-sm text-ink"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
          {t("instructions")}
          <textarea
            name="instructions"
            rows={6}
            defaultValue={agent.instructions}
            className="resize-y rounded-xl border border-line-strong px-3 py-2.5 text-sm leading-relaxed font-normal text-ink"
          />
        </label>
      </fieldset>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60"
          >
            {pending ? tc("saving") : tc("save")}
          </button>
          {state.message && (
            <span role="status" className="text-sm text-ok">
              {state.message}
            </span>
          )}
          {state.error && (
            <span role="alert" className="text-sm text-warn">
              {state.error}
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-subtle">{te("managerOnly")}</p>
      )}
    </form>
  );
}

const POLICY_COLORS: Record<ToolPolicy, string> = {
  allow: "text-ok",
  ask: "text-warn",
  deny: "text-danger",
};

export function ToolPolicyRow({
  agentId,
  tool,
  label,
  policy,
  canEdit,
  note,
}: {
  agentId: string;
  tool: string;
  label: string;
  policy: ToolPolicy;
  canEdit: boolean;
  note?: string;
}) {
  const t = useTranslations("policies");
  const [current, setCurrent] = useState(policy);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-[#EEF0F6] border-t py-2">
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        {note && <span className="text-xs text-subtle">{note}</span>}
      </span>
      <fieldset
        className="flex gap-0.5 rounded-[10px] bg-canvas p-[3px]"
        disabled={!canEdit || pending}
      >
        <legend className="sr-only">{label}</legend>
        {TOOL_POLICIES.map((value) => {
          const on = value === current;
          return (
            <label
              key={value}
              className={`flex h-9 cursor-pointer items-center whitespace-nowrap rounded-lg px-2.5 text-[13px] font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[#B9B1FF] ${on ? `bg-surface shadow-sm ${POLICY_COLORS[value]}` : "text-muted"}`}
            >
              <input
                type="radio"
                name={`policy-${tool}`}
                value={value}
                checked={on}
                className="sr-only"
                onChange={() =>
                  start(async () => {
                    const previous = current;
                    setCurrent(value);
                    const result = await setToolPolicyAction(agentId, tool, value);
                    if (result.error) setCurrent(previous);
                  })
                }
              />
              {t(value)}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
