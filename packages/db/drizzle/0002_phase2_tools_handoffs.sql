CREATE TABLE "integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"encrypted_secret" text,
	"secret_hint" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoff" ADD COLUMN "origin_request_id" uuid;--> statement-breakpoint
ALTER TABLE "handoff" ADD COLUMN "helper_request_id" uuid;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "kind" text DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_workspace_id_kind_name_index" ON "integration" USING btree ("workspace_id","kind","name");--> statement-breakpoint
ALTER TABLE "handoff" ADD CONSTRAINT "handoff_origin_request_id_request_id_fk" FOREIGN KEY ("origin_request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff" ADD CONSTRAINT "handoff_helper_request_id_request_id_fk" FOREIGN KEY ("helper_request_id") REFERENCES "public"."request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handoff_helper_request_id_index" ON "handoff" USING btree ("helper_request_id");