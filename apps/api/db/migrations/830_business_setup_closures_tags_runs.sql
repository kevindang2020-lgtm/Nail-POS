-- 830_business_setup_closures_tags_runs.sql — A12 Business Setup guide, the parts listed as "not built" (Nov 6 2026).
-- 1. Holiday / special-hours exceptions per date: closed all day, or open with special hours. Salon-wide (branch_id null) or
--    one branch (a branch row wins over the salon row for the same date). Removing one archives it (kept for history).
--    The AI receptionist reads upcoming exceptions at call time; the hours check reports them.
-- 2. FAQ tags: free labels for filtering (internal; never spoken by the AI, never part of the approved text).
-- 3. Recorded health runs for "Check Business Setup".
CREATE TABLE IF NOT EXISTS business_closures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  closure_date  DATE NOT NULL,
  closed        BOOLEAN NOT NULL DEFAULT true,
  opens_at      TEXT,
  closes_at     TEXT,
  note          TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ,
  archived_by   UUID,
  CHECK (closed OR (opens_at ~ '^\d{2}:\d{2}$' AND closes_at ~ '^\d{2}:\d{2}$' AND closes_at > opens_at))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_business_closures_live ON business_closures (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), closure_date) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_business_closures_date ON business_closures (tenant_id, closure_date);

ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS ix_ai_receptionist_faqs_tags ON ai_receptionist_faqs USING gin (tags);

CREATE TABLE IF NOT EXISTS business_setup_health_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  branch_id   UUID,
  overall     TEXT NOT NULL,
  checks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  run_by      UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_business_setup_health_runs_scope ON business_setup_health_runs (tenant_id, branch_id, created_at DESC);
