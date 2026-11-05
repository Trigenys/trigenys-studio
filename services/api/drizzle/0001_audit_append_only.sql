-- audit_event is append-only. A trigger enforces it for every role, including
-- the table owner, so no privilege configuration can silently weaken it.
CREATE OR REPLACE FUNCTION audit_event_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_event_append_only ON "audit_event";
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_reject_change();
