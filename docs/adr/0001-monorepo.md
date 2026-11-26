# 0001. pnpm + Turborepo monorepo

**Status:** accepted

## Context

The product has a web app and a worker that share the domain model, the database schema and the team catalog. Keeping them in separate repositories would mean publishing internal packages and keeping versions in sync.

## Decision

One repository with pnpm workspaces and Turborepo. Apps live in `apps/`, shared code in `packages/`. Turborepo runs `build`, `typecheck` and `test` in dependency order and caches the results.

## Consequences

- A schema change and the code that uses it land in one pull request.
- CI checks everything on every change. Turborepo caching keeps that fast.
- Contributors need pnpm. The README says so, and `packageManager` pins the version.
