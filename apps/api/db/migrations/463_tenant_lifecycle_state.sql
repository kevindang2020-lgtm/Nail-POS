-- 463_tenant_lifecycle_state.sql — Constitution 7 §16: explicit tenant lifecycle states (decision D6).
--
-- tenants.status stays the ACCESS gate (pending / active / suspended / cancelled) that the session middleware, realtime
-- revalidation, RLS and many services already read. lifecycle_state carries §16's vocabulary. Each lifecycle state maps
-- to exactly ONE access status, and the database keeps the two consistent for EVERY writer:
--   • a write that changes lifecycle_state sets status from it;
--   • a legacy write that changes only status keeps a lifecycle state that already maps to the new status (PAST_DUE stays
--     PAST_DUE on a no-op 'active' write), and otherwise moves to that status's default lifecycle state;
--   • an INSERT keeps its status; a lifecycle state is kept only if it fits it (else the status's default);
--   • a CHECK makes an inconsistent pair impossible, whatever the trigger does.
-- Backfill: active → ACTIVE, pending → ONBOARDING, suspended → SUSPENDED, cancelled → CLOSED.
CREATE OR REPLACE FUNCTION tenant_status_for_lifecycle(s TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s WHEN 'ACTIVE' THEN 'active' WHEN 'PAST_DUE' THEN 'active'
                WHEN 'RESTRICTED' THEN 'suspended' WHEN 'SUSPENDED' THEN 'suspended'
                WHEN 'DRAFT' THEN 'pending' WHEN 'ONBOARDING' THEN 'pending' WHEN 'PENDING_APPROVAL' THEN 'pending'
                WHEN 'CLOSED' THEN 'cancelled' WHEN 'ARCHIVED' THEN 'cancelled' END $$;
CREATE OR REPLACE FUNCTION tenant_default_lifecycle(st TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE st WHEN 'active' THEN 'ACTIVE' WHEN 'suspended' THEN 'SUSPENDED' WHEN 'pending' THEN 'ONBOARDING' WHEN 'cancelled' THEN 'CLOSED' END $$;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NULL;
UPDATE tenants SET lifecycle_state = tenant_default_lifecycle(status) WHERE lifecycle_state IS NULL;

CREATE OR REPLACE FUNCTION tenants_lifecycle_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- every existing INSERT names a status and no lifecycle: status wins, and a lifecycle state is kept only when it
    -- already fits that status (an unknown or missing one becomes the status's default)
    IF tenant_status_for_lifecycle(NEW.lifecycle_state) IS DISTINCT FROM NEW.status THEN
      NEW.lifecycle_state := tenant_default_lifecycle(NEW.status);
    END IF;
  ELSE
    IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
      NEW.status := tenant_status_for_lifecycle(NEW.lifecycle_state);
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND tenant_status_for_lifecycle(OLD.lifecycle_state) IS DISTINCT FROM NEW.status THEN
      NEW.lifecycle_state := tenant_default_lifecycle(NEW.status);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tenants_lifecycle_sync ON tenants;
CREATE TRIGGER trg_tenants_lifecycle_sync BEFORE INSERT OR UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_lifecycle_sync();

ALTER TABLE tenants ALTER COLUMN lifecycle_state SET NOT NULL;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_lifecycle_state_vocab;
ALTER TABLE tenants ADD CONSTRAINT tenants_lifecycle_state_vocab CHECK (lifecycle_state IN
  ('DRAFT','ONBOARDING','PENDING_APPROVAL','ACTIVE','PAST_DUE','RESTRICTED','SUSPENDED','CLOSED','ARCHIVED'));
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_lifecycle_matches_status;
ALTER TABLE tenants ADD CONSTRAINT tenants_lifecycle_matches_status CHECK (tenant_status_for_lifecycle(lifecycle_state) = status);
