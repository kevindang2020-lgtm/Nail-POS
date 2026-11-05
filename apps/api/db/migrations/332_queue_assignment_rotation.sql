-- 332_queue_assignment_rotation.sql — per-branch rotation policy for AI Queue Assignment. One row per (tenant,branch).
-- The policy orders ELIGIBLE technicians only; it never overrides the deterministic eligibility gate. last_served_tech
-- supports fair fixed-order rotation across recommendations. Full settings CRUD lands in the settings slice; this table
-- is the source of truth the recommendation engine reads for the active policy.
CREATE TABLE IF NOT EXISTS queue_assignment_rotation_state (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID NOT NULL,
  policy           TEXT NOT NULL DEFAULT 'hybrid'
                     CHECK (policy IN ('hybrid','least_minutes','least_customers','first_available','fixed_order')),
  last_served_tech TEXT,
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_rotation_tenant ON queue_assignment_rotation_state (tenant_id, branch_id);
