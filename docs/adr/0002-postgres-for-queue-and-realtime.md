# 0002. Postgres for data, the job queue and realtime

**Status:** accepted

## Context

squadai is self-hosted and meant to be deployed into other people's infrastructure. Every extra stateful service (Redis, a message broker, a workflow engine) is one more thing they have to run, secure, back up and monitor.

Agent runs need a durable queue with retries and schedules. The room needs live updates.

## Decision

Postgres is the only stateful dependency:

- **Data**: Drizzle ORM with SQL migrations.
- **Jobs**: [pg-boss](https://github.com/timgit/pg-boss) (`SKIP LOCKED`, retries, cron, dead letters) in its own `pgboss` schema.
- **Realtime** (Phase 1): the worker sends `NOTIFY` after writing; the web app `LISTEN`s and streams to the browser with Server-Sent Events.

## Consequences

- One backup covers everything, and jobs can be enqueued in the same transaction as the data they refer to.
- Throughput is bounded by Postgres. That is far beyond what an office of agent teams needs, and the queue sits behind a small interface if it ever has to move.
- Temporal or Inngest would give richer workflow tooling. We chose fewer moving parts over that.
