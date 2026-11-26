# 0009. Internationalization: two locales, two owners

**Status:** accepted

## Context

squadai shipped in Brazilian Portuguese only. A deployment for an English-speaking team needs the whole product in English, and a mixed team needs each person to read the interface in their own language.

Not all text is interface. squadai has three kinds:

1. **Interface copy** in `apps/web`: pages, buttons, form errors, empty states, `aria-label`s, metadata.
2. **What agents write and read**: room lines ("Terminei a pesquisa. Téo, é com você!"), prompts, tool descriptions, demo output and provider errors. This text is stored in the database and read by everyone in the office, and it is what the models see.
3. **Team content**: personas, playbooks and instructions in `packages/catalog/templates/*.yaml`. Once a team is hired, it is the workspace's data and people edit it.

These have different owners. Interface copy belongs to whoever is reading. A team room cannot change language per reader: the messages are already written, and an agent should not answer in Portuguese to one teammate and in English to another.

## Decision

**Two locales, each with one source of truth.** `pt-BR` and `en` are supported (`LOCALES` in `@squadai/core`); `en` is the default; `pt-BR` is the language of workspaces created before locales existed.

- **The person's locale** drives the interface. It is the `squadai-locale` cookie set by the language switcher (sidebar and sign-in page), else the browser's `Accept-Language`, else `en`. A cookie works before sign-in and needs no schema change. `<html lang>` follows it.
- **The workspace locale** drives everything agents write and read. It lives in `WorkspaceSettings.locale` (the existing `workspace.settings` JSON, so no migration). A new workspace takes the locale of the person who signs up. People who manage the office can change it on "Models & costs". Workspaces without it read as `pt-BR` (`LEGACY_WORKSPACE_LOCALE`), the only language before this ADR.

**Interface: [next-intl](https://next-intl.dev) 4.** It supports the App Router, Server Components and server actions on Next 16 and React 19 (peer ranges `next ^16`, `react ^19`), formats ICU plurals and rich text, and runs without locale routing, so URLs stay the same in every language. A home-made catalog would have to rebuild plurals, rich text and client hydration of messages; the dependency is cheaper than that code.

- Catalogs are `apps/web/messages/<locale>.json`. `pt-BR.json` is the reference: it types every `t()` call through next-intl's `AppConfig`, and every other catalog must have its shape, so a missing or misspelled key fails `pnpm typecheck`. `apps/web/test/messages.test.ts` also fails on extra keys, invalid ICU and placeholders or tags that differ between languages.
- Numbers, money, dates and durations go through `apps/web/src/lib/format.ts`, which takes the locale explicitly. Typed amounts (the budget) are parsed in the person's locale.
- Engine errors reach the interface as codes (`WorkError.code`), not sentences, and the web app words them in the person's language. Built-in tool labels live in the web catalogs, keyed by tool name.

**Engine, providers and database: small typed catalogs in code.** Each package keeps its own words next to the code that uses them (`packages/engine/src/words.ts`, the demo model, `friendlyError`, the welcome message). The `pt-BR` object is the reference type and the others must match it, so a missing line fails the typecheck. Functions take the locale as an argument; nothing reads a global.

**Protocol tokens stay fixed.** The tool tags (`<tool name="…">`, `<result …>`), tool input keys (`query`, `question`, `team`, `comment`), the review marker (`---NOTES---`) and the coordinator plan's JSON keys (`tasks`, `agent`, `task`) are the same in every locale. They are machine syntax, not copy: stored checkpoints contain them, and a run must resume even if the workspace changed language in between. Prompts in every language tell the model to keep them exactly as shown. Parsers also accept the Portuguese tokens of early builds ([ADR-0008, addendum](0008-text-tool-protocol.md#addendum-english-tokens)).

**Team templates: optional, complete translations.** A template declares the language it is written in (`locale`, default `en`) and may add `translations.<locale>` with the words only: department, name, description, and per agent and playbook key the role, bio, skills, preferences, instructions, playbook names and one task per step. Keys, names, tools, tiers and steps cannot be translated, so a team is the same team in every language. Zod rejects a translation that misses an agent, a playbook or a step, so a hired team never mixes languages. When a team is hired, `hireTeam` picks the translation for the workspace locale (`localizeTemplate`), falling back to the template's own language. All three shipped teams are written in English and ship a pt-BR translation.

## Consequences

- Adding a language is mostly content: add it to `LOCALES` and `LOCALE_NAMES`, write `apps/web/messages/<locale>.json`, and add its entry to each typed catalog. The typecheck lists every place that is missing. Template translations are optional.
- What is already written stays in the language it was written in. Switching the interface to English does not translate a Portuguese room, and changing the workspace locale only affects text written from then on and teams hired afterwards. Hired teams are workspace data; people can edit them, but nothing retranslates them.
- The interface preference is per browser, not per account. Moving it to the user record is a small change (a Better Auth additional field and a migration) when people ask for it.
- Every page reads the locale cookie, so no page is statically prerendered. The office was already fully dynamic.
- The protocol tokens were Portuguese at first and were renamed to English before the first release; see the ADR-0008 addendum.

## Addendum: catalog content follows the reader

Hired teams copy their template's words into the database in the workspace language. So, at first, an English reader in a Portuguese office still saw "Conteúdo & SEO", "Pesquisadora" or "Artigo para o blog".

Catalog phrases are now translated **when they are shown**. `translateCatalogText` in `@squadai/catalog` builds one dictionary from every template in every language. The web app's `lib/content.ts` applies it to team, department, role, bio, skill and playbook names, and also to generated office names and version labels. Nothing in the database is rewritten, and agents keep working in the workspace language.

Text that is not catalog content is shown exactly as stored: a renamed team, an edited bio, requests, room messages and deliveries.
