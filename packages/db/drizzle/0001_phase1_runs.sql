ALTER TABLE "message" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_request_id_index" ON "message" USING btree ("request_id");