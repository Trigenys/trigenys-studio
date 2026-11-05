CREATE TABLE "import_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin" text NOT NULL,
	"external_ref" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"summary" text DEFAULT '' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"task_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_item" ADD CONSTRAINT "import_item_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_item" ADD CONSTRAINT "import_item_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_item_origin_ref_idx" ON "import_item" USING btree ("origin","external_ref");--> statement-breakpoint
CREATE INDEX "import_item_status_idx" ON "import_item" USING btree ("status","observed_at");