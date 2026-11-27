import { getDb, schema } from "@squadai/db";
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { requireOffice } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("audit"))("title") };
}

export default async function AuditPage() {
  const { workspace } = await requireOffice();
  const [t, tc, locale] = await Promise.all([
    getTranslations("audit"),
    getTranslations("common"),
    getLocale(),
  ]);
  // Audit actions are stored as "area.verb", the same path as their message key.
  const describe = (action: string) => {
    const key = `actions.${action}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : action;
  };
  const tz = env().SQUADAI_TIMEZONE;
  const rows = await getDb()
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      actorType: schema.auditLog.actorType,
      target: schema.auditLog.target,
      metadata: schema.auditLog.metadata,
      createdAt: schema.auditLog.createdAt,
      userName: schema.user.name,
    })
    .from(schema.auditLog)
    .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorId))
    .where(eq(schema.auditLog.workspaceId, workspace.id))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(200);

  return (
    <main className="page">
      <header className="page-heading">
        <h1 className="page-title">{t("title")}</h1>
        <p className="page-intro">{t("intro")}</p>
      </header>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-subtle">
              <th scope="col" className="px-4 py-3 font-semibold">
                {t("when")}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {t("who")}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {t("what")}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {t("detail")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-[#EEF0F6] border-t align-top">
                <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                  {formatDateTime(r.createdAt, tz, locale)}
                </td>
                <td className="px-4 py-2.5">
                  {r.userName ?? (r.actorType === "system" ? tc("system") : "—")}
                </td>
                <td className="px-4 py-2.5">{describe(r.action)}</td>
                <td className="max-w-[320px] truncate px-4 py-2.5 font-mono text-xs text-subtle">
                  {r.metadata ? JSON.stringify(r.metadata) : (r.target ?? "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
