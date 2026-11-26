/**
 * Any MCP server becomes a set of tools: connect once to discover them, then
 * call them by name. Tool names are "mcp.<integration>.<tool>".
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Locale } from "@squadai/core";
import type { IntegrationSecret } from "../models.ts";
import { wordsFor } from "../words.ts";
import type { ToolDef } from "./types.ts";

async function withClient<T>(
  url: string,
  secret: string | null,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: secret ? { headers: { Authorization: `Bearer ${secret}` } } : undefined,
  });
  const client = new Client({ name: "squadai", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function discoverMcpTools(url: string, secret: string | null) {
  return withClient(url, secret, async (client) => {
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 400) }));
  });
}

export function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function mcpTools(integrations: IntegrationSecret[], locale: Locale): ToolDef[] {
  const w = wordsFor(locale).tools.mcp;
  return integrations
    .filter((i) => i.kind === "mcp" && i.url)
    .flatMap((i) =>
      i.tools.map(
        (t): ToolDef => ({
          name: `mcp.${slug(i.name)}.${t.name}`,
          label: `${i.name}: ${t.name}`,
          description: w.description(t.description, i.name),
          example: {},
          available: true,
          // New external tools start blocked until someone allows them.
          defaultPolicy: "deny",
          async run(input) {
            const result = await withClient(i.url as string, i.secret, (client) =>
              client.callTool({ name: t.name, arguments: input }),
            );
            const content = Array.isArray(result.content) ? result.content : [];
            const text = content
              .map((c: { type: string; text?: string }) =>
                c.type === "text" ? c.text : `[${c.type}]`,
              )
              .join("\n");
            return {
              kind: "result",
              text: (result.isError ? w.error(text) : text).slice(0, 8000),
            };
          },
        }),
      ),
    );
}
