-- 764_churn_watch_center.sql — Churn Watch guide (Nov 1 2026).
-- Additive only. Rollback: DROP TABLE churn_watch_health_runs, churn_watch_review_events, churn_watch_reviews; ALTER TABLE
-- customer_intelligence_snapshots DROP COLUMN churn_level, churn_confidence, churn_evidence, canceled_count, no_show_count,
-- membership_canceled, churn_since.
--
-- Churn Watch keeps no second rules engine and no second customer list. The ONE Customer Intelligence scan (763) now also
-- runs the assistant's existing churn rule (evaluateChurnRisk: insufficient · low · possible · elevated · high, with its
-- cancellation / no-show / cancelled-membership inputs) and stores the result beside the activity state. `churn_since`
-- carries the first scan that saw the current signal, so "signal generated" is a real date, not the last scan's time.
-- The review workflow is Churn Watch's own (and is never a customer status):
--   • churn_watch_reviews        — current review state per customer: reviewed / deferred (+ the level it was reviewed at).
--   • churn_watch_review_events  — append-only history: reviewed, deferred, reopened, note.
--   • churn_watch_health_runs    — the read-only Check run's evidence.

ALTER TABLE customer_intelligence_snapshots
  ADD COLUMN IF NOT EXISTS churn_level         TEXT CHECK (churn_level IS NULL OR churn_level IN ('insufficient', 'low', 'possible', 'elevated', 'high')),
  ADD COLUMN IF NOT EXISTS churn_confidence    TEXT,
  ADD COLUMN IF NOT EXISTS churn_evidence      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS canceled_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS membership_canceled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS churn_since         TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ix_customer_intelligence_snap_churn ON customer_intelligence_snapshots (tenant_id, churn_level, churn_since DESC);

CREATE TABLE IF NOT EXISTS churn_watch_reviews (
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  customer_id    UUID NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('reviewed', 'deferred')),
  level_at_review TEXT,
  due_on         DATE,
  reviewed_by    UUID,
  reviewed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,
  version        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, customer_id)
);
CREATE INDEX IF NOT EXISTS ix_churn_watch_reviews_recent ON churn_watch_reviews (tenant_id, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS churn_watch_review_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  customer_id   UUID NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('reviewed', 'deferred', 'reopened', 'note')),
  level         TEXT,
  note          TEXT CHECK (note IS NULL OR length(note) <= 1000),
  actor_user_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_churn_watch_review_events_recent ON churn_watch_review_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_churn_watch_review_events_customer ON churn_watch_review_events (tenant_id, customer_id, created_at DESC);
CREATE OR REPLACE FUNCTION churn_watch_review_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'churn_watch_review_events is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_churn_watch_review_events_append_only ON churn_watch_review_events;
CREATE TRIGGER trg_churn_watch_review_events_append_only BEFORE UPDATE OR DELETE ON churn_watch_review_events
  FOR EACH ROW EXECUTE FUNCTION churn_watch_review_events_append_only();

CREATE TABLE IF NOT EXISTS churn_watch_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_churn_watch_health_recent ON churn_watch_health_runs (tenant_id, created_at DESC);
