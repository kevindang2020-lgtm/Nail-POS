-- 400_technician_help_requests.sql
-- The Request-Help workflow: a primary technician (or a manager) asks a QUALIFIED helper to take one specific service
-- LINE on an active ticket. One row is the whole lifecycle (request + its resolution), matching this project's
-- change-request convention. On accept, the service line's technician is reassigned to the helper (that's what carries
-- the helper's per-line earnings — the compensation engine already attributes by line).
CREATE TABLE IF NOT EXISTS technician_help_requests (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL,
  branch_id                 UUID,
  ticket_id                 UUID NOT NULL,
  service_line_id           UUID NOT NULL,
  service_id                UUID,
  primary_technician_id     UUID NOT NULL,           -- who requested help
  helper_technician_id      UUID NOT NULL,           -- the qualified helper being asked
  reason                    TEXT NOT NULL,
  note                      TEXT,
  status                    TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | declined | cancelled
  responded_at              TIMESTAMPTZ,
  decline_reason            TEXT,
  created_by_user_id        UUID,                    -- set when a manager created/assigned it
  created_by_technician_id  UUID,                    -- set when the primary technician created it
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one OPEN (pending/accepted) request per service line + helper — prevents duplicate/overlapping asks.
CREATE UNIQUE INDEX IF NOT EXISTS uq_help_open_line_helper
  ON technician_help_requests (tenant_id, service_line_id, helper_technician_id)
  WHERE status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS idx_help_helper_status ON technician_help_requests (tenant_id, helper_technician_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_help_ticket ON technician_help_requests (tenant_id, ticket_id);
