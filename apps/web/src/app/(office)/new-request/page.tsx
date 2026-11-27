import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewRequest } from "./new-request";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("newRequest"))("title") };
}

export default async function NewRequestPage() {
  const t = await getTranslations("newRequest");
  return (
    <main className="page">
      <header className="page-heading">
        <h1 className="page-title">{t("title")}</h1>
        <p className="page-intro">{t("intro")}</p>
      </header>
      <div className="page-narrow">
        <NewRequest />
      </div>
    </main>
  );
}
