import "server-only";
import { BUILTIN_TOOLS, type BuiltinTool } from "@squadai/engine";
import type { getTranslations } from "next-intl/server";

type ToolsT = Awaited<ReturnType<typeof getTranslations<"tools">>>;

function isBuiltin(name: string): name is BuiltinTool {
  return (BUILTIN_TOOLS as readonly string[]).includes(name);
}

/**
 * How a person sees a tool, in their language. Every built-in tool needs a
 * label in the catalogs (typecheck enforces it); MCP tools read "server: tool".
 */
export function toolLabel(t: ToolsT, name: string): string {
  if (isBuiltin(name)) return t(`labels.${name}`);
  const mcp = /^mcp\.([^.]+)\.(.+)$/.exec(name);
  if (mcp) return t("mcp", { server: mcp[1] ?? "", tool: mcp[2] ?? "" });
  return name;
}

/** Why a built-in tool cannot be used yet, in words a person can act on. */
export function toolUnavailableReason(t: ToolsT, name: string): string | undefined {
  return isBuiltin(name) ? t(`unavailable.${name}`) : undefined;
}
