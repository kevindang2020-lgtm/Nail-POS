-- 062_tech_live_ticket_edit.sql — Tech Live Ticket Edit foundation (build doc §5–§11).
-- A) ticket_service_lines gains the §11 columns the kysely path previously had no home for (is_add_on/category were
--    silently dropped on Postgres until now). All additive; removed_at is schema-ready for a future soft-delete pass
--    (P1 removals stay hard-delete + change-request snapshot — 15 reader sites, documented decision).
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS category_snapshot TEXT;
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS is_add_on BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS added_by_user_id UUID;
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS added_by_role TEXT;
ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

-- B) ticket_change_requests — §11 exact shape; the manager-approval pipeline (§7) for tech edits.
CREATE TABLE IF NOT EXISTS ticket_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  ticket_id UUID NOT NULL,
  line_id UUID,
  request_type TEXT NOT NULL CHECK (request_type IN ('add_service','change_service','remove_line','price_change','notes_change')),
  old_value_json JSONB,
  new_value_json JSONB,
  reason TEXT,
  requested_by_user_id UUID,
  requested_by_technician_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','applied')),
  approved_by_user_id UUID,
  approved_at TIMESTAMPTZ,
  rejected_by_user_id UUID,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tcr_tenant_ticket ON ticket_change_requests (tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_tcr_tenant_status ON ticket_change_requests (tenant_id, status);
