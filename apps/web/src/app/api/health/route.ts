import { getDb } from "@squadai/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Liveness and readiness for load balancers, Docker and uptime checks. */
export async function GET() {
  const started = performance.now();
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({
      status: "ok",
      database: "ok",
      latencyMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    return Response.json(
      { status: "degraded", database: "unreachable", error: String(error) },
      { status: 503 },
    );
  }
}
