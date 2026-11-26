/**
 * Languages squadai speaks. Two things carry a locale:
 *
 * - a person, for the interface (a cookie set by the language switcher,
 *   falling back to the browser's Accept-Language);
 * - a workspace, for what agents write (`WorkspaceSettings.locale`), so a
 *   team's room, deliveries and prompts stay in one language whoever reads them.
 *
 * See docs/adr/0009-internationalization.md.
 */

export const LOCALES = ["pt-BR", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** The fallback language: for people whose browser asks for none we speak, and for new content. */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * The language of workspaces created before workspaces had one. squadai
 * started in Portuguese, so their teams and rooms are in pt-BR.
 */
export const LEGACY_WORKSPACE_LOCALE: Locale = "pt-BR";

/** Cookie that stores a person's interface language. */
export const LOCALE_COOKIE = "squadai-locale";

/** Each language in its own words, for language pickers. Never translated. */
export const LOCALE_NAMES: Record<Locale, string> = {
  "pt-BR": "Português (Brasil)",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the closest supported language for a language tag ("pt-PT" → "pt-BR",
 * "en-GB" → "en"), or null when none is close.
 */
export function closestLocale(tag: string): Locale | null {
  const wanted = tag.trim().toLowerCase();
  if (!wanted) return null;
  const exact = LOCALES.find((l) => l.toLowerCase() === wanted);
  if (exact) return exact;
  const base = wanted.split("-")[0];
  return LOCALES.find((l) => l.toLowerCase().split("-")[0] === base) ?? null;
}

/**
 * Reads an Accept-Language header ("en-US,en;q=0.9,pt;q=0.8") and returns the
 * supported language the browser prefers, or null when it prefers none of them.
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const entry of ranked) {
    const locale = closestLocale(entry.tag);
    if (locale) return locale;
  }
  return null;
}

/** "Lia, Téo e Bia" / "Lia, Téo, and Bia". */
export function formatList(items: string[], locale: Locale): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}
