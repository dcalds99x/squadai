import {
  getAttention,
  getDb,
  getOfficeMetrics,
  getPresence,
  getRecentActivity,
  getTeamStats,
  getTeamsWithAgents,
  getWeekSeries,
} from "@squadai/db";
import { Avatar, AvatarStack } from "@squadai/ui";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Meter, Ring, Sparkbars } from "@/components/kpi";
import { LiveRefresh } from "@/components/live-refresh";
import { getContentText } from "@/lib/content";
import { env } from "@/lib/env";
import {
  dayPeriod,
  firstName,
  formatDuration,
  formatMoney,
  formatPercent,
  formatTime,
  longDate,
} from "@/lib/format";
import { requireOffice } from "@/lib/session";

/**
 * Home: a hub, not a form. Four numbers, what needs you, your teams and
 * what just happened. Everything links somewhere; nothing needs a paragraph.
 */
export default async function HomePage() {
  const { user, workspace } = await requireOffice();
  const [t, tp, locale] = await Promise.all([
    getTranslations("home"),
    getTranslations("presence"),
    getLocale(),
  ]);
  const db = getDb();
  const now = new Date();
  const tz = env().SQUADAI_TIMEZONE;
  const [metrics, week, attention, teams, stats, presence, activity] = await Promise.all([
    getOfficeMetrics(db, workspace.id, now),
    getWeekSeries(db, workspace.id, now),
    getAttention(db, workspace.id),
    getTeamsWithAgents(db, workspace.id),
    getTeamStats(db, workspace.id, now),
    getPresence(db, workspace.id),
    getRecentActivity(db, workspace.id, 6),
  ]);
  const text = await getContentText();

  const usd = (cents: number) => formatMoney(cents, "USD", locale);
  const ago = (d: Date) =>
    formatDuration(Math.max(1, Math.floor((now.getTime() - d.getTime()) / 60_000)), locale);
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;

  const alerts: {
    tone: "warn" | "danger" | "info";
    text: ReactNode;
    href?: string;
    cta?: string;
  }[] = [];
  if (attention.deliveryApprovals > 0) {
    alerts.push({
      tone: "warn",
      text: (
        <>
          {t.rich("alerts.deliveries", { count: attention.deliveryApprovals, strong })}
          {attention.oldestApproval && (
            <span className="text-subtle">
              {t("alerts.age", { age: ago(attention.oldestApproval) })}
            </span>
          )}
        </>
      ),
      href: "/waiting",
      cta: t("alerts.review"),
    });
  }
  if (attention.toolApprovals > 0) {
    alerts.push({
      tone: "warn",
      text: t.rich("alerts.tools", { count: attention.toolApprovals, strong }),
      href: "/waiting",
      cta: t("alerts.decide"),
    });
  }
  for (const f of attention.failed.slice(0, 2)) {
    alerts.push({
      tone: "danger",
      text: (
        <>
          {t.rich("alerts.failed", { team: text.c(f.teamName), strong })}{" "}
          <span className="text-subtle">· {f.error ?? t("alerts.unknownError")}</span>
        </>
      ),
      href: `/teams/${f.teamSlug}`,
      cta: t("alerts.view"),
    });
  }
  if (metrics.budgetUsed !== null && metrics.budgetUsed >= 0.8) {
    alerts.push({
      tone: metrics.budgetUsed >= 1 ? "danger" : "warn",
      text: t.rich("alerts.budget", {
        percent: formatPercent(metrics.budgetUsed, locale),
        strong,
      }),
      href: "/models",
      cta: t("alerts.adjust"),
    });
  }
  if (attention.noModels) {
    alerts.push({
      tone: "warn",
      text: t("alerts.noModels"),
      href: "/models",
      cta: (await getTranslations("common"))("connect"),
    });
  }
  for (const h of attention.handoffs.slice(0, 2)) {
    alerts.push({
      tone: "info",
      text: t.rich("alerts.handoff", { from: text.c(h.from), to: text.c(h.to), strong }),
    });
  }

  const busyIds = new Set(presence.keys());
  const deliveredWeek = week.reduce((s, d) => s + d.count, 0);

  return (
    <main className="mx-auto flex max-w-[1120px] flex-col gap-6 px-6 py-8 sm:px-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-[28px] font-bold tracking-tight">
          {t(`greeting.${dayPeriod(now, tz)}`, { name: firstName(user.name) })}
        </h1>
        <div className="flex items-center gap-4 text-sm text-subtle">
          <span>{longDate(now, tz, locale)}</span>
          {attention.demoMode && (
            <Link
              href="/models"
              className="rounded-full bg-brand-wash px-2.5 py-1 text-xs font-semibold text-brand-strong"
            >
              {t("demoMode")}
            </Link>
          )}
          <LiveRefresh />
        </div>
      </header>

      <section
        aria-label={t("pulse")}
        className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-px overflow-hidden rounded-[18px] border border-line bg-line"
      >
        <Kpi
          label={t("delivered.label")}
          hint={t("delivered.hint")}
          value={String(deliveredWeek)}
          visual={
            <Sparkbars
              values={week.map((d) => d.count)}
              label={t("delivered.chart", { values: week.map((d) => d.count).join(", ") })}
            />
          }
        />
        <Kpi
          label={t("firstPass.label")}
          hint={t("firstPass.hint")}
          value={
            metrics.firstPassRate === null ? "—" : formatPercent(metrics.firstPassRate, locale)
          }
          visual={<Ring value={metrics.firstPassRate} label={t("firstPass.ring")} />}
        />
        <Kpi
          label={t("timeSaved.label")}
          hint={t("timeSaved.hint")}
          value={metrics.minutesSaved === 0 ? "—" : formatDuration(metrics.minutesSaved, locale)}
        />
        <Kpi
          label={t("spend.label")}
          hint={
            metrics.budgetCents === null
              ? t("spend.noLimit")
              : t("spend.limit", { limit: usd(metrics.budgetCents) })
          }
          value={usd(metrics.spendCents)}
          visual={<Meter value={metrics.budgetUsed} label={t("spend.meter")} />}
        />
      </section>

      <section aria-labelledby="h-avisos" className="flex flex-col gap-2">
        <h2 id="h-avisos" className="text-xs font-semibold tracking-wider text-subtle uppercase">
          {t("attention")}
        </h2>
        {alerts.length === 0 ? (
          <p className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ok">
            <span aria-hidden="true">✓</span> {t("allClear")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[#EEF0F6] rounded-2xl border border-line bg-surface">
            {alerts.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: alerts are rebuilt on every render
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${a.tone === "danger" ? "bg-danger" : a.tone === "warn" ? "bg-[#F59E0B]" : "bg-brand"}`}
                />
                <span className="min-w-0 flex-1">{a.text}</span>
                {a.href && a.cta && (
                  <Link
                    href={a.href}
                    className="inline-flex min-h-9 items-center rounded-lg px-3 font-semibold text-brand-strong hover:bg-brand-wash"
                  >
                    {a.cta}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <section aria-labelledby="h-times" className="flex min-w-0 flex-[3_1_460px] flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 id="h-times" className="text-xs font-semibold tracking-wider text-subtle uppercase">
              {t("teams")}
            </h2>
            <Link href="/hire" className="text-sm font-semibold">
              {t("hire")}
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-[#EEF0F6] rounded-2xl border border-line bg-surface">
            {teams.map((team) => {
              const s = stats.get(team.id);
              const working = team.agents.some((a) => busyIds.has(a.id));
              const status =
                (s?.waiting ?? 0) > 0
                  ? [t("teamStatus.waiting"), "bg-warn-soft text-warn"]
                  : working
                    ? [t("teamStatus.working"), "bg-ok-soft text-ok"]
                    : [t("teamStatus.free"), "bg-[#EEF0F6] text-ink-2"];
              const firstPass =
                s && s.delivered > 0 ? formatPercent(s.firstPass / s.delivered, locale) : "—";
              return (
                <li key={team.id}>
                  <Link
                    href={`/teams/${team.slug}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-canvas"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-[3px]"
                      style={{ background: team.color }}
                    />
                    <span className="flex min-w-0 flex-[1_1_140px] flex-col">
                      <strong className="truncate text-[15px]">{text.c(team.name)}</strong>
                      <span className="text-xs text-subtle">{text.c(team.department)}</span>
                    </span>
                    <AvatarStack
                      people={team.agents.map((a) => {
                        const presence = busyIds.has(a.id) ? "working" : "free";
                        return {
                          name: a.name,
                          spec: a.avatar,
                          presence,
                          presenceLabel: tp(presence),
                        };
                      })}
                      size={28}
                    />
                    <span
                      className="w-20 text-right text-xs text-muted tabular-nums"
                      title={t("teamStats")}
                    >
                      {s?.delivered ?? 0} · {firstPass}
                    </span>
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-center text-xs font-semibold ${status[1]}`}
                    >
                      {status[0]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="h-agora" className="flex min-w-0 flex-[2_1_300px] flex-col gap-2">
          <h2 id="h-agora" className="text-xs font-semibold tracking-wider text-subtle uppercase">
            {t("activity")}
          </h2>
          {activity.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">
              {t("activityEmpty")}
            </p>
          ) : (
            <ol className="flex flex-col gap-0.5 rounded-2xl border border-line bg-surface p-2">
              {activity.map((m) => (
                <li key={m.id}>
                  <Link
                    href={
                      typeof m.payload?.deliveryId === "string"
                        ? `/deliveries/${m.payload.deliveryId}`
                        : `/teams/${m.teamSlug}`
                    }
                    className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-canvas"
                  >
                    <Avatar
                      spec={m.avatar}
                      name={m.agentName}
                      size={28}
                      presence={busyIds.has(m.agentId) ? "working" : undefined}
                      decorative
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      <strong>{m.agentName}</strong> <span className="text-ink-2">{m.body}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-subtle tabular-nums">
                      {formatTime(m.createdAt, tz, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}

function Kpi({
  label,
  hint,
  value,
  visual,
}: {
  label: string;
  hint: string;
  value: string;
  visual?: ReactNode;
}) {
  return (
    <div
      title={hint}
      className="flex min-w-0 items-center justify-between gap-3 bg-surface px-5 py-4"
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-semibold whitespace-nowrap text-subtle">
          {label}
        </span>
        <strong className="font-display text-[26px] leading-tight tracking-tight whitespace-nowrap">
          {value}
        </strong>
      </div>
      {visual}
    </div>
  );
}
