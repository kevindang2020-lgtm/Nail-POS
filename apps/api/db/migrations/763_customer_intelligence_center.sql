-- 763_customer_intelligence_center.sql — Customer Intelligence guide (Nov 1 2026).
-- Additive only. Rollback: DROP TABLE customer_intelligence_health_runs, customer_intelligence_snapshots,
-- customer_intelligence_scans. No customer, booking, ticket, loyalty or retention row is read-and-rewritten here.
--
-- Before: the six cards came from a cached in-memory aggregate that read two API lists PER customer, stopped at 300
-- customers, and showed only two of its six activity states (so "15 scanned / 1 active / 0 inactive" could not be
-- explained on screen). Now one bounded, set-based scan per salon classifies every live profile with the SAME rules
-- (summarizeVisits + classifyInactivity + rebookingOpportunity, the salon's own tunables) and records:
--   • customer_intelligence_scans      — each scan: rule version, tunables used, every state's count (they sum to the
--                                        scanned total), duration, failure — the dashboard's real freshness.
--   • customer_intelligence_snapshots  — the latest classification per customer (derived, rebuildable, never a second
--                                        customer master: identity, visits and bookings stay in their owners).
--   • customer_intelligence_health_runs — the read-only Check run's evidence (rate-limited per salon).

CREATE TABLE IF NOT EXISTS customer_intelligence_scans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  actor_user_id     UUID,
  trigger_kind      TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual', 'auto', 'scheduled')),
  rule_version      TEXT NOT NULL,
  tunables          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  scanned           INTEGER NOT NULL DEFAULT 0,
  counts            JSONB NOT NULL DEFAULT '{}'::jsonb,   -- per state + churn / rebooking / upcoming / never served / under cadence
  archived_excluded INTEGER NOT NULL DEFAULT 0,
  duration_ms       INTEGER,
  error_code        TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_customer_intelligence_scans_recent ON customer_intelligence_scans (tenant_id, started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS customer_intelligence_snapshots (
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  customer_id           UUID NOT NULL,
  scan_id               UUID NOT NULL REFERENCES customer_intelligence_scans(id),
  status                TEXT NOT NULL CHECK (status IN ('active', 'rebooking_soon', 'due_for_return', 'inactive', 'long_term_inactive', 'insufficient_history')),
  completed_visits      INTEGER NOT NULL DEFAULT 0,
  first_visit_at        TIMESTAMPTZ,
  last_visit_at         TIMESTAMPTZ,
  typical_interval_days INTEGER,
  days_since_last       INTEGER,
  has_upcoming          BOOLEAN NOT NULL DEFAULT false,
  next_appointment_date DATE,
  churn_watch           BOOLEAN NOT NULL DEFAULT false,
  rebooking             BOOLEAN NOT NULL DEFAULT false,
  rebooking_reason      TEXT,
  evidence              TEXT[] NOT NULL DEFAULT '{}',
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id)
);
CREATE INDEX IF NOT EXISTS ix_customer_intelligence_snap_status ON customer_intelligence_snapshots (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_customer_intelligence_snap_last ON customer_intelligence_snapshots (tenant_id, last_visit_at DESC NULLS LAST, customer_id);
CREATE INDEX IF NOT EXISTS ix_customer_intelligence_snap_flags ON customer_intelligence_snapshots (tenant_id) WHERE churn_watch OR rebooking;

CREATE TABLE IF NOT EXISTS customer_intelligence_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_customer_intelligence_health_recent ON customer_intelligence_health_runs (tenant_id, created_at DESC);
