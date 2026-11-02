-- 174_customer_deletion_requests.sql
-- Customer Data Oversight — Permanent Deletion under approved process. The most destructive action on the module,
-- so it is gated by a dual-approval workflow with a typed customer-ID confirmation, a retention check, and the
-- legal-hold guard (a record under an active hold can never be executed). Strictly tenant-scoped. The request row
-- is the durable approval trail; execution sets status='executed' and records who/when.
CREATE TABLE IF NOT EXISTS customer_deletion_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  customer_id           uuid NOT NULL,
  reason                text NOT NULL,
  status                text NOT NULL DEFAULT 'requested',   -- requested | approved | rejected | executed | cancelled
  requested_by_user_id  uuid,
  approved_by_user_id   uuid,                                 -- MUST differ from requester (enforced in service)
  executed_by_user_id   uuid,
  reject_reason         text,
  retention_checked     boolean NOT NULL DEFAULT false,
  retention_note        text,
  legal_hold_blocked    boolean NOT NULL DEFAULT false,       -- snapshot at execution attempt
  requested_at          timestamptz NOT NULL DEFAULT now(),
  approved_at           timestamptz,
  executed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_deletion_requests_tenant_idx   ON customer_deletion_requests (tenant_id);
CREATE INDEX IF NOT EXISTS customer_deletion_requests_customer_idx ON customer_deletion_requests (customer_id);
CREATE INDEX IF NOT EXISTS customer_deletion_requests_status_idx   ON customer_deletion_requests (status);
-- At most one open (requested/approved) deletion request per customer at a time.
CREATE UNIQUE INDEX IF NOT EXISTS customer_deletion_requests_open_uq
  ON customer_deletion_requests (customer_id)
  WHERE status IN ('requested', 'approved');
