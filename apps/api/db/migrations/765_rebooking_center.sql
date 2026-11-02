-- 765_rebooking_center.sql — Rebooking Opportunities guide (Nov 1 2026).
-- Additive only. Rollback: DROP TABLE rebooking_health_runs, rebooking_review_events, rebooking_reviews; ALTER TABLE
-- customer_intelligence_snapshots DROP COLUMN rebooking_since, rebooking_due_on, rebooking_window_end.
--
-- Rebooking keeps no second rules engine and no second customer list. The assistant's existing rule (rebookingOpportunity:
-- past or approaching the customer's own return window, suppressed by a future appointment, Insufficient History below the
-- cadence minimum) already runs for every live customer inside the ONE Customer Intelligence scan (763). This migration adds:
--   • on the snapshot: `rebooking_since` (the first scan that saw the current opportunity — the "opportunity created" date,
--     carried forward while it lasts) and the calculated return window (`rebooking_due_on` = last completed visit + the
--     customer's typical interval; `rebooking_window_end` = due + half an interval).
--   • rebooking_reviews        — current review state per customer: reviewed / deferred, pinned to the opportunity it reviewed
--                                (a NEW opportunity — a later `rebooking_since` — returns to Due for Review).
--   • rebooking_review_events  — append-only history: reviewed, deferred, reopened, note, booking_started (a human opened the
--                                AI Booking Assistant — never a booking; the booking itself is the Booking Calendar's).
--   • rebooking_health_runs    — the read-only Check run's evidence.
-- Nothing here writes an appointment, a message, a customer, points or a payment.

ALTER TABLE customer_intelligence_snapshots
  ADD COLUMN IF NOT EXISTS rebooking_since      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rebooking_due_on     DATE,
  ADD COLUMN IF NOT EXISTS rebooking_window_end DATE;
CREATE INDEX IF NOT EXISTS ix_customer_intelligence_snap_rebooking ON customer_intelligence_snapshots (tenant_id, rebooking_since DESC, customer_id DESC) WHERE rebooking;

CREATE TABLE IF NOT EXISTS rebooking_reviews (
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  customer_id     UUID NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('reviewed', 'deferred')),
  opportunity_since TIMESTAMPTZ,
  due_on          DATE,
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID,
  version         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, customer_id)
);
CREATE INDEX IF NOT EXISTS ix_rebooking_reviews_recent ON rebooking_reviews (tenant_id, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS rebooking_review_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  customer_id   UUID NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('reviewed', 'deferred', 'reopened', 'note', 'booking_started')),
  opportunity_since TIMESTAMPTZ,
  service_id    UUID,
  technician_id UUID,
  note          TEXT CHECK (note IS NULL OR length(note) <= 1000),
  actor_user_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rebooking_review_events_recent ON rebooking_review_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_rebooking_review_events_customer ON rebooking_review_events (tenant_id, customer_id, created_at DESC);
CREATE OR REPLACE FUNCTION rebooking_review_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rebooking_review_events is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_rebooking_review_events_append_only ON rebooking_review_events;
CREATE TRIGGER trg_rebooking_review_events_append_only BEFORE UPDATE OR DELETE ON rebooking_review_events
  FOR EACH ROW EXECUTE FUNCTION rebooking_review_events_append_only();

CREATE TABLE IF NOT EXISTS rebooking_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rebooking_health_recent ON rebooking_health_runs (tenant_id, created_at DESC);
