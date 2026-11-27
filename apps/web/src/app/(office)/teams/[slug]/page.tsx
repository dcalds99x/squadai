import { getDb, getRequestOptions, getTeamBoard } from "@squadai/db";
import { Avatar } from "@squadai/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { deleteTeamAction } from "@/app/(office)/actions";
import { ConfirmAction } from "@/components/confirm-action";
import { FlowDiagram, flowNodes } from "@/components/flow-diagram";
import { LiveRefresh } from "@/components/live-refresh";
import { RequestForm } from "@/components/request-form";
import { Room } from "@/components/room";
import { getContentText, localizeOptions } from "@/lib/content";
import { env } from "@/lib/env";
import { requireOffice } from "@/lib/session";
import { RetryButton } from "./retry-button";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspace } = await requireOffice();
  const team = await getTeamBoard(getDb(), workspace.id, (await params).slug);
  if (!team) return { title: (await getTranslations("team"))("fallbackTitle") };
  return { title: (await getContentText()).c(team.name) };
}

export default async function TeamPage({ params }: Props) {
  const { user, workspace } = await requireOffice();
  const t = await getTranslations("team");
  const db = getDb();
  const [raw, rawOptions, text] = await Promise.all([
    getTeamBoard(db, workspace.id, (await params).slug),
    getRequestOptions(db, workspace.id),
    getContentText(),
  ]);
  if (!raw) notFound();
  const team = {
    ...raw,
    name: text.c(raw.name),
    department: text.c(raw.department),
    description: text.c(raw.description),
    agents: raw.agents.map((a) => ({ ...a, role: text.c(a.role), bio: text.c(a.bio) })),
    playbooks: raw.playbooks.map((p) => ({
      ...p,
      name: text.c(p.name),
      description: text.c(p.description),
    })),
    deliveries: raw.deliveries.map((d) => ({ ...d, kind: text.c(d.kind) })),
  };
  const options = localizeOptions(rawOptions, text);
  const tz = env().SQUADAI_TIMEZONE;
  const teamOptions = options.filter((o) => o.id === team.id);
  const agentByKey = new Map(team.agents.map((a) => [a.key, a]));
  const nameOf = (key: string) => agentByKey.get(key)?.name ?? key;
  const lead = agentByKey.get(team.leadKey ?? "") ?? team.agents[0];

  const columns = [
    {
      title: t("columns.inProgress"),
      bg: "bg-[#EEF0F6]",
      items: team.deliveries.filter((d) => d.status === "in_progress"),
      empty: t("columns.inProgressEmpty"),
    },
    {
      title: t("columns.review"),
      bg: "bg-brand-wash",
      items: team.deliveries.filter((d) => d.status === "awaiting_approval"),
      empty: t("columns.reviewEmpty"),
    },
    {
      title: t("columns.delivered"),
      bg: "bg-[#EEF0F6]",
      items: team.deliveries.filter((d) => d.status === "delivered"),
      empty: t("columns.deliveredEmpty"),
    },
  ];
  const working = team.agents.filter((a) => team.presence.has(a.id)).map((a) => a.name);

  return (
    <div className="flex min-h-screen flex-wrap items-stretch lg:min-h-0 lg:flex-1 lg:flex-nowrap lg:overflow-hidden">
      <main className="min-w-0 flex-[999_1_560px] lg:overflow-y-auto">
        <div className="page">
          <header className="page-header">
            <div className="page-heading">
              <span className="page-eyebrow">{team.department}</span>
              <h1 className="page-title">{team.name}</h1>
              <p className="page-intro">{team.description}</p>
            </div>
            <div className="flex items-center gap-3">
              <LiveRefresh teamId={team.id} />
              {workspace.role !== "member" && (
                <ConfirmAction
                  danger
                  label={t("remove.label")}
                  question={t("remove.question", { team: team.name })}
                  detail={t("remove.detail")}
                  confirmLabel={t("remove.confirm")}
                  keepLabel={t("remove.keep")}
                  pendingLabel={t("remove.working")}
                  run={deleteTeamAction.bind(null, team.id)}
                />
              )}
            </div>
          </header>

          <ul aria-label={t("people")} className="flex flex-wrap gap-2.5">
            {team.agents.map((a) => {
              const doing = team.presence.get(a.id);
              return (
                <li key={a.id}>
                  <Link
                    href={`/agents/${a.id}`}
                    className="flex items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pr-3.5 pl-1.5 hover:border-brand"
                  >
                    <Avatar
                      spec={a.avatar}
                      name={a.name}
                      size={36}
                      presence={doing ? "working" : "free"}
                      decorative
                    />
                    <span className="flex flex-col">
                      <strong className="text-sm">{a.name}</strong>
                      <span className="text-xs text-subtle">{doing ? t("working") : a.role}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <section
            aria-label={t("newRequest")}
            className="rounded-[20px] border border-line bg-surface p-5"
          >
            <RequestForm
              teams={teamOptions}
              defaultTeamId={team.id}
              stay
              placeholder={t("placeholder", { team: team.name })}
            />
          </section>

          <section
            aria-label={t("deliveries")}
            className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] items-start gap-4"
          >
            {columns.map((c) => (
              <div key={c.title} className={`flex flex-col gap-3 rounded-[18px] p-3 ${c.bg}`}>
                <div className="flex items-center justify-between px-1">
                  <strong className="text-sm">{c.title}</strong>
                  <span className="text-[13px] text-muted">{c.items.length}</span>
                </div>
                {c.items.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-line-strong px-3 py-4 text-[13px] text-muted">
                    {c.empty}
                  </p>
                )}
                {c.items.map((d) => {
                  const failed = d.requestStatus === "failed";
                  const highlight = d.status === "awaiting_approval";
                  return (
                    <article
                      key={d.id}
                      className={`flex flex-col gap-2 rounded-[14px] bg-surface p-3.5 ${
                        highlight
                          ? "border-2 border-brand shadow-[0_6px_18px_rgba(91,76,240,0.14)]"
                          : "border border-line"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-ink-2">
                          {d.kind}
                        </span>
                        <span className="text-xs text-subtle">
                          {t("versions", { count: d.versions })}
                        </span>
                      </div>
                      <Link
                        href={`/deliveries/${d.id}`}
                        className="text-[15px] leading-snug font-bold text-ink hover:underline"
                      >
                        {d.title}
                      </Link>
                      {failed ? (
                        <div className="flex flex-col gap-2 rounded-xl bg-[#FDECEC] p-2.5 text-[13px] text-danger">
                          <span>{d.error ?? t("stuck")}</span>
                          <RetryButton requestId={d.requestId} />
                        </div>
                      ) : (
                        <span
                          className={`text-[13px] font-medium ${highlight ? "text-warn" : d.status === "delivered" ? "text-ok" : "text-brand-strong"}`}
                        >
                          {d.status === "awaiting_approval"
                            ? t("state.waiting")
                            : d.status === "delivered"
                              ? d.adjustmentCount === 0
                                ? t("state.firstPass")
                                : t("state.afterChanges", { count: d.adjustmentCount })
                              : d.requestStatus === "queued"
                                ? t("state.queued")
                                : t("state.working")}
                        </span>
                      )}
                    </article>
                  );
                })}
              </div>
            ))}
          </section>

          <section aria-labelledby="h-como" className="flex flex-col gap-3">
            <h2 id="h-como" className="font-display text-lg font-bold">
              {t("howWeWork")}
            </h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
              <div className="flex flex-col gap-2.5 rounded-2xl border border-brand/40 bg-surface p-4">
                <strong className="text-[15px]">{t("openRequest")}</strong>
                <span className="text-[13px] leading-snug text-muted">
                  {t("openRequestHint", { lead: lead?.name ?? "" })}
                </span>
                <FlowDiagram
                  label={t("openRequest")}
                  nodes={flowNodes({ mode: "adaptive", lead: lead?.name ?? "" }, nameOf)}
                  approval
                />
              </div>
              {team.playbooks.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4"
                >
                  <strong className="text-[15px]">{p.name}</strong>
                  <span className="text-[13px] leading-snug text-muted">{p.description}</span>
                  <FlowDiagram
                    label={p.name}
                    nodes={flowNodes(p, nameOf)}
                    approval={p.requiresApproval}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <Room
        teamId={team.id}
        messages={team.messages}
        people={team.agents.length}
        working={working}
        timeZone={tz}
        agents={team.agents.map((a) => ({ name: a.name, avatar: a.avatar }))}
        activity={team.agents.flatMap((a) => {
          const doing = team.presence.get(a.id);
          return doing ? [{ name: a.name, avatar: a.avatar, task: text.c(doing.task) }] : [];
        })}
        userName={user.name}
      />
    </div>
  );
}
