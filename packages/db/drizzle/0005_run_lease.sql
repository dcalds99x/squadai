ALTER TABLE "run" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
-- Older builds could leave two unfinished runs for one request (the double-run bug).
-- Keep the newest and mark the rest failed, so the unique index below can be created.
UPDATE "run" SET "status" = 'failed', "error" = 'Superseded by a newer run.'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "request_id" ORDER BY "created_at" DESC) AS "rn"
    FROM "run" WHERE "status" IN ('queued', 'running', 'waiting')
  ) AS "dupes" WHERE "rn" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "run_one_active_per_request" ON "run" USING btree ("request_id") WHERE "run"."status" in ('queued', 'running', 'waiting');
