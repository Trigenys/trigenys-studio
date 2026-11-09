ALTER TABLE "notification_dispatch" ALTER COLUMN "alert_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_dispatch" ADD COLUMN "kind" text DEFAULT 'alert' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_dispatch" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_dispatch" ADD CONSTRAINT "notification_dispatch_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_dispatch_task_idx" ON "notification_dispatch" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "notification_dispatch" ADD CONSTRAINT "notification_dispatch_subject_chk" CHECK ((kind = 'alert' AND alert_id IS NOT NULL) OR (kind = 'task_assigned' AND task_id IS NOT NULL));