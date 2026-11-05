-- 450_tenant_consistency_triggers.sql — Constitution 12 §28–30, §32: a crossed salon id can no longer be WRITTEN.
--
-- Constitution 11 DETECTS crossed rows (integrity-checks.ts, 18 invariants). This PREVENTS new ones, at the database,
-- for the same 18 relationships: an insert or update whose child row names a parent belonging to another salon is
-- refused, whatever code path wrote it (§32: tenant tampering in any layer).
--
-- WHY TRIGGERS, NOT COMPOSITE FOREIGN KEYS (the audit's first plan, D2 — revised): most of these relationships have no
-- foreign key today. A composite FK would suddenly make DELETING a parent that is still referenced fail (a customer
-- with tickets), which customer merge/dedupe flows may rely on, and it needs UNIQUE (tenant_id, id) on nine hot tables.
-- A trigger checks only the WRITE of the child row: delete and orphan behaviour are exactly what they were.
--
-- Rules: NULL on either side is not a mismatch (optional links, platform rows); a parent that does not exist is left
-- to whatever handled it before (this is about salons, not orphans). Existing rows are not touched — C11 finds them.
CREATE OR REPLACE FUNCTION enforce_tenant_consistency() RETURNS trigger AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  fk_column    text := TG_ARGV[1];
  ref_id       text := to_jsonb(NEW) ->> fk_column;
  parent_tenant uuid;
BEGIN
  IF NEW.tenant_id IS NULL OR ref_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT tenant_id FROM %I WHERE id::text = $1', parent_table) INTO parent_tenant USING ref_id;
  IF parent_tenant IS NOT NULL AND parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'cross-tenant reference refused: %.% names a % row owned by another tenant', TG_TABLE_NAME, fk_column, parent_table
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tc_appointment_customer ON pos_tech_appointments;
CREATE TRIGGER trg_tc_appointment_customer BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON pos_tech_appointments FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
DROP TRIGGER IF EXISTS trg_tc_appointment_technician ON pos_tech_appointments;
CREATE TRIGGER trg_tc_appointment_technician BEFORE INSERT OR UPDATE OF tenant_id, technician_id ON pos_tech_appointments FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('technicians', 'technician_id');
DROP TRIGGER IF EXISTS trg_tc_appointment_branch ON pos_tech_appointments;
CREATE TRIGGER trg_tc_appointment_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON pos_tech_appointments FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
DROP TRIGGER IF EXISTS trg_tc_queue_customer ON pos_queue_items;
CREATE TRIGGER trg_tc_queue_customer BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON pos_queue_items FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
DROP TRIGGER IF EXISTS trg_tc_queue_branch ON pos_queue_items;
CREATE TRIGGER trg_tc_queue_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON pos_queue_items FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
DROP TRIGGER IF EXISTS trg_tc_queue_technician ON pos_queue_items;
CREATE TRIGGER trg_tc_queue_technician BEFORE INSERT OR UPDATE OF tenant_id, assigned_technician_id ON pos_queue_items FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('technicians', 'assigned_technician_id');
DROP TRIGGER IF EXISTS trg_tc_queue_ticket ON pos_queue_items;
CREATE TRIGGER trg_tc_queue_ticket BEFORE INSERT OR UPDATE OF tenant_id, ticket_id ON pos_queue_items FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('tickets', 'ticket_id');
DROP TRIGGER IF EXISTS trg_tc_ticket_customer ON tickets;
CREATE TRIGGER trg_tc_ticket_customer BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON tickets FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
DROP TRIGGER IF EXISTS trg_tc_ticket_branch ON tickets;
CREATE TRIGGER trg_tc_ticket_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON tickets FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
DROP TRIGGER IF EXISTS trg_tc_ticket_technician ON tickets;
CREATE TRIGGER trg_tc_ticket_technician BEFORE INSERT OR UPDATE OF tenant_id, primary_technician_id ON tickets FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('technicians', 'primary_technician_id');
DROP TRIGGER IF EXISTS trg_tc_payment_ticket ON payments;
CREATE TRIGGER trg_tc_payment_ticket BEFORE INSERT OR UPDATE OF tenant_id, ticket_id ON payments FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('tickets', 'ticket_id');
DROP TRIGGER IF EXISTS trg_tc_refund_payment ON payment_refunds;
CREATE TRIGGER trg_tc_refund_payment BEFORE INSERT OR UPDATE OF tenant_id, payment_id ON payment_refunds FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payments', 'payment_id');
DROP TRIGGER IF EXISTS trg_tc_intent_ticket ON payment_intents;
CREATE TRIGGER trg_tc_intent_ticket BEFORE INSERT OR UPDATE OF tenant_id, ticket_id ON payment_intents FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('tickets', 'ticket_id');
DROP TRIGGER IF EXISTS trg_tc_intent_customer ON payment_intents;
CREATE TRIGGER trg_tc_intent_customer BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON payment_intents FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
DROP TRIGGER IF EXISTS trg_tc_technician_branch ON technicians;
CREATE TRIGGER trg_tc_technician_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON technicians FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
DROP TRIGGER IF EXISTS trg_tc_customer_branch ON customers;
CREATE TRIGGER trg_tc_customer_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON customers FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
DROP TRIGGER IF EXISTS trg_tc_gift_card_customer ON gift_cards;
CREATE TRIGGER trg_tc_gift_card_customer BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON gift_cards FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
DROP TRIGGER IF EXISTS trg_tc_membership_customer ON customer_memberships;
CREATE TRIGGER trg_tc_membership_customer BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON customer_memberships FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
