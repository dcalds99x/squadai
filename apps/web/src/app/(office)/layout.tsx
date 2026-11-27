import { getDb, getPendingApprovals, getSidebar } from "@squadai/db";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getContentText } from "@/lib/content";
import { publicDemo } from "@/lib/env";
import { requireOffice } from "@/lib/session";
import { Sidebar } from "./sidebar";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const { user, workspace } = await requireOffice();
  const db = getDb();
  const [departments, pending, text, t] = await Promise.all([
    getSidebar(db, workspace.id),
    getPendingApprovals(db, workspace.id),
    getContentText(),
    getTranslations("publicDemo"),
  ]);

  return (
    <div className="flex min-h-screen flex-wrap items-stretch lg:h-screen lg:flex-nowrap lg:overflow-hidden">
      <Sidebar
        departments={departments.map((d) => ({
          ...d,
          name: text.c(d.name),
          teams: d.teams.map((t) => ({ ...t, name: text.c(t.name) })),
        }))}
        waiting={pending.length}
        user={{ name: user.name, email: user.email }}
        workspaceName={text.office(workspace.name)}
      />
      <div className="min-w-0 flex-[999_1_560px] lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto">
        {publicDemo() && (
          <p className="border-b border-line bg-brand-wash px-6 py-2 text-center text-[13px] text-brand-strong">
            {t("banner")}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
