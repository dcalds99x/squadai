/**
 * A one-job worker for the crash test: runs one request with a slow demo model,
 * so the test can kill this process in the middle of the run.
 * Usage: node run-request.ts <requestId>   (DATABASE_URL must be set)
 */
import { createDb } from "@squadai/db";
import { loadModelContext, runRequest } from "../../src/index.ts";

const requestId = process.argv[2];
const url = process.env.DATABASE_URL;
if (!requestId || !url) throw new Error("usage: DATABASE_URL=… node run-request.ts <requestId>");

const db = createDb(url, { max: 2 });
await runRequest(
  { db, loadModels: (ws) => loadModelContext(db, ws, { masterKey: null, demoDelayMs: 400 }) },
  { requestId },
);
await db.close();
