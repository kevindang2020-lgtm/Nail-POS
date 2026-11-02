-- 323_inventory_service_recipes.sql — service→supply consumption recipes for the AI Inventory Assistant (spec §11).
-- A recipe maps ONE service (optionally overridden per branch) to the supplies it consumes, with expected quantities,
-- consumption units, and waste allowances. Recipes are VERSIONED and APPROVAL-GATED: the AI may propose a DRAFT, but an
-- authorized user must review and approve it before it drives any consumption estimate. Approving a version supersedes
-- the prior approved version for the same (service, branch scope). Everything is tenant-scoped; branch_id NULL means a
-- tenant-wide default recipe, a set branch_id is a branch-specific override. No consumption is ever posted from here —
-- this is the approved mapping only; actual estimates are computed by a later read-only slice.
CREATE TABLE IF NOT EXISTS inventory_service_recipes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,                                  -- NULL = tenant-wide default; set = branch override
  service_id     UUID NOT NULL,
  version        INT  NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','archived')),
  source         TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','ai_proposed')),         -- provenance; ai_proposed drafts still require human approval
  effective_date DATE,
  notes          TEXT,
  created_by     UUID,
  approved_by    UUID,                                  -- who approved (distinct from creator supports segregation of duties)
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary access paths: a tenant's recipes for a service, and the active approved recipe per (service, branch scope).
CREATE INDEX IF NOT EXISTS inv_service_recipes_svc_idx
  ON inventory_service_recipes (tenant_id, service_id, status);
CREATE INDEX IF NOT EXISTS inv_service_recipes_branch_idx
  ON inventory_service_recipes (tenant_id, branch_id, service_id);
-- At most one APPROVED version per (tenant, service, branch scope). COALESCE folds the tenant-wide (NULL branch)
-- default into a stable key so the partial unique index applies to both defaults and overrides.
CREATE UNIQUE INDEX IF NOT EXISTS inv_service_recipes_one_approved_idx
  ON inventory_service_recipes (tenant_id, service_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS inventory_service_recipe_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  recipe_id           UUID NOT NULL REFERENCES inventory_service_recipes(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL,                    -- the supply consumed (inventory_products)
  expected_quantity   NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (expected_quantity >= 0),
  consumption_unit    TEXT NOT NULL,                    -- validated tenant-approved unit (mL, each, …)
  waste_allowance_pct NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (waste_allowance_pct >= 0 AND waste_allowance_pct <= 100),
  required            BOOLEAN NOT NULL DEFAULT true,
  sort_order          INT NOT NULL DEFAULT 0,
  CONSTRAINT inv_recipe_line_unique_product UNIQUE (recipe_id, product_id)
);
CREATE INDEX IF NOT EXISTS inv_service_recipe_lines_scope_idx
  ON inventory_service_recipe_lines (tenant_id, product_id);
CREATE INDEX IF NOT EXISTS inv_service_recipe_lines_recipe_idx
  ON inventory_service_recipe_lines (recipe_id);
