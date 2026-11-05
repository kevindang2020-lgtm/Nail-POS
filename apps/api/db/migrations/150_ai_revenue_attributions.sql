-- 150_ai_revenue_attributions.sql
-- AI revenue attribution (spec §35, KPI "Suggested Upsell Revenue"): records revenue an AI assistant influenced
-- (an accepted upsell/add-on, a rebooking, a retail/membership conversion) so "AI-suggested/influenced revenue" is
-- REAL and clearly separated from booked/collected revenue. Idempotent on (tenant_id, dedupe_key) so the same accepted
-- suggestion is never double-counted. Links to ticket / ticket_service_line when available. Tenant/branch scoped; no rows seeded.

CREATE TABLE IF NOT EXISTS ai_revenue_attributions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  dedupe_key             TEXT NOT NULL,
  source                 TEXT NOT NULL,
  kind                   TEXT NOT NULL DEFAULT 'upsell'
                         CHECK (kind IN ('upsell','add_on','rebooking','retail','membership','upgrade')),
  ticket_id              UUID,
  ticket_service_line_id UUID,
  customer_id            UUID,
  amount_cents           INTEGER NOT NULL DEFAULT 0,
  accepted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_rev_attr_tenant_time ON ai_revenue_attributions (tenant_id, accepted_at DESC);
