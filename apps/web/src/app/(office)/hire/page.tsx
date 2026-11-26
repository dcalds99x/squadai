import { localizeTemplate, TEAM_TEMPLATES } from "@squadai/catalog";
import { generateAvatar } from "@squadai/core";
import { getDb, getTeamsWithAgents } from "@squadai/db";
import { AvatarStack } from "@squadai/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getContentText } from "@/lib/content";
import { requireOffice } from "@/lib/session";
import { HireButton } from "./hire-button";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("hire"))("title") };
}

export default async function HirePage() {
  const { workspace } = await requireOffice();
  const t = await getTranslations("hire");
  const hired = await getTeamsWithAgents(getDb(), workspace.id);
  const hiredTemplates = new Set(hired.map((team) => team.templateRef?.split("@")[0]));
  const canHire = workspace.role !== "member";
  // Shown in the reader's language, like every hired team (lib/content.ts).
  // Agents still work in the workspace language once hired.
  const locale = (await getContentText()).locale;

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-7 px-6 py-9 sm:px-11">
      <header className="flex max-w-2xl flex-col gap-2">
        <h1 className="font-display text-[34px] font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted">{t("intro")}</p>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {TEAM_TEMPLATES.map((template) => {
          const team = localizeTemplate(template, locale);
          const isHired = hiredTemplates.has(team.id);
          return (
            <article
              key={team.id}
              lang={team.locale}
              className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider text-muted uppercase">
                  {team.department}
                </span>
                {isHired && (
                  <span className="rounded-full bg-ok-soft px-2.5 py-1 text-xs font-semibold text-ok">
                    {t("hired")}
                  </span>
                )}
              </div>
              <h2 className="font-display text-xl font-bold">{team.name}</h2>
              <p className="text-sm leading-relaxed text-ink-2">{team.description}</p>
              <div className="flex items-center gap-3">
                <AvatarStack
                  people={team.agents.map((a) => ({
                    name: a.name,
                    spec: generateAvatar(`${a.name}:${a.key}:${team.id}`),
                  }))}
                  size={40}
                />
                <span className="text-sm text-muted">
                  {team.agents.map((a) => `${a.name} (${a.role.toLowerCase()})`).join(", ")}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold text-muted">{t("delivers")}</span>
                <ul className="flex flex-wrap gap-1.5">
                  {team.playbooks.map((p) => (
                    <li key={p.key} className="rounded-full bg-canvas px-3 py-1.5 text-[13px]">
                      {p.name}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-auto pt-2">
                {canHire ? (
                  <HireButton templateId={team.id} again={isHired} />
                ) : (
                  <p className="text-sm text-subtle">{t("askManager")}</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
