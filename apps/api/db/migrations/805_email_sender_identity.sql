-- 805_email_sender_identity.sql — C2 audit (Nov 4 2026): the Email health check reads the sending domain's SPF / DKIM / DMARC
-- from public DNS; the per-record result of each check is kept beside its overall sender_identity (verified / failed / unknown).
ALTER TABLE email_health_checks ADD COLUMN IF NOT EXISTS sender_identity_json JSONB;
