-- 800_marketing_health_runs.sql — Coupons / Deals & Offers guides (audit B1–B4 "health-run history tables", Nov 4 2026): each
-- "Run check" of the coupon or deal diagnostics is recorded (per-check status, count, detail, sample ids — never customer
-- data) so the screen can show when it last ran, who ran it and what it found. Read-only checks; a run changes nothing else.
CREATE TABLE IF NOT EXISTS marketing_health_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  area        TEXT NOT NULL CHECK (area IN ('coupons', 'deals')),
  overall     TEXT NOT NULL CHECK (overall IN ('ready', 'unknown', 'attention', 'failed')),
  checks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_marketing_health_runs ON marketing_health_runs (tenant_id, area, created_at DESC, id DESC);
DROP TRIGGER IF EXISTS trg_tc_marketing_health_runs__branch_id ON marketing_health_runs;
CREATE TRIGGER trg_tc_marketing_health_runs__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON marketing_health_runs
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
