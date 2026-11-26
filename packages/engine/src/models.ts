import type { WorkspaceSettings } from "@squadai/core";
import { decryptSecret } from "@squadai/core/crypto";
import { type DbOrTx, schema } from "@squadai/db";
import {
  createModelFactory,
  type ModelFactory,
  type ProviderCredentials,
} from "@squadai/providers";
import { eq } from "drizzle-orm";

export interface IntegrationSecret {
  id: string;
  kind: "github" | "notion" | "mcp";
  name: string;
  url: string | null;
  secret: string | null;
  config: Record<string, unknown>;
  tools: { name: string; description: string }[];
}

/** Everything a run needs from the workspace: models, settings and secrets. */
export interface ModelContext {
  settings: WorkspaceSettings;
  factory: ModelFactory;
  demoMode: boolean;
  anthropic: { apiKey: string; baseUrl: string | null } | null;
  integrations: IntegrationSecret[];
}

export async function loadModelContext(
  db: DbOrTx,
  workspaceId: string,
  options: { masterKey: Buffer | null; demoDelayMs?: number },
): Promise<ModelContext> {
  const [ws] = await db
    .select({ settings: schema.workspace.settings })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId));
  const settings = ws?.settings ?? {};
  const open = (sealed: string | null) =>
    sealed && options.masterKey ? decryptSecret(sealed, options.masterKey) : null;

  const [rows, integrationRows] = await Promise.all([
    db
      .select()
      .from(schema.providerCredential)
      .where(eq(schema.providerCredential.workspaceId, workspaceId)),
    db.select().from(schema.integration).where(eq(schema.integration.workspaceId, workspaceId)),
  ]);

  const credentials: ProviderCredentials[] = rows.map((row) => ({
    provider: row.provider,
    baseUrl: row.baseUrl,
    apiKey: open(row.encryptedKey),
  }));
  const anthropic = credentials.find((c) => c.provider === "anthropic" && c.apiKey);

  return {
    settings,
    demoMode: settings.demoMode === true,
    anthropic: anthropic?.apiKey
      ? { apiKey: anthropic.apiKey, baseUrl: anthropic.baseUrl ?? null }
      : null,
    integrations: integrationRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      url: r.url,
      secret: open(r.encryptedSecret),
      config: r.config,
      tools: r.tools,
    })),
    factory: createModelFactory({
      credentials,
      demoMode: settings.demoMode === true,
      demoDelayMs: options.demoDelayMs,
    }),
  };
}
