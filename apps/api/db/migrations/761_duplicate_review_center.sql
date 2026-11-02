-- 761_duplicate_review_center.sql — Duplicate Review guides (FULL + COMPLETE, Nov 1 2026).
-- Additive only. Rollback: DROP TABLE customer_duplicate_health_runs, customer_duplicate_merge_ops,
-- customer_duplicate_events, customer_duplicate_groups, customer_duplicate_scans; DROP INDEX ix_customers_tenant_email_norm,
-- ix_customers_tenant_name_fold. No customer, booking, loyalty, gift-card or membership row is read-and-rewritten here.
--
-- These are REVIEW records, never a second customer master (guide §20/§24):
--   • customer_duplicate_scans   — each detection run (rule version, counts, failures) = the real data freshness.
--   • customer_duplicate_groups  — one candidate group per distinct member set (stable id, not the old positional
--                                  "dup_1"); evidence + rule version + review status + optimistic version.
--   • customer_duplicate_events  — append-only timeline: detected, reopened, reviewed, noted, previewed, merged, failed.
--   • customer_duplicate_merge_ops — one row per confirmed merge attempt; the idempotency key is unique per salon, and a
--                                  group can complete at most one merge (partial unique index).
--   • customer_duplicate_health_runs — the read-only Check run's evidence (rate-limited per salon).
-- Keep Separate / Not Sure still live in customer_duplicate_decisions (487) — shared with the original Customers route
-- and Customer Search's duplicate signal, so all three agree.

CREATE TABLE IF NOT EXISTS customer_duplicate_scans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  actor_user_id     UUID,
  trigger_kind      TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual', 'auto', 'scheduled')),
  rule_version      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  customers_scanned INTEGER NOT NULL DEFAULT 0,
  groups_found      INTEGER NOT NULL DEFAULT 0,
  groups_new        INTEGER NOT NULL DEFAULT 0,
  groups_reopened   INTEGER NOT NULL DEFAULT 0,
  groups_resolved   INTEGER NOT NULL DEFAULT 0,
  oversized_keys    INTEGER NOT NULL DEFAULT 0,
  error_code        TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_customer_duplicate_scans_recent ON customer_duplicate_scans (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS customer_duplicate_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  group_key      TEXT NOT NULL,                      -- md5 of the sorted member ids: one row per distinct member set
  member_ids     UUID[] NOT NULL,
  member_count   INTEGER NOT NULL CHECK (member_count >= 2),
  reasons        TEXT[] NOT NULL,                    -- phone · email · name (which keys put these records together)
  confidence     TEXT NOT NULL CHECK (confidence IN ('exact', 'strong', 'possible')),
  rule_version   TEXT NOT NULL,
  evidence       JSONB NOT NULL DEFAULT '{}'::jsonb, -- typed signal descriptors (match / partial / conflict / missing)
  evidence_hash  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'in_review', 'deferred', 'kept_separate', 'merged', 'failed', 'resolved')),
  assigned_to    UUID,
  due_on         DATE,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,                               -- the reviewer behind the last change (null = the detection scan)
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scan_id   UUID REFERENCES customer_duplicate_scans(id),
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    UUID,
  merged_at      TIMESTAMPTZ,
  survivor_id    UUID,
  merge_op_id    UUID,
  version        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, group_key)
);
CREATE INDEX IF NOT EXISTS ix_customer_duplicate_groups_detected ON customer_duplicate_groups (tenant_id, detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_customer_duplicate_groups_status ON customer_duplicate_groups (tenant_id, status, detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_customer_duplicate_groups_members ON customer_duplicate_groups USING gin (member_ids);

CREATE TABLE IF NOT EXISTS customer_duplicate_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  group_id      UUID NOT NULL REFERENCES customer_duplicate_groups(id),
  event_type    TEXT NOT NULL CHECK (event_type IN ('detected', 'reopened', 'resolved', 'assigned', 'in_review', 'deferred',
                  'kept_separate', 'note_added', 'merge_previewed', 'merged', 'merge_failed', 'evidence_requested')),
  actor_user_id UUID,
  note          TEXT CHECK (note IS NULL OR length(note) <= 1000),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- ids, codes and counts only — never a phone, email or card
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_customer_duplicate_events_recent ON customer_duplicate_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_customer_duplicate_events_group ON customer_duplicate_events (group_id, created_at DESC);

-- append-only: the review timeline is evidence (guide §03/§16)
CREATE OR REPLACE FUNCTION customer_duplicate_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer_duplicate_events is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_customer_duplicate_events_append_only ON customer_duplicate_events;
CREATE TRIGGER trg_customer_duplicate_events_append_only BEFORE UPDATE OR DELETE ON customer_duplicate_events
  FOR EACH ROW EXECUTE FUNCTION customer_duplicate_events_append_only();

CREATE TABLE IF NOT EXISTS customer_duplicate_merge_ops (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  group_id        UUID NOT NULL REFERENCES customer_duplicate_groups(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  preview_hash    TEXT NOT NULL,
  survivor_id     UUID NOT NULL,
  source_ids      UUID[] NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  error_code      TEXT,
  result          JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_duplicate_merge_ops_one_merge ON customer_duplicate_merge_ops (tenant_id, group_id) WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS customer_duplicate_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_customer_duplicate_health_recent ON customer_duplicate_health_runs (tenant_id, created_at DESC);

-- detection keys on the canonical customers table (set-based grouping, never a whole-directory load into memory)
CREATE INDEX IF NOT EXISTS ix_customers_tenant_email_norm ON customers (tenant_id, lower(btrim(email))) WHERE email IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_customers_tenant_name_fold ON customers (tenant_id, vi_fold(lower(btrim(coalesce(full_name, first_name || ' ' || coalesce(last_name, '')))))) WHERE archived_at IS NULL;
