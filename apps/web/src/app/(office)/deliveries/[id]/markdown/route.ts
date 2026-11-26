import { getDb, schema } from "@squadai/db";
import { and, desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { requireOffice } from "@/lib/session";

/** Downloads the latest version of a delivery as a Markdown file. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireOffice();
  const { id } = await params;
  const db = getDb();
  const [d] = await db
    .select({ id: schema.delivery.id, title: schema.delivery.title })
    .from(schema.delivery)
    .innerJoin(schema.team, eq(schema.team.id, schema.delivery.teamId))
    .where(and(eq(schema.delivery.id, id), eq(schema.team.workspaceId, workspace.id)));
  if (!d) return new Response("Not found", { status: 404 });
  const [v] = await db
    .select({ content: schema.deliveryVersion.content })
    .from(schema.deliveryVersion)
    .where(eq(schema.deliveryVersion.deliveryId, d.id))
    .orderBy(desc(schema.deliveryVersion.number))
    .limit(1);
  const file = `${
    d.title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || (await getTranslations("delivery"))("fileName")
  }.md`;
  return new Response(v?.content ?? "", {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
    },
  });
}
