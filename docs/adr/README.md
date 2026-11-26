# Architecture decision records

Each record explains one decision: the context, what we chose, and what it costs us.
New decisions get the next number. A decision that changes gets a new record that supersedes the old one.

| #                                               | Decision                                                        |
| ----------------------------------------------- | --------------------------------------------------------------- |
| [0001](0001-monorepo.md)                        | pnpm + Turborepo monorepo                                       |
| [0002](0002-postgres-for-queue-and-realtime.md) | Postgres for data, the job queue and realtime                   |
| [0003](0003-teams-as-code.md)                   | Team templates as YAML, compiled to TypeScript                  |
| [0004](0004-typescript-source-packages.md)      | Workspace packages ship TypeScript source                       |
| [0005](0005-better-auth.md)                     | Better Auth for authentication                                  |
| [0006](0006-secrets-at-rest.md)                 | AES-256-GCM for provider keys at rest                           |
| [0007](0007-model-providers.md)                 | Anthropic SDK for Claude, AI SDK for the rest, and a demo model |
| [0008](0008-text-tool-protocol.md)              | A text protocol for tool calls                                  |
| [0009](0009-internationalization.md)            | Internationalization: interface and workspace locales           |
