CREATE TABLE "contract_objective" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"metric" text NOT NULL,
	"task_type" text,
	"channel" text,
	"period" text DEFAULT 'month' NOT NULL,
	"target" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_objective_target_check" CHECK ("contract_objective"."target" > 0)
);
--> statement-breakpoint
CREATE TABLE "metric_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_ref" text NOT NULL,
	"delivery_id" uuid,
	"task_id" uuid,
	"provider" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "seo_monitor_url" text;--> statement-breakpoint
ALTER TABLE "contract_objective" ADD CONSTRAINT "contract_objective_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_objective" ADD CONSTRAINT "contract_objective_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_objective_scope_idx" ON "contract_objective" USING btree ("product_id","metric",coalesce("task_type", ''),coalesce("channel", ''),"period") WHERE active;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshot_dedupe_idx" ON "metric_snapshot" USING btree ("provider","target_kind","target_ref","measured_at");--> statement-breakpoint
CREATE INDEX "metric_snapshot_target_idx" ON "metric_snapshot" USING btree ("target_kind","target_ref","fetched_at");--> statement-breakpoint
CREATE INDEX "metric_snapshot_product_idx" ON "metric_snapshot" USING btree ("product_id","measured_at");--> statement-breakpoint
CREATE INDEX "delivery_sent_at_idx" ON "delivery" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "task_transition_to_state_idx" ON "task_transition" USING btree ("to_state","created_at");