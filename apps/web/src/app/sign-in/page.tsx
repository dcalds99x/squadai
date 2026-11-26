import { STARTER_TEAM_ID } from "@squadai/catalog";
import { generateAvatar } from "@squadai/core";
import { AvatarStack } from "@squadai/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Logo } from "@/components/logo";
import { githubEnabled } from "@/lib/env";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signIn"))("title") };
}
export const dynamic = "force-dynamic";

const team = [
  { name: "Lia", key: "lia" },
  { name: "Téo", key: "teo" },
  { name: "Bia", key: "bia" },
].map((a) => ({ name: a.name, spec: generateAvatar(`${a.name}:${a.key}:${STARTER_TEAM_ID}`) }));

export default async function SignInPage() {
  const t = await getTranslations("signIn");
  return (
    <main className="flex min-h-screen flex-wrap">
      <section className="flex flex-[1_1_420px] flex-col justify-between gap-10 bg-brand-wash px-8 py-10 sm:px-14">
        <Logo />
        <div className="flex max-w-md flex-col gap-5">
          <AvatarStack people={team} size={56} />
          <h1 className="font-display text-4xl leading-tight font-bold tracking-tight">
            {t("headline")}
          </h1>
          <p className="text-lg leading-relaxed text-muted">{t("pitch")}</p>
        </div>
        <p className="text-sm text-subtle">{t("footer")}</p>
      </section>
      <section className="relative flex flex-[1_1_420px] items-center justify-center px-6 py-12">
        {/* The office is created in this language, so let people pick it before signing up. */}
        <LanguageSwitcher className="absolute top-4 right-6" />
        <SignInForm github={githubEnabled()} />
      </section>
    </main>
  );
}
