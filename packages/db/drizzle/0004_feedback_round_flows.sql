ALTER TABLE "team" ADD COLUMN "lead_key" text;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "provider_credential" ADD COLUMN "models" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "flow" jsonb;--> statement-breakpoint
-- Teams hired before leads existed get the lead their template now names.
UPDATE "team" SET "lead_key" = 'teo' WHERE "lead_key" IS NULL AND "template_ref" LIKE 'content-seo@%';--> statement-breakpoint
UPDATE "team" SET "lead_key" = 'clara' WHERE "lead_key" IS NULL AND "template_ref" LIKE 'market-research@%';--> statement-breakpoint
UPDATE "team" SET "lead_key" = 'rui' WHERE "lead_key" IS NULL AND "template_ref" LIKE 'code-review@%';
