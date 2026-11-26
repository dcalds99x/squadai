import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewRequest } from "./new-request";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("newRequest"))("title") };
}

export default async function NewRequestPage() {
  const t = await getTranslations("newRequest");
  return (
    <main className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 py-10 sm:px-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[30px] font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted">{t("intro")}</p>
      </header>
      <NewRequest />
    </main>
  );
}
