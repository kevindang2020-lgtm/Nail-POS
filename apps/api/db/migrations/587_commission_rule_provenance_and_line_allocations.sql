-- 587_commission_rule_provenance_and_line_allocations.sql — merge of the other chat's 470 (Oct 12 2026), Payroll mandate
-- §14/§16 (snapshot carries the rule used) and §132–§135 (explicit multi-technician allocation per service line).
--   (a) persist WHICH rule priced a service line. `policy_id` (nullable — null means "no authored rule; service rate or
--       tenant default") and `rule_source` (the resolver's human label: 'Technician + Service', 'Salon Default',
--       'Tenant default rate', 'Service default' …) are stamped on the line at creation / stamp time and copied onto the
--       immutable snapshot (157 already has policy_id; it gains rule_source) so a payroll row can always answer "which rule".
--   (b) multi-technician per-line allocation. A service line may be performed by a PRIMARY technician plus HELPER(s);
--       the helper flow (400) used to REASSIGN `ticket_service_lines.technician_id`, which erased the primary's share.
--       Allocations are explicit rows: share_bps (basis points, Σ per line == 10000) + role. The compensation engine
--       feeds every technician on a line (allocation rows) and falls back to the line's technician_id at 100% when no
--       allocation rows exist, so existing tickets are unchanged. Money is integer cents; shares are integer bps.
-- EXPAND-ONLY, idempotent: nullable columns + one new table. Writers: modules/workforce compensation-line-allocations.ts.
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS policy_id   TEXT;
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS rule_source TEXT;

ALTER TABLE ticket_compensation_snapshots ADD COLUMN IF NOT EXISTS rule_source TEXT;

CREATE TABLE IF NOT EXISTS ticket_service_line_allocations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  ticket_id          UUID NOT NULL,
  line_id            UUID NOT NULL,
  technician_id      UUID NOT NULL,
  share_bps          INTEGER NOT NULL CHECK (share_bps > 0 AND share_bps <= 10000),
  role               TEXT NOT NULL DEFAULT 'PRIMARY' CHECK (role IN ('PRIMARY','HELPER')),
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, line_id, technician_id)
);
CREATE INDEX IF NOT EXISTS idx_tsl_alloc_line   ON ticket_service_line_allocations (tenant_id, line_id);
CREATE INDEX IF NOT EXISTS idx_tsl_alloc_ticket ON ticket_service_line_allocations (tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_tsl_alloc_tech   ON ticket_service_line_allocations (tenant_id, technician_id, created_at DESC);
