import { getTeamTemplate, STARTER_TEAM_ID } from "@squadai/catalog";
import type { Locale } from "@squadai/core";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../client.ts";
import { auditLog, budget, membership, workspace } from "../schema/index.ts";
import { hireTeam } from "./teams.ts";

const OFFICE_NAME: Record<Locale, (firstName: string) => string> = {
  "pt-BR": (name) => (name ? `Escritório de ${name}` : "Seu escritório"),
  en: (name) => (name ? `${name}'s office` : "Your office"),
};

/**
 * An office name generated at sign-up, shown in the reader's language.
 * A name someone chose themselves is returned unchanged.
 */
export function displayOfficeName(stored: string, locale: Locale): string {
  const generated =
    /^Escritório de (.+)$/.exec(stored)?.[1] ?? /^(.+)'s office$/.exec(stored)?.[1] ?? null;
  if (generated) return OFFICE_NAME[locale](generated);
  if (stored === OFFICE_NAME["pt-BR"]("") || stored === OFFICE_NAME.en("")) {
    return OFFICE_NAME[locale]("");
  }
  return stored;
}

/**
 * Gives a new person their own office, with the starter team already hired,
 * so the first screen they see has people in it instead of an empty state.
 * The office works in the person's language: it becomes the workspace locale.
 */
export async function createWorkspaceForUser(
  db: DbOrTx,
  input: { userId: string; userName: string; locale: Locale },
): Promise<{ workspaceId: string }> {
  return db.transaction(async (tx) => {
    const firstName = input.userName.trim().split(/\s+/)[0] ?? "";
    const [created] = await tx
      .insert(workspace)
      .values({
        name: OFFICE_NAME[input.locale](firstName),
        slug: `${slugify(firstName)}-${crypto.randomUUID().slice(0, 8)}`,
        settings: { locale: input.locale },
      })
      .returning({ id: workspace.id });
    if (!created) throw new Error("Could not create workspace.");

    await tx
      .insert(membership)
      .values({ workspaceId: created.id, userId: input.userId, role: "owner" });
    await tx
      .insert(budget)
      .values({ workspaceId: created.id, monthlyLimitCents: 10_000, currency: "USD" });
    await tx.insert(auditLog).values({
      workspaceId: created.id,
      actorType: "user",
      actorId: input.userId,
      action: "workspace.created",
    });
    await hireTeam(tx, {
      workspaceId: created.id,
      template: getTeamTemplate(STARTER_TEAM_ID),
      hiredBy: input.userId,
    });
    return { workspaceId: created.id };
  });
}

/** The workspace a person lands in. Phase 0 has one per person. */
export async function getPrimaryWorkspace(db: DbOrTx, userId: string) {
  const [row] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      settings: workspace.settings,
      role: membership.role,
    })
    .from(membership)
    .innerJoin(workspace, eq(workspace.id, membership.workspaceId))
    .where(eq(membership.userId, userId))
    .orderBy(membership.createdAt)
    .limit(1);
  return row ?? null;
}

function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "escritorio"
  );
}
