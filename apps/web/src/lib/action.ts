import "server-only";
import { WorkError } from "@squadai/engine";
import { getTranslations } from "next-intl/server";
import type { Messages } from "@/i18n/messages";
import { requireOffice } from "./session";

/** What a server action tells its form. Messages are already in the person's language. */
export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export type ErrorKey = keyof Messages["errors"];

/** An expected refusal. Worded from the catalogs, in the person's language, by `attempt`. */
export class ActionError extends Error {
  readonly key: ErrorKey;
  readonly values: Record<string, string | number> | undefined;
  constructor(key: ErrorKey, values?: Record<string, string | number>) {
    super(`Action refused: ${key}`);
    this.name = "ActionError";
    this.key = key;
    this.values = values;
  }
}

export async function requireManager() {
  const office = await requireOffice();
  if (office.workspace.role === "member") throw new ActionError("managerOnly");
  return office;
}

/**
 * Runs an action and turns expected failures (ours and the engine's) into a
 * message for the form. Next.js redirects and other framework signals pass through.
 */
export async function attempt(fn: () => Promise<ActionState | undefined>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (error) {
    if (error instanceof ActionError) {
      const t = await getTranslations("errors");
      return { error: t(error.key, error.values) };
    }
    if (error instanceof WorkError) {
      const t = await getTranslations("workErrors");
      return { error: t(error.code) };
    }
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    if (typeof error === "object" && error && "digest" in error) throw error;
    console.error(error);
    const t = await getTranslations("errors");
    return { error: t("generic") };
  }
}
