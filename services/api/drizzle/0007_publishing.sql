CREATE TABLE "delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"content_version_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"idempotency_key" text NOT NULL,
	"external_id" text,
	"permalink" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"external_id" text,
	"error" text,
	"retry_after_s" integer
);
--> statement-breakpoint
CREATE TABLE "social_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"external_ref" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_social_account_id_social_account_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_content_version_id_content_version_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_active_target_idx" ON "delivery" USING btree ("task_id","social_account_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_idempotency_key_idx" ON "delivery" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_external_id_idx" ON "delivery" USING btree ("external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "delivery_status_scheduled_idx" ON "delivery" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "delivery_task_idx" ON "delivery" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempt_n_idx" ON "delivery_attempt" USING btree ("delivery_id","n");--> statement-breakpoint
CREATE UNIQUE INDEX "social_account_provider_ref_idx" ON "social_account" USING btree ("product_id","provider","external_ref");--> statement-breakpoint
CREATE INDEX "social_account_product_channel_idx" ON "social_account" USING btree ("product_id","channel");