-- 766_service_recommendations_center.sql — Service Recommendations guide (Nov 1 2026).
-- Additive only. Rollback: DROP TABLE service_recommendation_health_runs, service_recommendation_events,
-- service_recommendation_reviews, service_recommendations, service_recommendation_scans.
--
-- Before: the screen looked up ONE customer and ran the assistant's rule (recommendServices) against service NAMES, so a
-- renamed or re-priced service broke the match, and nothing was ever stored, reviewed or counted. Now one bounded,
-- set-based evaluation per salon runs the SAME rule keyed by catalog service id over completed visits, keeps only services
-- that are active in the catalog, and stores each suggestion as a record (one per customer + service + type):
--   • service_recommendation_scans   — each evaluation: rule version, tunables, customers evaluated, suggestions, counts.
--   • service_recommendations        — the current suggestions. `generated_at` is when this suggestion first appeared
--                                      (kept while it lasts); one that disappears is `superseded`, never deleted.
--   • service_recommendation_reviews — staff review state per suggestion (reviewed / deferred / not applicable), pinned
--                                      to the suggestion it reviewed.
--   • service_recommendation_events  — append-only: reviewed, deferred, not_applicable, reopened, note, booking_started
--                                      (a human opened the Booking Assistant — never an appointment).
--   • service_recommendation_health_runs — the read-only Check run's evidence.
-- Prices, durations, add-ons and qualifications are read live from the catalog and Technician Management; nothing here
-- writes a booking, a ticket, a price, a customer, a message, points or a payment.

CREATE TABLE IF NOT EXISTS service_recommendation_scans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  actor_user_id       UUID,
  trigger_kind        TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual', 'auto', 'scheduled')),
  rule_version        TEXT NOT NULL,
  tunables            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  customers_evaluated INTEGER NOT NULL DEFAULT 0,
  generated           INTEGER NOT NULL DEFAULT 0,
  counts              JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms         INTEGER,
  error_code          TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_service_rec_scans_recent ON service_recommendation_scans (tenant_id, started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS service_recommendations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  customer_id             UUID NOT NULL,
  service_id              UUID NOT NULL,
  rec_type                TEXT NOT NULL CHECK (rec_type IN ('repeat_service', 'previously_preferred')),
  confidence              TEXT NOT NULL,
  times_completed         INTEGER NOT NULL DEFAULT 0,
  last_completed_at       TIMESTAMPTZ,
  preferred_technician_id UUID,
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'superseded')),
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at           TIMESTAMPTZ,
  scan_id                 UUID REFERENCES service_recommendation_scans(id),
  rule_version            TEXT NOT NULL,
  UNIQUE (tenant_id, customer_id, service_id, rec_type)
);
CREATE INDEX IF NOT EXISTS ix_service_recs_newest ON service_recommendations (tenant_id, status, generated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_service_recs_customer ON service_recommendations (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS ix_service_recs_service ON service_recommendations (tenant_id, service_id);

CREATE TABLE IF NOT EXISTS service_recommendation_reviews (
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  recommendation_id UUID NOT NULL REFERENCES service_recommendations(id),
  status            TEXT NOT NULL CHECK (status IN ('reviewed', 'deferred', 'not_applicable')),
  generated_at_reviewed TIMESTAMPTZ,
  due_on            DATE,
  reviewed_by       UUID,
  reviewed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID,
  version           INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, recommendation_id)
);
CREATE INDEX IF NOT EXISTS ix_service_rec_reviews_recent ON service_recommendation_reviews (tenant_id, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS service_recommendation_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  recommendation_id UUID NOT NULL,
  customer_id       UUID NOT NULL,
  event_type        TEXT NOT NULL CHECK (event_type IN ('reviewed', 'deferred', 'not_applicable', 'reopened', 'note', 'booking_started')),
  technician_id     UUID,
  note              TEXT CHECK (note IS NULL OR length(note) <= 1000),
  actor_user_id     UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_service_rec_events_recent ON service_recommendation_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_service_rec_events_rec ON service_recommendation_events (tenant_id, recommendation_id, created_at DESC);
CREATE OR REPLACE FUNCTION service_recommendation_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'service_recommendation_events is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_service_recommendation_events_append_only ON service_recommendation_events;
CREATE TRIGGER trg_service_recommendation_events_append_only BEFORE UPDATE OR DELETE ON service_recommendation_events
  FOR EACH ROW EXECUTE FUNCTION service_recommendation_events_append_only();

CREATE TABLE IF NOT EXISTS service_recommendation_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_service_rec_health_recent ON service_recommendation_health_runs (tenant_id, created_at DESC);
