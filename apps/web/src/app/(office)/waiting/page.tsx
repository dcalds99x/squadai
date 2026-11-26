import { getDb, getPendingApprovals } from "@squadai/db";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LiveRefresh } from "@/components/live-refresh";
import { PendingList } from "@/components/pending-list";
import { getContentText } from "@/lib/content";
import { requireOffice } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("waiting"))("title") };
}

export default async function WaitingPage() {
  const { workspace } = await requireOffice();
  const t = await getTranslations("waiting");
  const text = await getContentText();
  const pending = (await getPendingApprovals(getDb(), workspace.id)).map((p) => ({
    ...p,
    teamName: text.c(p.teamName),
    kind: text.c(p.kind),
  }));
  return (
    <main className="mx-auto flex max-w-[900px] flex-col gap-6 px-6 py-9 sm:px-11">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[34px] font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted">
            {pending.length === 0 ? t("allClear") : t("count", { count: pending.length })}
          </p>
        </div>
        <LiveRefresh />
      </header>
      <PendingList items={pending} now={new Date()} />
    </main>
  );
}
