CREATE TABLE "alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"priority" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"dedup_key" text NOT NULL,
	"product_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"delivery_id" uuid,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_dispatch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"dedup_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"last_error" text,
	"provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_acknowledged_by_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_dispatch" ADD CONSTRAINT "notification_dispatch_alert_id_alert_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alert"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_dispatch" ADD CONSTRAINT "notification_dispatch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_active_dedup_idx" ON "alert" USING btree ("dedup_key") WHERE state <> 'resolved';--> statement-breakpoint
CREATE INDEX "alert_product_state_priority_idx" ON "alert" USING btree ("product_id","state","priority");--> statement-breakpoint
CREATE INDEX "alert_task_idx" ON "alert" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dispatch_dedup_idx" ON "notification_dispatch" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "notification_dispatch_status_idx" ON "notification_dispatch" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "notification_dispatch_alert_idx" ON "notification_dispatch" USING btree ("alert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_user_kind_idx" ON "notification_preference" USING btree ("user_id","kind");