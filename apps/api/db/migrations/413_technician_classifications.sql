-- 413_technician_classifications.sql — owner-set worker classification per technician (spec §18). This is an INPUT the
-- salon sets deliberately (employee / contractor / booth renter); it is NEVER auto-derived. Wage-compliance checks use it
-- to decide which technicians are subject to minimum-wage and overtime review. One row per technician (upserted on change).
-- Classification is a legal determination the salon and its advisors make — this table only records their decision.

CREATE TABLE IF NOT EXISTS technician_classifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  technician_id  UUID NOT NULL,
  classification TEXT NOT NULL DEFAULT 'employee' CHECK (classification IN ('employee','contractor','booth_renter')),
  set_by         UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, technician_id)
);
