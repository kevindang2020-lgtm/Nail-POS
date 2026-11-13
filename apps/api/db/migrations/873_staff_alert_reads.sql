-- 873_staff_alert_reads.sql — durable, per-person read state for salon alerts + the badge-sync record per session
-- (extras round 9: AI BUSINESS ALERTS 05 "notification unread integrity", Global Loyalty Rewards 08 "safe notification read
-- sync", Customer Notifications 04 "cross-device reconciliation monitor").
--
-- owner_alerts.status is the alert's LIFECYCLE (new → acknowledged → resolved / dismissed) and is shared by the whole salon.
-- Until now "unread" meant status = 'new', so one person opening an alert would have had to acknowledge it for everyone.
-- staff_alert_reads is the separate, per-person "I have seen this" record: one row per (salon, person, alert). Writing it
-- never changes owner_alerts (the failure stays open until someone acknowledges / resolves it through the lifecycle).
-- Reading it on every device of that person is what makes the badge clear across tabs and devices.
--
-- staff_badge_syncs: one row per signed-in session — when that session last APPLIED a fresh unread count (the POS reports it
-- after a successful read) and what count it showed. The monitor compares those rows with the person's live sessions and
-- the current count to name stale or broken clients. Bookkeeping only; it holds no message content.
CREATE TABLE IF NOT EXISTS staff_alert_reads (
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  user_id          UUID NOT NULL REFERENCES users(id),
  alert_id         UUID NOT NULL REFERENCES owner_alerts(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_session_id  TEXT CHECK (read_session_id IS NULL OR length(read_session_id) <= 100),
  PRIMARY KEY (tenant_id, user_id, alert_id)
);
CREATE INDEX IF NOT EXISTS ix_staff_alert_reads_alert ON staff_alert_reads (tenant_id, alert_id);

DROP TRIGGER IF EXISTS trg_tc_staff_alert_reads__user_id ON staff_alert_reads;
CREATE TRIGGER trg_tc_staff_alert_reads__user_id BEFORE INSERT OR UPDATE OF tenant_id, user_id ON staff_alert_reads
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('users', 'user_id');
DROP TRIGGER IF EXISTS trg_tc_staff_alert_reads__alert_id ON staff_alert_reads;
CREATE TRIGGER trg_tc_staff_alert_reads__alert_id BEFORE INSERT OR UPDATE OF tenant_id, alert_id ON staff_alert_reads
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('owner_alerts', 'alert_id');

CREATE TABLE IF NOT EXISTS staff_badge_syncs (
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  session_id      TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 100),
  surface         TEXT NOT NULL DEFAULT 'pos' CHECK (surface IN ('pos', 'owner_app', 'tech_app')),
  first_sync_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_unread     INTEGER NOT NULL CHECK (last_unread >= 0),
  sync_count      INTEGER NOT NULL DEFAULT 1 CHECK (sync_count >= 1),
  PRIMARY KEY (tenant_id, user_id, session_id)
);
CREATE INDEX IF NOT EXISTS ix_staff_badge_syncs_user ON staff_badge_syncs (tenant_id, user_id, last_sync_at DESC);

DROP TRIGGER IF EXISTS trg_tc_staff_badge_syncs__user_id ON staff_badge_syncs;
CREATE TRIGGER trg_tc_staff_badge_syncs__user_id BEFORE INSERT OR UPDATE OF tenant_id, user_id ON staff_badge_syncs
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('users', 'user_id');
