-- 875_money_protection_notification_limits.sql — AI MONEY PROTECTION 5 · 11 "Documented Alert Rate Limits" (extras, Nov 12 2026).
--
-- Until now a Money Protection alert reached nobody: it waited on the Alerts screen. A detection pass now tells the salon OWNER
-- (owner_alerts, audience 'owner' — an alert can be about a manager's own activity) about each new HIGH / CRITICAL alert, with
-- documented limits so the same problem never floods the inbox:
--   • cooldown   — the same rule about the same thing (rule + entity fingerprint) is told at most once per 24 hours;
--   • hourly cap — at most 5 alert notifications per salon per hour; the rest are recorded and ONE roll-up line says how many waited.
-- A limit only holds back the NOTIFICATION: every alert keeps its own row and its own evidence, nothing is merged, and no rule is
-- ever turned off. Each decision — told, held back by the cooldown, held back by the cap — is one row here AND a line in the
-- alert's own history (money_protection_events), so the incident timeline shows exactly what was and was not sent.
-- Append-only (no UPDATE / DELETE). Rollback: DROP TABLE money_protection_notifications.
CREATE TABLE IF NOT EXISTS money_protection_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  alert_id        UUID REFERENCES money_protection_alerts(id),   -- NULL only for the hourly roll-up line
  dedupe_key      TEXT NOT NULL CHECK (length(dedupe_key) <= 400),
  severity        TEXT CHECK (severity IS NULL OR severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  outcome         TEXT NOT NULL CHECK (outcome IN ('sent', 'suppressed')),
  reason          TEXT CHECK (reason IS NULL OR reason IN ('cooldown', 'hourly_cap')),
  owner_alert_id  UUID,                                          -- the inbox line it created (sent only)
  held_until      TIMESTAMPTZ,                                   -- cooldown: when the same key may be told again
  suppressed_n    INTEGER NOT NULL DEFAULT 0,                    -- roll-up line: how many were held back by the cap
  run_id          UUID,                                          -- the detection pass that decided it
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((outcome = 'sent') = (reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mp_notifications_alert ON money_protection_notifications (tenant_id, alert_id) WHERE alert_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mp_notifications_key ON money_protection_notifications (tenant_id, dedupe_key, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mp_notifications_recent ON money_protection_notifications (tenant_id, created_at DESC);

-- B-12: a notification can never point at another salon's alert
DROP TRIGGER IF EXISTS trg_tc_money_protection_notifications__alert_id ON money_protection_notifications;
CREATE TRIGGER trg_tc_money_protection_notifications__alert_id BEFORE INSERT OR UPDATE OF tenant_id, alert_id ON money_protection_notifications
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('money_protection_alerts', 'alert_id');

CREATE OR REPLACE FUNCTION money_protection_notifications_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS trg_money_protection_notifications_append_only ON money_protection_notifications;
CREATE TRIGGER trg_money_protection_notifications_append_only BEFORE UPDATE OR DELETE ON money_protection_notifications
  FOR EACH ROW EXECUTE FUNCTION money_protection_notifications_append_only();
