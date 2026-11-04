-- 794_recon_exception_assignee_tenant.sql — Deposit Recon guide audit (Nov 4 2026): a reconciliation case could be assigned to
-- any user id, another salon's included. The service now checks the salon; the database refuses it too (writes only).
DROP TRIGGER IF EXISTS trg_tc_reconciliation_exceptions__assigned_to_user_id ON reconciliation_exceptions;
CREATE TRIGGER trg_tc_reconciliation_exceptions__assigned_to_user_id BEFORE INSERT OR UPDATE OF tenant_id, assigned_to_user_id ON reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('users', 'assigned_to_user_id');
