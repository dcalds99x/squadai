# 0006. AES-256-GCM for provider keys at rest

**Status:** accepted

## Context

Workspaces store API keys for model providers. A database dump or a leaked backup must not expose them.

## Decision

Keys are encrypted in the application with AES-256-GCM before they reach the database (`@squadai/core/crypto`). The 32-byte master key comes from `SQUADAI_MASTER_KEY`. The stored value is `v1.<iv>.<tag>.<ciphertext>`. The browser only ever sees a hint such as `…a1b2`.

## Consequences

- The database alone is not enough to read a key; an attacker also needs the master key.
- Losing the master key makes stored keys unreadable, so people must enter them again. The deployment guide says to back it up.
- The `v1` prefix allows moving to envelope encryption with a cloud KMS without migrating existing rows.
