/**
 * The interface catalogs must stay in step: same keys, valid ICU, and the same
 * placeholders and tags in every language. A missing key in a non-reference
 * catalog also fails `pnpm typecheck` (src/i18n/messages.ts); this test adds
 * extra keys, broken syntax and mismatched arguments.
 */
import { LOCALES } from "@squadai/core";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import ptBR from "../messages/pt-BR.json";

const CATALOGS = { "pt-BR": ptBR, en } as const;

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/** Argument and tag names a message uses, from its parsed ICU syntax. */
function argumentsOf(message: string, locale: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: unknown[]) => {
    for (const node of nodes as { type: number; value?: string; children?: unknown[] }[]) {
      if (node.value !== undefined && node.type !== 0 && node.type !== 7) names.add(node.value);
      if (node.children) walk(node.children);
      const options = (node as { options?: Record<string, { value: unknown[] }> }).options;
      if (options) for (const option of Object.values(options)) walk(option.value);
    }
  };
  walk(new IntlMessageFormat(message, locale).getAst());
  return [...names].sort();
}

const reference = flatten(ptBR);

describe("message catalogs", () => {
  it("covers every supported locale", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...LOCALES].sort());
  });

  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    const messages = flatten(catalog);

    it(`${locale} has exactly the keys of pt-BR`, () => {
      expect([...messages.keys()].sort()).toEqual([...reference.keys()].sort());
    });

    it(`${locale} messages are valid ICU with the same arguments as pt-BR`, () => {
      for (const [key, message] of messages) {
        const expected = argumentsOf(reference.get(key) ?? "", "pt-BR");
        expect(argumentsOf(message, locale), key).toEqual(expected);
      }
    });

    it(`${locale} has no empty messages`, () => {
      for (const [key, message] of messages) expect(message.trim(), key).not.toBe("");
    });
  }
});
