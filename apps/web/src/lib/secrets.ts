import "server-only";
import { parseMasterKey } from "@squadai/core/crypto";
import { getDb } from "@squadai/db";
import { loadModelContext } from "@squadai/engine";
import { env } from "./env";

export function getMasterKey(): Buffer | null {
  try {
    return parseMasterKey(env().SQUADAI_MASTER_KEY);
  } catch {
    return null;
  }
}

/** Models, settings and decrypted secrets of a workspace (server only). */
export function workspaceContext(workspaceId: string) {
  return loadModelContext(getDb(), workspaceId, { masterKey: getMasterKey() });
}
