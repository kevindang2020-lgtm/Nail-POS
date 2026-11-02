-- 641_tenant_messaging_numbers_actor_stamp.sql — Payments / Twilio mandate (wave 3 PAYI) follow-up to 639.
-- 639 gave tenant_messaging_numbers an updated_at; check:actor-stamp requires the matching actor column so a number's
-- registration / re-activation names WHO did it (§55 / §137 audit trail beside the audit_events row).
-- Additive, nullable, no backfill, no lock beyond the catalog update — safe on a running salon.
ALTER TABLE tenant_messaging_numbers ADD COLUMN IF NOT EXISTS updated_by UUID;   -- actor stamp (check:actor-stamp)
