/**
 * Showing catalog content in the reader's language.
 *
 * A hired team copies its template's words into the database, in the
 * workspace's language at hiring time. When someone reads the office in another
 * language, those words should follow them, as long as nobody has edited them.
 *
 * This builds one dictionary from every template in every language: a known
 * catalog phrase maps to its equivalents. Text that is not in the dictionary
 * (a renamed team, a customized bio, anything people or agents wrote) is shown
 * exactly as stored. Nothing in the database is rewritten.
 */
import { LOCALES, type Locale } from "@squadai/core";
import { TEAM_TEMPLATES } from "./generated.ts";
import { localizeTemplate } from "./localize.ts";

type Variants = Partial<Record<Locale, string>>;

let dictionary: Map<string, Variants> | null = null;

function collect(paths: Map<string, Variants>, path: string, locale: Locale, text: string) {
  const entry = paths.get(path) ?? {};
  entry[locale] = text;
  paths.set(path, entry);
}

function build(): Map<string, Variants> {
  // Same field in every language, keyed by its place in the template.
  const paths = new Map<string, Variants>();
  for (const template of TEAM_TEMPLATES) {
    for (const locale of LOCALES) {
      const t = localizeTemplate(template, locale);
      const base = `${template.id}`;
      collect(paths, `${base}.department`, locale, t.department);
      collect(paths, `${base}.name`, locale, t.name);
      collect(paths, `${base}.description`, locale, t.description);
      for (const a of t.agents) {
        collect(paths, `${base}.agent.${a.key}.role`, locale, a.role);
        collect(paths, `${base}.agent.${a.key}.bio`, locale, a.bio);
        collect(paths, `${base}.agent.${a.key}.prefers`, locale, a.prefers);
        collect(paths, `${base}.agent.${a.key}.never`, locale, a.never);
        for (const [i, s] of a.skills.entries()) {
          collect(paths, `${base}.agent.${a.key}.skill.${i}`, locale, s);
        }
      }
      for (const p of t.playbooks) {
        collect(paths, `${base}.playbook.${p.key}.name`, locale, p.name);
        collect(paths, `${base}.playbook.${p.key}.description`, locale, p.description);
        for (const [i, s] of p.steps.entries()) {
          collect(paths, `${base}.playbook.${p.key}.task.${i}`, locale, s.task);
        }
      }
    }
  }
  // Then index by the text itself, so callers only need the stored string.
  const byText = new Map<string, Variants>();
  for (const variants of paths.values()) {
    for (const text of Object.values(variants)) {
      if (text && !byText.has(text)) byText.set(text, variants);
    }
  }
  return byText;
}

/** The catalog phrase in `locale`, or the text unchanged when it is not catalog content. */
export function translateCatalogText(text: string, locale: Locale): string {
  dictionary ??= build();
  return dictionary.get(text)?.[locale] ?? text;
}
