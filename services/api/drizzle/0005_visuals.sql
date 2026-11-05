CREATE TABLE "brand_kit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL,
	"n" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"palette" jsonb NOT NULL,
	"font_family" text NOT NULL,
	"default_title" text,
	"mentions" text DEFAULT '' NOT NULL,
	"logo_key" text NOT NULL,
	"logo_mime" text NOT NULL,
	"logo_hash" text NOT NULL,
	"logo_bytes" integer NOT NULL,
	"kit_hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "visual_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"format_id" text NOT NULL,
	"brand_kit_id" uuid NOT NULL,
	"brand_kit_hash" text NOT NULL,
	"content_version_id" uuid,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"variant" integer NOT NULL,
	"renderer" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"content_hash" text NOT NULL,
	"storage_key" text NOT NULL,
	"byte_size" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discarded_by" text,
	"discarded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "visual_format" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"channel" text,
	"layout" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_asset" ADD CONSTRAINT "visual_asset_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_asset" ADD CONSTRAINT "visual_asset_format_id_visual_format_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."visual_format"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_asset" ADD CONSTRAINT "visual_asset_brand_kit_id_brand_kit_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_asset" ADD CONSTRAINT "visual_asset_content_version_id_content_version_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_asset" ADD CONSTRAINT "visual_asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_asset" ADD CONSTRAINT "visual_asset_discarded_by_user_id_fk" FOREIGN KEY ("discarded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kit_product_n_idx" ON "brand_kit" USING btree ("product_id","n");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kit_one_approved_idx" ON "brand_kit" USING btree ("product_id") WHERE status = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "visual_asset_task_format_variant_idx" ON "visual_asset" USING btree ("task_id","format_id","variant");--> statement-breakpoint
CREATE UNIQUE INDEX "visual_asset_active_hash_idx" ON "visual_asset" USING btree ("task_id","content_hash") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "visual_asset_task_status_idx" ON "visual_asset" USING btree ("task_id","status");