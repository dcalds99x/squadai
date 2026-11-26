# 0003. Team templates as YAML, compiled to TypeScript

**Status:** accepted

## Context

Pre-built teams are the heart of the product. We want anyone to be able to contribute one without touching application code, and we want a broken template to fail in CI, not in production.

## Decision

- Each team is a YAML file in `packages/catalog/templates/`, validated by a Zod schema that also checks cross-references (every playbook step points to a real agent).
- `pnpm catalog:generate` compiles them into `src/generated.ts`. CI runs `pnpm catalog:check` and fails if the generated file is stale.
- "Hiring" a team copies the template into the workspace (`templateRef` records the source). People can then change their copy freely.

## Consequences

- The app imports plain data: no file system access at runtime, so it works the same in Next.js, the worker and tests.
- Updating a template does not change teams already hired. Offering upgrades is future work, made possible by `templateRef`.
