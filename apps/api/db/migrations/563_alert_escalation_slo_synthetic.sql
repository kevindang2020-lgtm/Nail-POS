-- 563_alert_escalation_slo_synthetic.sql — BUILD_PLAN Phase 14 C (Constitution 11 §262–265, §80, §94–95, D8).
--
-- 1. oncall_contacts / alert_escalations (§262–265): an on-call chain beyond "email every Super Admin once + one reminder".
--    A paged platform alert (critical / high) walks the chain in `position` order, filtered by the alert's owner (§262
--    routing by component / severity / owner); a step not acknowledged within the severity's window escalates to the next
--    contact. Acknowledgement is tracked per alert (§265: created → acknowledged → resolved), from the Super Admin screen
--    or from a signed, single-use, expiring link in the email (only the SHA-256 of the link's nonce is stored).
-- 2. slo_validations (§80): each PROPOSED SLO's verdict from persisted request metrics — validated only after N days of
--    real data met the target, breached when they did not. Never seeded.
-- 3. synthetic_monitoring_settings / synthetic_probe_results (§92–95): the ONE test salon Kevin designates (default none →
--    the kiosk probe reports "not configured"), and the latest result of every probe across processes (rows = probes).
-- 4. observability_signal_state (D8): the last break-glass mode seen, so a toggle opens ONE security incident fleet-wide.
-- Platform tables (no tenant_id): monitoring configuration and platform alert state, read only by Super Admin.

CREATE TABLE IF NOT EXISTS oncall_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position      INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50),
  role          TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'secondary', 'incident_commander', 'other')),
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  channel       TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
  -- email address, E.164 phone, or the Super Admin user id for push. Contact data Kevin enters — never a credential.
  destination   TEXT NOT NULL CHECK (length(destination) BETWEEN 3 AND 254),
  -- §262: the owners (alert routing teams) this contact covers; empty = every owner.
  owners        TEXT[] NOT NULL DEFAULT '{}',
  quiet_start   TEXT CHECK (quiet_start IS NULL OR quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end     TEXT CHECK (quiet_end IS NULL OR quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone      TEXT NOT NULL DEFAULT 'America/New_York',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_by    UUID
);
CREATE INDEX IF NOT EXISTS idx_oncall_contacts_order ON oncall_contacts (active, position, created_at);

CREATE TABLE IF NOT EXISTS alert_escalations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id          UUID NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  step              INTEGER NOT NULL CHECK (step >= 1),
  contact_id        UUID REFERENCES oncall_contacts (id) ON DELETE SET NULL,
  contact_name      TEXT,
  channel           TEXT CHECK (channel IS NULL OR channel IN ('email', 'sms', 'push')),
  outcome           TEXT NOT NULL CHECK (outcome IN ('sent', 'failed', 'not_configured', 'skipped_quiet_hours', 'chain_exhausted')),
  notified_at       TIMESTAMPTZ NOT NULL,
  escalated_at      TIMESTAMPTZ,
  acknowledged_at   TIMESTAMPTZ,
  acknowledged_by   UUID,
  acknowledged_via  TEXT CHECK (acknowledged_via IS NULL OR acknowledged_via IN ('screen', 'email_link')),
  ack_nonce_hash    TEXT,
  ack_expires_at    TIMESTAMPTZ,
  ack_used_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, step)
);
CREATE INDEX IF NOT EXISTS idx_alert_escalations_open ON alert_escalations (alert_id, step DESC) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_escalations_notified ON alert_escalations (notified_at);

CREATE TABLE IF NOT EXISTS slo_validations (
  slo_id          TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'validated', 'breached')),
  target          DOUBLE PRECISION NOT NULL,
  window_days     INTEGER NOT NULL,
  required_days   INTEGER NOT NULL,
  days_with_data  INTEGER NOT NULL DEFAULT 0,
  total           BIGINT NOT NULL DEFAULT 0,
  bad             BIGINT NOT NULL DEFAULT 0,
  sli             DOUBLE PRECISION,
  evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at    TIMESTAMPTZ,
  breached_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS synthetic_monitoring_settings (
  id              BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  test_tenant_id  UUID REFERENCES tenants (id) ON DELETE SET NULL,
  reason          TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID
);

CREATE TABLE IF NOT EXISTS synthetic_probe_results (
  probe                 TEXT PRIMARY KEY,
  outcome               TEXT NOT NULL CHECK (outcome IN ('pass', 'fail', 'skipped')),
  detail                TEXT NOT NULL,
  duration_ms           INTEGER NOT NULL DEFAULT 0,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  instance_id           TEXT,
  ran_at                TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS observability_signal_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
