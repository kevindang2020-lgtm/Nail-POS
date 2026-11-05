-- 409_compensation_policies.sql — the compensation RULE STORE (spec §4/§5/§25). The compensation ENGINE and the 7-level
-- policy resolver (compensation-policy.ts resolvePolicy) already exist; what was missing is a place to author versioned,
-- scoped, effective-dated rules for the resolver to read. A "policy" is a scope (which tenant/branch/technician/service/
-- category combination it targets — more non-null columns = more specific); its effective-dated payload lives in versions,
-- so a rate change is a NEW version, never an edit of an active one (§25). Money is integer cents. Resolution is always
-- as-of the service-completion date, so authoring a future version never changes historical tickets (§5/§14).

CREATE TABLE IF NOT EXISTS compensation_policies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,                       -- NULL = all branches
  technician_id  UUID,                       -- NULL = not technician-scoped
  service_id     UUID,                       -- NULL = not service-scoped
  service_category TEXT,                     -- NULL = not category-scoped
  ticket_id      UUID,                        -- NULL = not a ticket-specific override (§4 rank 1)
  label          TEXT,                        -- optional human label for the settings UI
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comp_policies_tenant ON compensation_policies (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS compensation_policy_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id        UUID NOT NULL REFERENCES compensation_policies(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,             -- denormalized for tenant-scoped reads
  version          INTEGER NOT NULL DEFAULT 1,
  -- commission payload (§2 percent|fixed)
  commission_type  TEXT NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent','fixed')),
  commission_value INTEGER NOT NULL DEFAULT 0,  -- percent 0..100 when percent; cents when fixed
  -- product-cost / supply payload (§9) — carried now, wired in a later phase
  supply_method    TEXT NOT NULL DEFAULT 'none' CHECK (supply_method IN ('none','fixed','percent','tiered','recipe')),
  supply_value     INTEGER NOT NULL DEFAULT 0,
  -- discount funding (§13) — carried now, wired in a later phase
  discount_funding TEXT NOT NULL DEFAULT 'proportional'
                   CHECK (discount_funding IN ('proportional','salon_funded','technician_funded','noncommissionable')),
  -- lifecycle (§19/§25)
  effective_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_end    TIMESTAMPTZ,               -- NULL = open-ended
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','pending_approval','scheduled','active','expired','replaced','canceled')),
  approved         BOOLEAN NOT NULL DEFAULT false,   -- ticket overrides require approval to apply (§24)
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_comp_policy_version UNIQUE (policy_id, version),
  CONSTRAINT ck_comp_percent_range CHECK (commission_type <> 'percent' OR (commission_value >= 0 AND commission_value <= 100)),
  CONSTRAINT ck_comp_effective_order CHECK (effective_end IS NULL OR effective_end >= effective_start)
);
CREATE INDEX IF NOT EXISTS idx_comp_policy_versions_lookup
  ON compensation_policy_versions (tenant_id, status, effective_start);
