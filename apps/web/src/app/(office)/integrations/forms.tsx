"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import type { ActionState } from "../actions";
import { removeIntegrationAction, saveIntegrationAction } from "../actions-tools";

export function IntegrationCard({
  kind,
  title,
  subtitle,
  connected,
  canEdit,
}: {
  kind: "github" | "notion" | "mcp";
  title: string;
  subtitle: string;
  connected: { id: string; detail: string } | null;
  canEdit: boolean;
}) {
  const t = useTranslations("integrations");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveIntegrationAction, {});
  const [removing, startRemove] = useTransition();

  return (
    <article
      className={`flex flex-col gap-3 rounded-[18px] bg-surface p-[18px] ${open ? "border-2 border-brand" : "border border-line"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <strong>{title}</strong>
          <span className="truncate text-[13px] text-subtle">{subtitle}</span>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${connected ? "bg-ok-soft text-ok" : "bg-[#EEF0F6] text-ink-2"}`}
        >
          {connected ? tc("connected") : t("off")}
        </span>
      </div>
      {connected?.detail && <span className="text-[13px] text-muted">{connected.detail}</span>}

      {canEdit && !open && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`h-10 rounded-[10px] px-3.5 text-sm font-semibold ${connected ? "border border-line-strong" : "bg-brand text-white"}`}
          >
            {connected ? (kind === "mcp" ? t("update") : t("changeToken")) : tc("connect")}
          </button>
          {connected && (
            <button
              type="button"
              disabled={removing}
              onClick={() =>
                startRemove(async () => void (await removeIntegrationAction(connected.id)))
              }
              className="h-10 px-3 text-sm font-semibold text-muted"
            >
              {tc("remove")}
            </button>
          )}
        </div>
      )}

      {open && (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="kind" value={kind} />
          {kind === "mcp" && (
            <>
              <Field
                label={t("name")}
                name="name"
                defaultValue={connected ? title : ""}
                placeholder={t("namePlaceholder")}
              />
              <Field
                label={t("url")}
                name="url"
                defaultValue={connected ? subtitle : ""}
                placeholder="https://…/mcp"
              />
            </>
          )}
          <Field
            label={
              kind === "mcp"
                ? t("tokenOptional")
                : kind === "github"
                  ? t("githubToken")
                  : t("notionToken")
            }
            name="secret"
            type="password"
          />
          {kind === "notion" && (
            <Field
              label={t("notionPage")}
              name="parentPageId"
              placeholder="https://www.notion.so/…"
            />
          )}
          <span className="text-xs text-subtle">{t("note")}</span>
          {state.error && (
            <p role="alert" className="text-sm text-warn">
              {state.error}
            </p>
          )}
          {state.message && (
            <p role="status" className="text-sm text-ok">
              {state.message}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? tc("testing") : tc("testAndSave")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-10 px-3 text-sm font-semibold text-muted"
            >
              {tc("close")}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {props.label}
      <input
        name={props.name}
        type={props.type ?? "text"}
        autoComplete="off"
        placeholder={props.placeholder}
        defaultValue={props.defaultValue}
        className="h-11 rounded-[10px] border border-line-strong px-3 font-normal"
      />
    </label>
  );
}
