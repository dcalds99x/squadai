# 0004. Workspace packages ship TypeScript source

**Status:** accepted

## Context

Internal packages are usually compiled to JavaScript before use. That adds a build step per package, watch processes in development and source maps to debug through.

## Decision

Packages export their `.ts` source directly and import each other with explicit `.ts` extensions.

- Next.js compiles them through `transpilePackages`.
- The worker and scripts run on Node's built-in type stripping (Node 22.18+), with no build step and no `tsx`.
- `erasableSyntaxOnly` in `tsconfig.base.json` forbids TypeScript features Node cannot strip (enums, namespaces, parameter properties).

## Consequences

- No package build step and nothing to keep in sync.
- Stack traces in the worker point at real source lines.
- We use `as const` arrays instead of enums. They also map directly to Postgres enums.
