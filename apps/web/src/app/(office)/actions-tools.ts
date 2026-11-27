"use server";

import { encryptSecret, maskSecret } from "@squadai/core/crypto";
import { getDb, schema } from "@squadai/db";
import {
  decideToolApproval,
  discoverMcpTools,
  type RouteOption,
  suggestRoutes,
} from "@squadai/engine";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import {
  ActionError,
  type ActionState,
  attempt,
  refuseInPublicDemo,
  requireManager,
} from "@/lib/action";
import { getContentText } from "@/lib/content";
import { enqueueRun } from "@/lib/queue";
import { getMasterKey, workspaceContext } from "@/lib/secrets";
import { requireOffice } from "@/lib/session";

// ── Tool permissions ────────────────────────────────────────────────────

export async function decideToolAction(approvalId: string, allow: boolean): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireOffice();
    const resume = await decideToolApproval(getDb(), {
      workspaceId: workspace.id,
      approvalId,
      userId: user.id,
      allow,
    });
    await enqueueRun(resume);
    revalidatePath("/", "layout");
    const t = await getTranslations("actions");
    return { ok: true, message: t(allow ? "allowed" : "refused") };
  });
}

// ── Routing ─────────────────────────────────────────────────────────────

export async function suggestRoutesAction(prompt: string): Promise<RouteOption[]> {
  const { workspace } = await requireOffice();
  if (prompt.trim().length < 5) return [];
  const [options, text] = await Promise.all([
    suggestRoutes(getDb(), workspace.id, prompt, await workspaceContext(workspace.id)),
    getContentText(),
  ]);
  return options.map((o) => ({
    ...o,
    teamName: text.c(o.teamName),
    playbookName: text.c(o.playbookName),
    description: text.c(o.description),
  }));
}

// ── Integrations ────────────────────────────────────────────────────────

/** Tests an integration before saving it. Throws an ActionError the form can show. */
async function checkIntegration(
  kind: "github" | "notion" | "mcp",
  url: string | null,
  secret: string | null,
): Promise<{ tools?: { name: string; description: string }[]; label?: string }> {
  try {
    if (kind === "github") {
      if (!secret) throw new ActionError("githubToken");
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${secret}`,
          "User-Agent": "squadai",
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new ActionError("githubRejected", { status: res.status });
      const body = (await res.json()) as { login: string };
      return { label: body.login };
    }
    if (kind === "notion") {
      if (!secret) throw new ActionError("notionToken");
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: { Authorization: `Bearer ${secret}`, "Notion-Version": "2022-06-28" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new ActionError("notionRejected", { status: res.status });
      return {};
    }
    if (!url) throw new ActionError("mcpUrl");
    return { tools: await discoverMcpTools(url, secret) };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError("connectError", { reason: String(error).slice(0, 160) });
  }
}

export async function saveIntegrationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    refuseInPublicDemo();
    const { user, workspace } = await requireManager();
    const kind = String(form.get("kind")) as "github" | "notion" | "mcp";
    if (!["github", "notion", "mcp"].includes(kind)) throw new ActionError("integrationKind");
    const name = (String(form.get("name") ?? "").trim() || kind).slice(0, 40);
    const url = String(form.get("url") ?? "").trim() || null;
    const secret = String(form.get("secret") ?? "").trim() || null;
    const parentPageId = String(form.get("parentPageId") ?? "")
      .trim()
      .replace(/-/g, "")
      .slice(-32);
    if (kind === "notion" && !/^[0-9a-f]{32}$/i.test(parentPageId)) {
      throw new ActionError("notionPage");
    }
    if (url && !/^https?:\/\//.test(url)) throw new ActionError("urlScheme");

    const masterKey = getMasterKey();
    if (secret && !masterKey) throw new ActionError("noMasterKeySecrets");

    const check = await checkIntegration(kind, url, secret);

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.integration)
        .where(
          and(
            eq(schema.integration.workspaceId, workspace.id),
            eq(schema.integration.kind, kind),
            eq(schema.integration.name, name),
          ),
        );
      await tx.insert(schema.integration).values({
        workspaceId: workspace.id,
        kind,
        name,
        url,
        encryptedSecret: secret && masterKey ? encryptSecret(secret, masterKey) : null,
        secretHint: secret ? maskSecret(secret) : null,
        config: kind === "notion" ? { parentPageId } : check.label ? { account: check.label } : {},
        tools: check.tools ?? [],
        lastCheckedAt: new Date(),
      });
      await tx.insert(schema.auditLog).values({
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: "integration.connected",
        target: `${kind}:${name}`,
        metadata: { tools: (check.tools ?? []).length },
      });
    });
    revalidatePath("/integrations");
    const t = await getTranslations("actions");
    return {
      ok: true,
      message: check.tools
        ? t("integrationTools", { count: check.tools.length })
        : t("integrationConnected"),
    };
  });
}

export async function removeIntegrationAction(id: string): Promise<ActionState> {
  return attempt(async () => {
    const { user, workspace } = await requireManager();
    const db = getDb();
    const [removed] = await db
      .delete(schema.integration)
      .where(and(eq(schema.integration.id, id), eq(schema.integration.workspaceId, workspace.id)))
      .returning({ kind: schema.integration.kind, name: schema.integration.name });
    if (removed) {
      await db.insert(schema.auditLog).values({
        workspaceId: workspace.id,
        actorType: "user",
        actorId: user.id,
        action: "integration.removed",
        target: `${removed.kind}:${removed.name}`,
      });
    }
    revalidatePath("/integrations");
    return { ok: true };
  });
}

// ── Export ──────────────────────────────────────────────────────────────

type NotionBlock = Record<string, unknown>;

function richText(text: string) {
  const chunks = text.match(/[\s\S]{1,1900}/g) ?? [""];
  return chunks.map((content) => ({ type: "text", text: { content } }));
}

/** A small Markdown → Notion converter: headings, lists and paragraphs. */
const MD_RULES: [RegExp, string][] = [
  [/^#\s+(.*)/, "heading_1"],
  [/^##\s+(.*)/, "heading_2"],
  [/^###+\s+(.*)/, "heading_3"],
  [/^\s*[-*]\s+(.*)/, "bulleted_list_item"],
  [/^\s*\d+[.)]\s+(.*)/, "numbered_list_item"],
];

function markdownToNotion(markdown: string): NotionBlock[] {
  const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/_(.+?)_/g, "$1");
  const blocks: NotionBlock[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const rule = MD_RULES.map(([re, type]) => ({ type, m: re.exec(line) })).find((r) => r.m);
    const type = rule?.type ?? "paragraph";
    const text = clean(rule?.m?.[1] ?? line);
    blocks.push({ type, [type]: { rich_text: richText(text) } });
  }
  return blocks.slice(0, 100);
}

export async function exportToNotionAction(deliveryId: string): Promise<ActionState> {
  return attempt(async () => {
    refuseInPublicDemo();
    const { user, workspace } = await requireOffice();
    const db = getDb();
    const [d] = await db
      .select({ id: schema.delivery.id, title: schema.delivery.title })
      .from(schema.delivery)
      .innerJoin(schema.team, eq(schema.team.id, schema.delivery.teamId))
      .where(and(eq(schema.delivery.id, deliveryId), eq(schema.team.workspaceId, workspace.id)));
    if (!d) throw new ActionError("deliveryNotFound");
    const [version] = await db
      .select({ content: schema.deliveryVersion.content })
      .from(schema.deliveryVersion)
      .where(eq(schema.deliveryVersion.deliveryId, d.id))
      .orderBy(desc(schema.deliveryVersion.number))
      .limit(1);
    if (!version) throw new ActionError("nothingToExport");

    const ctx = await workspaceContext(workspace.id);
    const notion = ctx.integrations.find((i) => i.kind === "notion");
    if (!notion?.secret) throw new ActionError("connectNotion");

    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notion.secret}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { page_id: String(notion.config.parentPageId ?? "") },
        properties: { title: { title: richText(d.title) } },
        children: markdownToNotion(version.content),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ActionError("notionRefused", { status: res.status });
    const page = (await res.json()) as { url: string };
    await db.insert(schema.auditLog).values({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: user.id,
      action: "delivery.exported",
      target: d.id,
      metadata: { to: "notion", url: page.url },
    });
    return { ok: true, message: page.url };
  });
}
