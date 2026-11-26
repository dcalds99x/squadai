import "server-only";
import { createWorkspaceForUser, getDb, getPrimaryWorkspace } from "@squadai/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getUserLocale } from "@/i18n/locale";
import { getAuth } from "./auth";

/**
 * The signed-in person and their office. Redirects to /sign-in when signed out.
 * Cached per request, so layouts and pages can both call it.
 */
export const requireOffice = cache(async () => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const db = getDb();
  let workspace = await getPrimaryWorkspace(db, session.user.id);
  if (!workspace) {
    // Safety net if the sign-up hook did not finish.
    await createWorkspaceForUser(db, {
      userId: session.user.id,
      userName: session.user.name,
      locale: await getUserLocale(),
    });
    workspace = await getPrimaryWorkspace(db, session.user.id);
  }
  if (!workspace) throw new Error("Could not load the workspace.");

  return { user: session.user, workspace };
});
