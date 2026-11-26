# 0005. Better Auth for authentication

**Status:** accepted

## Context

A self-hosted product cannot depend on a hosted identity service. It needs email and password out of the box, optional social sign-in, and a path to SSO for company deployments.

## Decision

[Better Auth](https://www.better-auth.com), with its tables in our Postgres through the Drizzle adapter. Email and password are always on; GitHub sign-in turns on when its credentials are set. A database hook creates the person's workspace and hires the starter team when they sign up.

## Consequences

- Users and sessions live next to the rest of the data, so they are backed up and deleted with it.
- Better Auth has plugins for organizations, SSO (OIDC/SAML) and 2FA, which company deployments will need later.
