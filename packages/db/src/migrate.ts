/**
 * Applies pending migrations. Runs in CI, in `pnpm db:migrate`, and as the
 * one-shot `migrate` service in docker-compose before web and worker start.
 */
import { join } from "node:path";
import { createLogger } from "@squadai/core";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.ts";

const log = createLogger({ service: "migrate" });
const url = process.env.DATABASE_URL;
if (!url) {
  log.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = createDb(url, { max: 1 });
try {
  await migrate(db, { migrationsFolder: join(import.meta.dirname, "..", "drizzle") });
  log.info("migrations applied");
} catch (error) {
  log.error("migration failed", { error: String(error) });
  process.exitCode = 1;
} finally {
  await db.close();
}
