-- 684_tenant_messaging_number_owner_lock.sql — security fix E1 (Oct 23 2026): a messaging number never moves salons.
-- tenant_messaging_numbers decides which salon an inbound text (STOP / START / a reply) belongs to. Two app write paths
-- once ran `ON CONFLICT (phone_number) DO UPDATE SET tenant_id = <caller>` — any salon owner could type another salon's
-- number and take over its inbound routing (that salon's customers' opt-outs recorded under the attacker → TCPA risk).
-- Both are fixed in code (one write path, registerTenantNumber, refuses another salon's number); this trigger makes the
-- rule hold AT THE DATABASE for every path, present and future: an UPDATE that changes tenant_id is refused.
-- A number that truly must change hands is released and DELETED by its owner (or Super Admin), then registered anew.
-- EXPAND-ONLY, idempotent (function is CREATE OR REPLACE; trigger is dropped + recreated). Writers: modules/communications.
CREATE OR REPLACE FUNCTION tenant_messaging_numbers_owner_lock() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'messaging number % belongs to another tenant; ownership cannot be changed by UPDATE', OLD.phone_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tenant_messaging_numbers_owner_lock ON tenant_messaging_numbers;
CREATE TRIGGER trg_tenant_messaging_numbers_owner_lock BEFORE UPDATE OF tenant_id ON tenant_messaging_numbers
  FOR EACH ROW EXECUTE FUNCTION tenant_messaging_numbers_owner_lock();
