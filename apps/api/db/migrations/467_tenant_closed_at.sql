-- 467_tenant_closed_at.sql — Constitution 7 §21: CLOSED → retention → ARCHIVED. closed_at records when the retention
-- clock started. The lifecycle trigger (migration 463) keeps it for every writer: set when a tenant enters CLOSED (by the
-- lifecycle or by a legacy status = 'cancelled' write), kept through ARCHIVED, cleared if it ever leaves CLOSED/ARCHIVED.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NULL;
UPDATE tenants SET closed_at = COALESCE(updated_at, now()) WHERE lifecycle_state IN ('CLOSED','ARCHIVED') AND closed_at IS NULL;

CREATE OR REPLACE FUNCTION tenants_lifecycle_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
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
  -- §21 retention clock
  IF NEW.lifecycle_state IN ('CLOSED','ARCHIVED') THEN
    IF NEW.closed_at IS NULL THEN NEW.closed_at := now(); END IF;
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
