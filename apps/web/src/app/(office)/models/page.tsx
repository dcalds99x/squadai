import { DEFAULT_TIER_MODELS, MODEL_TIERS, PROVIDERS, workspaceLocale } from "@squadai/core";
import { getDb, getModelsPage, getOfficeMetrics } from "@squadai/db";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { getContentText } from "@/lib/content";
import { formatMoney, formatUsdMicros } from "@/lib/format";
import { modelOptions, PROVIDER_BRANDS } from "@/lib/model-options";
import { requireOffice } from "@/lib/session";
import { BudgetForm, DemoToggle, ProviderCard, TierForm, WorkspaceLocale } from "./forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("models"))("title") };
}

export default async function ModelsPage() {
  const { workspace } = await requireOffice();
  const [t, tTiers, locale] = await Promise.all([
    getTranslations("models"),
    getTranslations("tiers"),
    getLocale(),
  ]);
  const db = getDb();
  const [page, metrics] = await Promise.all([
    getModelsPage(db, workspace.id),
    getOfficeMetrics(db, workspace.id),
  ]);
  const canEdit = workspace.role !== "member";
  const text = await getContentText();
  const totalMicros = page.spendByTeam.reduce((s, t) => s + t.costMicros, 0);

  return (
    <main className="page">
      <header className="page-heading">
        <h1 className="page-title">{t("title")}</h1>
        <p className="page-intro">{t("intro")}</p>
      </header>

      <DemoToggle on={page.settings.demoMode === true} canEdit={canEdit} />
      <WorkspaceLocale locale={workspaceLocale(page.settings)} canEdit={canEdit} />

      <section aria-labelledby="h-prov" className="flex flex-col gap-3.5">
        <h2 id="h-prov" className="font-display text-xl font-bold">
          {t("providers")}
        </h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
          {PROVIDERS.map((p) => {
            const cred = page.credentials.find((c) => c.provider === p);
            return (
              <ProviderCard
                key={p}
                provider={p}
                info={{
                  ...PROVIDER_BRANDS[p],
                  name: PROVIDER_BRANDS[p].name ?? t("otherProvider"),
                  sub: t(`providerInfo.${p}`),
                }}
                canEdit={canEdit}
                connected={
                  cred
                    ? {
                        id: cred.id,
                        keyHint: cred.keyHint,
                        baseUrl: cred.baseUrl,
                        models: cred.models.length,
                      }
                    : null
                }
              />
            );
          })}
        </div>
      </section>

      <section aria-labelledby="h-perfis" className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 id="h-perfis" className="font-display text-xl font-bold">
            {t("tiersTitle")}
          </h2>
          <span className="text-sm text-muted">{t("tiersIntro")}</span>
        </div>
        <TierForm
          canEdit={canEdit}
          options={modelOptions(page.credentials, t("otherProvider"))}
          tiers={MODEL_TIERS.map((tier) => ({
            tier,
            label: tTiers(tier),
            primary: page.settings.tierModels?.[tier]?.primary ?? DEFAULT_TIER_MODELS[tier].primary,
            fallback:
              page.settings.tierModels?.[tier]?.fallback ??
              DEFAULT_TIER_MODELS[tier].fallback ??
              "",
          }))}
        />
      </section>

      <section
        aria-labelledby="h-orc"
        className="flex flex-wrap gap-7 rounded-[18px] border border-line bg-surface p-[22px]"
      >
        <div className="flex flex-[1_1_300px] flex-col gap-2.5">
          <h2 id="h-orc" className="font-display text-xl font-bold">
            {t("budget")}
          </h2>
          <div className="flex items-baseline gap-2">
            <strong className="font-display text-[34px]">
              {formatMoney(metrics.spendCents, "USD", locale)}
            </strong>
            <span className="text-muted">
              {metrics.budgetCents === null
                ? t("noLimit")
                : t("ofLimit", { limit: formatMoney(metrics.budgetCents, "USD", locale) })}
            </span>
          </div>
          {metrics.budgetUsed !== null && (
            <div className="h-2.5 overflow-hidden rounded-full bg-[#EEF0F6]">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(100, metrics.budgetUsed * 100)}%` }}
              />
            </div>
          )}
          <span className="text-xs text-subtle">{t("budgetNote")}</span>
          <BudgetForm canEdit={canEdit} monthly={page.budget?.monthlyLimitCents ?? null} />
        </div>
        <div className="flex flex-[1_1_300px] flex-col gap-2.5">
          <span className="text-sm font-semibold">{t("spendByTeam")}</span>
          {page.spendByTeam.length === 0 && <p className="text-sm text-muted">{t("noCalls")}</p>}
          {page.spendByTeam.map((spend) => (
            <div key={spend.teamName} className="flex flex-col gap-1">
              <div className="flex justify-between gap-3 text-sm">
                <span>{text.c(spend.teamName)}</span>
                <strong className="text-right">
                  {formatUsdMicros(spend.costMicros, locale)} · {t("calls", { count: spend.calls })}
                </strong>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#EEF0F6]">
                <div
                  className="h-full bg-brand"
                  style={{
                    width: `${totalMicros === 0 ? 0 : Math.round((spend.costMicros / totalMicros) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
