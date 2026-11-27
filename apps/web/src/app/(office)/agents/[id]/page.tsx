import { MODEL_TIERS, type ModelTier, type TierModels, tierModelsFor } from "@squadai/core";
import { getAgentProfile, getDb, getModelOptions, getPresence, schema } from "@squadai/db";
import { workspaceTools } from "@squadai/engine";
import { Avatar } from "@squadai/ui";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { StatusPill } from "@/components/status";
import { getContentText } from "@/lib/content";
import { formatPercent, formatUsdMicros } from "@/lib/format";
import { modelOptions } from "@/lib/model-options";
import { workspaceContext } from "@/lib/secrets";
import { requireOffice } from "@/lib/session";
import { toolLabel, toolUnavailableReason } from "@/lib/tool-labels";
import { BrainForm, ToolPolicyRow } from "./forms";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspace } = await requireOffice();
  const a = await getAgentProfile(getDb(), workspace.id, (await params).id);
  return { title: a?.name ?? (await getTranslations("agent"))("fallbackTitle") };
}

export default async function AgentPage({ params }: Props) {
  const { workspace } = await requireOffice();
  const [t, tc, tTools, tp, locale] = await Promise.all([
    getTranslations("agent"),
    getTranslations("common"),
    getTranslations("tools"),
    getTranslations("presence"),
    getLocale(),
  ]);
  const db = getDb();
  const { id } = await params;
  const [a, presence, connected, [ws]] = await Promise.all([
    getAgentProfile(db, workspace.id, id),
    getPresence(db, workspace.id),
    getModelOptions(db, workspace.id),
    db
      .select({ settings: schema.workspace.settings })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspace.id)),
  ]);
  const settings = ws?.settings ?? {};
  if (!a) notFound();
  const text = await getContentText();
  Object.assign(a, {
    role: text.c(a.role),
    bio: text.c(a.bio),
    prefers: text.c(a.prefers),
    never: text.c(a.never),
    teamName: text.c(a.teamName),
    skills: a.skills.map((s) => text.c(s)),
  });
  const otherTeams = (
    await db
      .select({ slug: schema.team.slug, name: schema.team.name })
      .from(schema.team)
      .where(eq(schema.team.workspaceId, workspace.id))
  ).filter((t) => t.slug !== a.teamSlug);
  // Labels and reasons come from the interface catalogs, in the person's language.
  const tools = workspaceTools(await workspaceContext(workspace.id), otherTeams, locale);
  const policies = new Map(a.tools.map((t) => [t.tool, t.policy]));
  const doing = presence.get(a.id);
  const canEdit = workspace.role !== "member";
  const firstPass =
    a.stats.delivered === 0 ? "—" : formatPercent(a.stats.firstPass / a.stats.delivered, locale);

  return (
    <main className="page">
      <Link
        href={`/teams/${a.teamSlug}`}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold"
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
        {a.teamName}
      </Link>

      <header
        className="flex flex-wrap items-center gap-7 rounded-3xl p-7"
        style={{ background: `${a.avatar.background}99` }}
      >
        <Avatar
          spec={a.avatar}
          name={a.name}
          size={128}
          presence={doing ? "working" : "free"}
          presenceLabel={tp(doing ? "working" : "free")}
        />
        <div className="flex flex-[1_1_360px] flex-col gap-2.5">
          <div>
            <h1 className="page-title">{a.name}</h1>
            <span className="text-muted">
              {t("roleOnTeam", { role: a.role, team: a.teamName })}
            </span>
          </div>
          <p className="max-w-xl text-[17px] leading-relaxed text-ink-2">“{a.bio}”</p>
          <span className={`text-sm font-semibold ${doing ? "text-ok" : "text-subtle"}`}>
            ● {doing ? t("workingOn", { title: doing.title }) : t("free")}
          </span>
        </div>
      </header>

      <section
        aria-label={t("stats")}
        className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5"
      >
        {[
          {
            label: t("delivered"),
            value: String(a.stats.delivered),
            note: t("deliveredNote"),
          },
          { label: t("firstPass"), value: firstPass, note: t("firstPassNote") },
          {
            label: t("avgTime"),
            value:
              a.stats.calls === 0
                ? "—"
                : tc("seconds", { seconds: Math.max(1, Math.round(a.stats.avgLatencyMs / 1000)) }),
            note: t("avgTimeNote"),
          },
          {
            label: t("cost"),
            value: formatUsdMicros(a.stats.costMicros, locale),
            note: t("costNote", { count: a.stats.calls }),
          },
        ].map((s) => (
          <div
            key={s.label}
            className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4"
          >
            <span className="text-[13px] font-semibold text-muted">{s.label}</span>
            <strong className="font-display text-[28px]">{s.value}</strong>
            <span className="text-[13px] text-subtle">{s.note}</span>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex flex-[1_1_420px] flex-col gap-5">
          <section
            aria-labelledby="h-jeito"
            className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-5"
          >
            <h2 id="h-jeito" className="font-display text-lg font-bold">
              {t("howTheyWork")}
            </h2>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-muted">{t("goodAt")}</span>
              <div className="flex flex-wrap gap-1.5">
                {a.skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-full px-3 py-1.5 text-[13px] font-medium"
                    style={{ background: `${a.avatar.background}` }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-muted">{t("prefers")}</span>
              <span className="text-sm leading-relaxed">{a.prefers}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-muted">{t("never")}</span>
              <span className="text-sm leading-relaxed">{a.never}</span>
            </div>
          </section>

          <section aria-labelledby="h-recentes" className="flex flex-col gap-2.5">
            <h2 id="h-recentes" className="font-display text-lg font-bold">
              {t("recent")}
            </h2>
            {a.recent.length === 0 && <p className="text-sm text-muted">{t("noRecent")}</p>}
            {a.recent.map((r) => (
              <Link
                key={r.id}
                href={`/deliveries/${r.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 hover:border-brand"
              >
                <strong className="text-[15px]">{r.title}</strong>
                <StatusPill status={r.status} />
              </Link>
            ))}
          </section>
        </div>

        <div className="flex flex-[1_1_360px] flex-col gap-5">
          <BrainForm
            canEdit={canEdit}
            agent={{
              id: a.id,
              name: a.name,
              tier: a.tier,
              style: a.style,
              model: a.model ?? "",
              fallbackModel: a.fallbackModel ?? "",
              instructions: a.instructions,
            }}
            tierDefaults={
              Object.fromEntries(
                MODEL_TIERS.map((tier) => [tier, tierModelsFor(settings, tier)]),
              ) as Record<ModelTier, TierModels>
            }
            options={modelOptions(connected, (await getTranslations("models"))("otherProvider"))}
          />

          <section
            aria-labelledby="h-perm"
            className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-5"
          >
            <div className="flex flex-col gap-1">
              <h2 id="h-perm" className="font-display text-lg font-bold">
                {t("canDo", { name: a.name })}
              </h2>
              <span className="text-sm text-muted">{t("canDoIntro")}</span>
            </div>
            {tools.map((tool) => (
              <ToolPolicyRow
                key={tool.name}
                agentId={a.id}
                tool={tool.name}
                label={toolLabel(tTools, tool.name)}
                policy={policies.get(tool.name) ?? tool.defaultPolicy}
                note={tool.available ? undefined : toolUnavailableReason(tTools, tool.name)}
                canEdit={canEdit}
              />
            ))}
            <p className="text-xs text-subtle">{t("policyHelp")}</p>
          </section>
        </div>
      </div>
    </main>
  );
}
