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
    <main className="page">
      <header className="page-header items-end">
        <div className="page-heading">
          <h1 className="page-title">{t("title")}</h1>
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
