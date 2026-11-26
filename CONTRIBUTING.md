# Contributing

Thanks for helping. The easiest way to start is to [create a team](docs/teams.md).

## Setup

See [Development](README.md#development) in the README.

## Before opening a pull request

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

If you changed the database schema, run `pnpm db:generate` and commit the new migration. If you made a decision that is hard to reverse, add an [ADR](docs/adr).

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`…).
- Code and docs are in English. Product copy exists in Brazilian Portuguese and English ([ADR-0009](docs/adr/0009-internationalization.md)).
- Never hard-code copy in `apps/web`. Add a key to `apps/web/messages/pt-BR.json` and `en.json` and use `useTranslations` / `getTranslations`. Format numbers and dates with `src/lib/format.ts`, passing the locale.
- Text agents write or read (room lines, prompts, tool descriptions) follows the workspace locale and lives in the package that writes it, for example `packages/engine/src/words.ts`.
- Shared values go in `@squadai/core` as `as const` arrays, not TypeScript enums ([ADR-0004](docs/adr/0004-typescript-source-packages.md)).
- Write UI copy the way a colleague would talk: say what happened and what to do next. In every language: translate the meaning, not the words.

## Adding a language

1. Add the locale to `LOCALES` and its own name to `LOCALE_NAMES` in `packages/core/src/locale.ts`.
2. Copy `apps/web/messages/pt-BR.json` to `apps/web/messages/<locale>.json`, translate it and register it in `apps/web/src/i18n/messages.ts`.
3. Run `pnpm typecheck`. It lists every typed catalog that needs the new language: the engine's words, the demo model, the tool protocol, provider errors and the welcome message.
4. Optionally, add `translations.<locale>` to the team templates ([Creating a team](docs/teams.md#translations)). Teams without one are hired in the language they are written in.
5. Run `pnpm test`. It checks that every catalog has the same keys and placeholders as `pt-BR`.

Keep protocol tokens as they are (`<tool>`, `<result>`, `---NOTES---`, the plan's `tasks` keys and tool input keys): they are machine syntax, not copy.
