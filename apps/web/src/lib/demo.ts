import "server-only";
import type { Locale } from "@squadai/core";
import { getDb, schema } from "@squadai/db";
import { createRequest } from "@squadai/engine";
import { and, eq } from "drizzle-orm";
import { enqueueRun } from "./queue";

/** Sample requests a public-demo office starts with, so a visitor sees teams at work. */
const SAMPLES: Record<Locale, { team: string; playbook: string | null; prompt: string }[]> = {
  en: [
    {
      team: "content-seo",
      playbook: "artigo-blog",
      prompt: "A blog post about rooftop solar for small businesses",
    },
    {
      team: "code-review",
      playbook: null,
      prompt: "Explain the risks of storing session tokens in local storage",
    },
    {
      team: "market-research",
      playbook: "estudo-precos",
      prompt: "Pricing study for a meal-kit subscription in Lisbon",
    },
  ],
  "pt-BR": [
    {
      team: "content-seo",
      playbook: "artigo-blog",
      prompt: "Um artigo sobre energia solar para pequenos negócios",
    },
    {
      team: "code-review",
      playbook: null,
      prompt: "Explique os riscos de guardar tokens de sessão no local storage",
    },
    {
      team: "market-research",
      playbook: "estudo-precos",
      prompt: "Estudo de preços para uma assinatura de kits de refeição em Lisboa",
    },
  ],
};

export async function seedDemoOffice(workspaceId: string, userId: string): Promise<void> {
  const db = getDb();
  const [ws] = await db
    .select({ settings: schema.workspace.settings })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId));
  const locale: Locale = ws?.settings.locale === "pt-BR" ? "pt-BR" : "en";
  for (const sample of SAMPLES[locale]) {
    const [team] = await db
      .select({ id: schema.team.id })
      .from(schema.team)
      .where(and(eq(schema.team.workspaceId, workspaceId), eq(schema.team.slug, sample.team)));
    if (!team) continue;
    const [pb] = sample.playbook
      ? await db
          .select({ id: schema.playbook.id })
          .from(schema.playbook)
          .where(and(eq(schema.playbook.teamId, team.id), eq(schema.playbook.key, sample.playbook)))
      : [];
    const { requestId } = await createRequest(db, {
      workspaceId,
      teamId: team.id,
      playbookId: pb?.id ?? null,
      userId,
      prompt: sample.prompt,
    });
    await enqueueRun({ requestId });
  }
}
