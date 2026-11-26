import "server-only";
import { translateCatalogText } from "@squadai/catalog";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@squadai/core";
import { displayOfficeName } from "@squadai/db";
import { getLocale } from "next-intl/server";

/**
 * Stored content in the reader's language.
 *
 * Team, agent and playbook words come from the catalog and are stored in the
 * workspace language. These helpers show untouched catalog words in the
 * reader's interface language. Anything a person or an agent wrote (requests,
 * room messages, deliveries, customized names) is shown as written.
 * See docs/adr/0009-internationalization.md.
 */
export interface ContentText {
  locale: Locale;
  /** Catalog phrase (team, department, role, playbook…) in the reader's language. */
  c: (text: string) => string;
  /** "Ana's office" ↔ "Escritório de Ana". */
  office: (name: string) => string;
  /** "draft · Téo" ↔ "rascunho · Téo". */
  version: (label: string) => string;
}

const VERSION_WORDS: Record<Locale, Record<string, string>> = {
  "pt-BR": { draft: "rascunho", review: "revisão", revision: "ajuste", result: "resultado" },
  en: { rascunho: "draft", revisão: "review", ajuste: "revision", resultado: "result" },
};

export function contentText(locale: Locale): ContentText {
  return {
    locale,
    c: (text) => translateCatalogText(text, locale),
    office: (name) => displayOfficeName(name, locale),
    version: (label) => {
      const [word = "", ...rest] = label.split(" · ");
      const translated = VERSION_WORDS[locale][word] ?? word;
      return [translated, ...rest].join(" · ");
    },
  };
}

/** The helpers for the current request's interface language. */
export async function getContentText(): Promise<ContentText> {
  const locale = await getLocale();
  return contentText(isLocale(locale) ? locale : DEFAULT_LOCALE);
}

/** Teams and playbooks for the request composer, in the reader's language. */
export function localizeOptions<
  T extends { name: string; playbooks: { name: string; description: string }[] },
>(options: T[], text: ContentText): T[] {
  return options.map((o) => ({
    ...o,
    name: text.c(o.name),
    playbooks: o.playbooks.map((p) => ({
      ...p,
      name: text.c(p.name),
      description: text.c(p.description),
    })),
  }));
}
