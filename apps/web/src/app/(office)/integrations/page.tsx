import { getDb, schema } from "@squadai/db";
import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOffice } from "@/lib/session";
import { IntegrationCard } from "./forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("integrations"))("title") };
}

export default async function IntegrationsPage() {
  const { workspace } = await requireOffice();
  const t = await getTranslations("integrations");
  const rows = await getDb()
    .select({
      id: schema.integration.id,
      kind: schema.integration.kind,
      name: schema.integration.name,
      url: schema.integration.url,
      secretHint: schema.integration.secretHint,
      config: schema.integration.config,
      tools: schema.integration.tools,
    })
    .from(schema.integration)
    .where(eq(schema.integration.workspaceId, workspace.id))
    .orderBy(asc(schema.integration.createdAt));
  const canEdit = workspace.role !== "member";
  const github = rows.find((r) => r.kind === "github") ?? null;
  const notion = rows.find((r) => r.kind === "notion") ?? null;
  const mcp = rows.filter((r) => r.kind === "mcp");

  return (
    <main className="page">
      <header className="page-heading">
        <h1 className="page-title">{t("title")}</h1>
        <p className="page-intro">{t("intro")}</p>
      </header>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        <IntegrationCard
          kind="github"
          title="GitHub"
          subtitle={t("github")}
          canEdit={canEdit}
          connected={
            github
              ? { id: github.id, detail: String(github.config.account ?? github.secretHint ?? "") }
              : null
          }
        />
        <IntegrationCard
          kind="notion"
          title="Notion"
          subtitle={t("notion")}
          canEdit={canEdit}
          connected={notion ? { id: notion.id, detail: notion.secretHint ?? "" } : null}
        />
      </div>

      <section aria-labelledby="h-mcp" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="h-mcp" className="font-display text-xl font-bold">
            {t("mcpTitle")}
          </h2>
          <p className="text-sm text-muted">{t("mcpIntro")}</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {mcp.map((m) => (
            <IntegrationCard
              key={m.id}
              kind="mcp"
              title={m.name}
              subtitle={m.url ?? ""}
              canEdit={canEdit}
              connected={{
                id: m.id,
                detail: t("mcpTools", {
                  count: m.tools.length,
                  names: m.tools
                    .map((tool) => tool.name)
                    .slice(0, 5)
                    .join(", "),
                }),
              }}
            />
          ))}
          <IntegrationCard
            kind="mcp"
            title={t("newMcp")}
            subtitle={t("newMcpSubtitle")}
            canEdit={canEdit}
            connected={null}
          />
        </div>
      </section>
    </main>
  );
}
