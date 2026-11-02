-- 525_queue_domain_history.sql — BUILD_PLAN Phase 6 (ai_queue_assignment → complete), the queue domain.
--
-- Expand-only. Migration 524 gave pos_queue_items a VERSION and pos_queue_status_history; this makes them TRUE for
-- every writer, not only the POS Queue screen. Five modules update pos_queue_items (queue, check-in, serving,
-- service-done, tech, booking); a version or a history row written by one of them and not the others would be a
-- second, partial state model. So the database does it, once, in the writer's own transaction:
--   • BEFORE UPDATE: any change to what the queue acts on (status, technician, requested technician, position, party,
--     priority, services) — or a write the app labels with an action (lock, unlock …) — bumps `version` and stamps the
--     REAL `updated_at` (audit bug 3: stuck detection read "now" for every row; several writers never touched
--     updated_at at all).
--   • AFTER INSERT / UPDATE: one pos_queue_status_history row (from → to status and technician, version, action,
--     source, actor, reason). The app describes the write with transaction-local settings
--     (app.queue_action / app.queue_source / app.queue_actor / app.queue_reason / app.queue_idempotency_key); a writer
--     that sets none is recorded as source 'system' with an action derived from what changed.
--   • BEFORE INSERT: `previous_technician_id` — the technician of this customer's last finished visit — is stamped at
--     check-in when the writer did not set it (audit bug 1: "previous technician" never reached the engine; four
--     different code paths create queue rows).
-- Idempotency: an assignment carrying an idempotency key records it on its history row; the key is unique per salon, so
-- a retried assignment can never write twice.

-- A system actor (the background auto-run) has no user — its audit rows were impossible with user_id NOT NULL.
ALTER TABLE pos_queue_audit ALTER COLUMN user_id DROP NOT NULL;
-- Legacy queue rows without a branch still get their history (a NOT NULL here would fail the business write itself).
ALTER TABLE pos_queue_status_history ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE pos_queue_status_history ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_queue_status_history_idem
  ON pos_queue_status_history (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION pos_queue_items_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_action TEXT := NULLIF(current_setting('app.queue_action', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.previous_technician_id IS NULL AND NEW.customer_id IS NOT NULL THEN
      SELECT t.primary_technician_id INTO NEW.previous_technician_id
        FROM tickets t
       WHERE t.tenant_id = NEW.tenant_id AND t.customer_id = NEW.customer_id
         AND t.primary_technician_id IS NOT NULL
         AND (t.service_done_at IS NOT NULL OR t.paid_at IS NOT NULL)
         AND t.status NOT IN ('cancelled', 'canceled', 'void', 'voided', 'removed')
       ORDER BY COALESCE(t.service_done_at, t.paid_at) DESC
       LIMIT 1;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id
     OR NEW.requested_technician_id IS DISTINCT FROM OLD.requested_technician_id
     OR NEW.position IS DISTINCT FROM OLD.position
     OR NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.requested_services IS DISTINCT FROM OLD.requested_services
     OR v_action IS NOT NULL THEN
    IF NEW.version = OLD.version THEN NEW.version := OLD.version + 1; END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pos_queue_items_after_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_action TEXT := NULLIF(current_setting('app.queue_action', true), '');
  v_source TEXT := COALESCE(NULLIF(current_setting('app.queue_source', true), ''), 'system');
  v_actor  TEXT := NULLIF(current_setting('app.queue_actor', true), '');
  v_reason TEXT := NULLIF(current_setting('app.queue_reason', true), '');
  v_idem   TEXT := NULLIF(current_setting('app.queue_idempotency_key', true), '');
BEGIN
  IF v_actor IS NOT NULL AND v_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_actor := NULL; END IF;
  IF v_source NOT IN ('staff', 'ai_suggestion', 'auto_assign', 'repair', 'system', 'customer', 'kiosk', 'technician') THEN v_source := 'system'; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO pos_queue_status_history (tenant_id, branch_id, queue_item_id, version, from_status, to_status, from_technician, to_technician, action, source, actor_id, reason)
    VALUES (NEW.tenant_id, NEW.branch_id, NEW.id, NEW.version, NULL, NEW.status, NULL, NEW.assigned_technician_id, 'check_in', v_source, v_actor::uuid, v_reason);
    RETURN NULL;
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version THEN
    INSERT INTO pos_queue_status_history (tenant_id, branch_id, queue_item_id, version, from_status, to_status, from_technician, to_technician, action, source, actor_id, reason, idempotency_key)
    VALUES (NEW.tenant_id, NEW.branch_id, NEW.id, NEW.version, OLD.status, NEW.status, OLD.assigned_technician_id, NEW.assigned_technician_id,
            COALESCE(v_action,
              CASE WHEN NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id
                     THEN CASE WHEN NEW.assigned_technician_id IS NULL THEN 'unassign' ELSE 'assign' END
                   WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'status'
                   ELSE 'update' END),
            v_source, v_actor::uuid, v_reason, v_idem);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_pos_queue_items_before_write ON pos_queue_items;
CREATE TRIGGER trg_pos_queue_items_before_write BEFORE INSERT OR UPDATE ON pos_queue_items
  FOR EACH ROW EXECUTE FUNCTION pos_queue_items_before_write();
DROP TRIGGER IF EXISTS trg_pos_queue_items_after_write ON pos_queue_items;
CREATE TRIGGER trg_pos_queue_items_after_write AFTER INSERT OR UPDATE ON pos_queue_items
  FOR EACH ROW EXECUTE FUNCTION pos_queue_items_after_write();
