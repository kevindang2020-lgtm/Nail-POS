-- 951_deal_versions_immutable.sql — extras Promotions Management 14 "Version and Audit Timeline" (round 10, Nov 13 2026):
-- deal_versions is the snapshot of the terms a customer saw at each version, and deal_redemptions.deal_version names the
-- version each redemption used. A status move bumps the version without a new snapshot, so a redemption at version N used
-- the latest snapshot at or before N. A version can never be changed, and a snapshot that a redemption at or after it may
-- have used can never be removed (a never-redeemed draft's versions may still go with the draft — the assistant's take-back
-- path). PG16, no pgcrypto.
-- Rollback: DROP TRIGGER trg_deal_versions_immutable ON deal_versions; DROP FUNCTION deal_versions_immutable();
CREATE OR REPLACE FUNCTION deal_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'deal_versions is immutable: version % of deal % cannot be changed', OLD.version, OLD.deal_id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM deal_redemptions r WHERE r.tenant_id = OLD.tenant_id AND r.deal_id = OLD.deal_id AND r.deal_version >= OLD.version) THEN
    RAISE EXCEPTION 'deal_versions is immutable: version % of deal % was used by a redemption', OLD.version, OLD.deal_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_deal_versions_immutable ON deal_versions;
CREATE TRIGGER trg_deal_versions_immutable BEFORE UPDATE OR DELETE ON deal_versions
  FOR EACH ROW EXECUTE FUNCTION deal_versions_immutable();
