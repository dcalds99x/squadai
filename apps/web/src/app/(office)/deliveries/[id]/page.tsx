import { getDb, getDeliveryPage, schema } from "@squadai/db";
import { Avatar } from "@squadai/ui";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { cancelDeliveryAction, deleteDeliveryAction } from "@/app/(office)/actions";
import { ConfirmAction } from "@/components/confirm-action";
import { DecisionBar } from "@/components/decision-bar";
import { LiveRefresh } from "@/components/live-refresh";
import { Markdown } from "@/components/markdown";
import { StatusPill } from "@/components/status";
import { getContentText } from "@/lib/content";
import { env } from "@/lib/env";
import { formatTime, formatUsdMicros } from "@/lib/format";
import { requireOffice } from "@/lib/session";
import { ExportButtons } from "./export-buttons";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspace } = await requireOffice();
  const d = await getDeliveryPage(getDb(), workspace.id, (await params).id);
  return { title: d?.title ?? (await getTranslations("delivery"))("fallbackTitle") };
}

export default async function DeliveryPage({ params, searchParams }: Props) {
  const { workspace } = await requireOffice();
  const [t, tc, locale] = await Promise.all([
    getTranslations("delivery"),
    getTranslations("common"),
    getLocale(),
  ]);
  const tm = await getTranslations("delivery.manage");
  const money = (micros: number) => (micros === 0 ? t("free") : formatUsdMicros(micros, locale));
  const seconds = (ms: number) => tc("seconds", { seconds: Math.max(1, Math.round(ms / 1000)) });
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const { id } = await params;
  const { v } = await searchParams;
  const raw = await getDeliveryPage(getDb(), workspace.id, id);
  if (!raw) notFound();
  const text = await getContentText();
  const d = {
    ...raw,
    teamName: text.c(raw.teamName),
    kind: text.c(raw.kind),
    versions: raw.versions.map((v) => ({ ...v, label: text.version(v.label) })),
    credits: raw.credits.map((c) => ({ ...c, role: text.c(c.role) })),
  };
  const tz = env().SQUADAI_TIMEZONE;
  const [notion] = await getDb()
    .select({ id: schema.integration.id })
    .from(schema.integration)
    .where(
      and(eq(schema.integration.workspaceId, workspace.id), eq(schema.integration.kind, "notion")),
    );
  const hasNotion = Boolean(notion);

  const selected = d.versions.find((x) => String(x.number) === v) ?? d.versions.at(-1);
  const notes = selected ? d.notes.filter((n) => n.versionId === selected.id) : [];
  const status = d.requestStatus === "failed" && d.status === "in_progress" ? "failed" : d.status;
  const reviewer = d.credits.at(-1)?.agentName ?? t("reviewerFallback");
  const totalCost = d.credits.reduce((s, c) => s + c.costMicros, 0);
  const totalMs = d.credits.reduce((s, c) => s + c.latencyMs, 0);

  return (
    <div className="flex min-h-screen flex-wrap items-stretch lg:min-h-0 lg:flex-1 lg:flex-nowrap lg:overflow-hidden">
      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 px-6 py-7 sm:px-9 lg:overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/teams/${d.teamSlug}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold"
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
              <path d="M19 12H5m6-6-6 6 6 6" />
            </svg>
            {d.teamName}
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LiveRefresh teamId={d.teamId} deliveryId={d.id} />
            {(d.status === "in_progress" || d.status === "awaiting_approval") && (
              <ConfirmAction
                label={tm("cancel")}
                question={tm("cancelQuestion")}
                detail={tm("cancelDetail")}
                confirmLabel={tm("cancelConfirm")}
                keepLabel={tm("keep")}
                pendingLabel={tm("working")}
                run={cancelDeliveryAction.bind(null, d.id)}
              />
            )}
            <ConfirmAction
              danger
              label={tm("delete")}
              question={tm("deleteQuestion")}
              detail={tm("deleteDetail")}
              confirmLabel={tm("deleteConfirm")}
              keepLabel={tm("keep")}
              pendingLabel={tm("working")}
              run={deleteDeliveryAction.bind(null, d.id)}
            />
          </div>
        </div>

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold">
                {d.kind}
              </span>
              <StatusPill status={status} />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight">{d.title}</h1>
          </div>
          {d.versions.length > 0 && (
            <nav aria-label={t("versions")} className="flex flex-wrap gap-1.5">
              {d.versions.map((x) => {
                const on = x.id === selected?.id;
                return (
                  <Link
                    key={x.id}
                    href={`?v=${x.number}`}
                    aria-current={on ? "page" : undefined}
                    className={`inline-flex h-10 items-center rounded-full border px-3.5 text-[13px] font-semibold ${
                      on
                        ? "border-brand bg-brand-wash text-brand-strong"
                        : "border-line-strong bg-surface text-ink-2"
                    }`}
                  >
                    v{x.number} · {x.label.split(" · ")[0]}
                  </Link>
                );
              })}
            </nav>
          )}
        </header>

        <details className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">{t("prompt")}</summary>
          <p className="mt-2 whitespace-pre-line text-muted">{d.prompt}</p>
        </details>

        {selected ? (
          <article
            aria-label={t("text")}
            className="flex flex-wrap gap-8 rounded-[20px] border border-line bg-surface px-6 py-8 sm:px-10"
          >
            <div className="min-w-0 flex-[999_1_420px]">
              <Markdown>{selected.content}</Markdown>
            </div>
            {notes.length > 0 && (
              <aside aria-label={t("notes")} className="flex flex-[1_1_220px] flex-col gap-3">
                <span className="text-xs font-semibold tracking-wider text-muted uppercase">
                  {t("notes")}
                </span>
                {notes.map((n) => (
                  <div
                    key={`${n.anchor}-${n.body}`}
                    className="flex gap-2 rounded-xl border border-[#F5E1A4] bg-[#FFFBEA] p-3"
                  >
                    {n.avatar && (
                      <Avatar spec={n.avatar} name={n.agentName ?? ""} size={26} decorative />
                    )}
                    <div className="flex flex-col gap-1 text-[13px] leading-snug text-[#4A3A00]">
                      <q className="font-semibold text-ink">{n.anchor}</q>
                      <span>
                        <strong className="text-ink">{n.agentName}:</strong> {n.body}
                      </span>
                    </div>
                  </div>
                ))}
              </aside>
            )}
          </article>
        ) : (
          <p className="rounded-2xl border border-dashed border-line-strong bg-surface px-5 py-8 text-center text-muted">
            {t("inProgress")}
          </p>
        )}

        {d.status === "awaiting_approval" && (
          <DecisionBar deliveryId={d.id} reviewerName={reviewer} />
        )}
        {d.status === "delivered" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ok-soft px-5 py-3 text-ok">
            <span>{t.rich("delivered", { count: d.adjustmentCount, strong })}</span>
            <ExportButtons deliveryId={d.id} notion={hasNotion} />
          </div>
        )}
      </main>

      <aside
        aria-label={t("backstage")}
        className="flex max-w-full flex-[1_1_300px] flex-col gap-6 border-line border-l bg-surface px-5 py-6 lg:max-w-[360px] lg:overflow-y-auto"
      >
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] font-bold">{t("credits")}</h2>
          {d.credits.length === 0 && <p className="text-sm text-muted">{t("nobody")}</p>}
          {d.credits.map((c) => (
            <Link
              key={c.agentId}
              href={`/agents/${c.agentId}`}
              className="flex items-center gap-2.5"
            >
              <Avatar spec={c.avatar} name={c.agentName} size={36} decorative />
              <span className="flex flex-col">
                <span className="text-sm">
                  <strong>{c.agentName}</strong> · {c.role.toLowerCase()}
                </span>
                <span className="text-xs text-subtle">
                  {c.models} · {money(c.costMicros)} · {seconds(c.latencyMs)}
                </span>
              </span>
            </Link>
          ))}
          {d.credits.length > 0 && (
            <div className="flex justify-between rounded-xl bg-canvas px-3 py-2.5 text-[13px]">
              <span className="text-muted">{t("totalCost")}</span>
              <strong>
                {money(totalCost)} · {seconds(totalMs)}
              </strong>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] font-bold">{t("thread")}</h2>
          <ol className="flex flex-col gap-3">
            {d.thread.map((m) => (
              <li key={m.id} className="flex flex-col gap-1">
                <span className="text-xs text-subtle">
                  <strong className="text-ink">{m.agentName ?? m.userName ?? tc("system")}</strong>{" "}
                  · {formatTime(m.createdAt, tz, locale)}
                </span>
                <p className="rounded-[4px_14px_14px_14px] bg-canvas px-3 py-2.5 text-sm leading-relaxed">
                  {m.body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
