-- 008_checkin.sql — AIPowerSalon Check-In (§27). Tenant-scoped. Idempotent.

CREATE TABLE IF NOT EXISTS public_check_in_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  customer_id        UUID,
  appointment_id     UUID,
  queue_item_id      UUID,
  ticket_id          UUID,
  public_token       TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'waiting',
  estimated_wait_min INTEGER NOT NULL DEFAULT 0,
  estimated_wait_max INTEGER NOT NULL DEFAULT 0,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- [moved to 029_deferred_indexes.sql] index on 'appointments' (table is created later)
-- [moved] orphaned index on non-existent 'queue_items' removed; canonical table is indexed by its own migration.
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_branch_status
  ON tickets (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone
  ON customers (tenant_id, normalized_phone);
CREATE INDEX IF NOT EXISTS idx_public_checkin_token
  ON public_check_in_sessions (public_token);
CREATE INDEX IF NOT EXISTS idx_public_checkin_tenant_branch_status
  ON public_check_in_sessions (tenant_id, branch_id, status);
