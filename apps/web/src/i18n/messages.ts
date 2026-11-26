import type { Locale } from "@squadai/core";
import en from "../../messages/en.json";
import ptBR from "../../messages/pt-BR.json";

/**
 * pt-BR is the reference catalog: its keys type every `t()` call (see
 * src/global.d.ts), and every other catalog must have its shape, so a missing
 * key fails `pnpm typecheck`. test/messages.test.ts also rejects extra keys.
 */
export type Messages = typeof ptBR;

export const MESSAGES: Record<Locale, Messages> = { "pt-BR": ptBR, en };
