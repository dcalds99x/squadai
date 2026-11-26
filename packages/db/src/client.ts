import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export function createDb(url: string, options: { max?: number } = {}) {
  // onnotice: skip Postgres NOTICE chatter such as "relation already exists, skipping".
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return Object.assign(db, { close: () => sql.end() });
}

export type Db = ReturnType<typeof createDb>;
/** A database handle or an open transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/** A dedicated connection for Postgres LISTEN (live updates). */
export function createListener(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  return {
    listen: (channel: string, onMessage: (payload: string) => void) =>
      sql.listen(channel, onMessage),
    close: () => sql.end(),
  };
}

const globalForDb = globalThis as unknown as { squadaiDb?: Db };

/** One shared pool per process, reused across hot reloads in development. */
export function getDb(): Db {
  if (!globalForDb.squadaiDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    globalForDb.squadaiDb = createDb(url);
  }
  return globalForDb.squadaiDb;
}
