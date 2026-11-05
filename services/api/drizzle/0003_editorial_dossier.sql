CREATE TABLE "ai_interaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"action" text NOT NULL,
	"channel" text NOT NULL,
	"instruction" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"actor_id" text,
	"context_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"output" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"accepted_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"note" text DEFAULT '' NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_interaction" ADD CONSTRAINT "ai_interaction_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_interaction" ADD CONSTRAINT "ai_interaction_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_interaction" ADD CONSTRAINT "ai_interaction_accepted_version_id_content_version_id_fk" FOREIGN KEY ("accepted_version_id") REFERENCES "public"."content_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_source" ADD CONSTRAINT "task_source_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_source" ADD CONSTRAINT "task_source_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_interaction_task_idx" ON "ai_interaction" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_source_task_idx" ON "task_source" USING btree ("task_id");