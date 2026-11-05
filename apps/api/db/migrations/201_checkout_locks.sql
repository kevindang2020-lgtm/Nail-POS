-- 172_checkout_locks.sql — checkout-session ownership lock for the Owner & Manager Payment App.
-- Guarantees the POS and the mobile app cannot open/charge the SAME ticket at once. Exactly ONE active lock per
-- (tenant, ticket) is enforced at the DB level by a partial unique index (released_at IS NULL) — two devices can never
-- both hold the lock. This is session/UX mutual exclusion; the authoritative double-charge guard remains the
-- payment_attempts reservation + advisory locks at capture time. Locks expire; a stale (expired) lock can be taken over.
CREATE TABLE IF NOT EXISTS checkout_locks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  ticket_id        UUID NOT NULL,
  owner_user_id    UUID NOT NULL,
  owner_device_id  TEXT,
  session_id       TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'mobile',     -- 'mobile' | 'pos'
  acquired_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  refreshed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  released_at      TIMESTAMPTZ,                          -- NULL = active
  release_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- exactly one ACTIVE lock per (tenant, ticket): two devices cannot both hold the lock
CREATE UNIQUE INDEX IF NOT EXISTS ux_checkout_locks_active
  ON checkout_locks (tenant_id, ticket_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_checkout_locks_ticket ON checkout_locks (tenant_id, ticket_id);
