-- 172_customer_legal_holds.sql
-- Customer Data Oversight — Legal Hold. A legal hold preserves a customer record (or a tenant/branch scope) against
-- permanent deletion, destructive merge, retention expiry and unapproved anonymization until released through an
-- approved process. Strictly tenant-scoped: a hold belongs to exactly one tenant and never spans tenants.
-- Holds are append-with-status (never hard-deleted) so the legal trail is preserved; release is a status change.
CREATE TABLE IF NOT EXISTS customer_legal_holds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  customer_id         uuid,                              -- null = tenant/branch-scoped hold (not a single customer)
  branch_id           uuid,
  matter_ref          text NOT NULL,                     -- legal matter / case reference (required)
  reason              text NOT NULL,                     -- why the hold was placed (required)
  scope               text NOT NULL DEFAULT 'customer',  -- customer | branch | tenant
  status              text NOT NULL DEFAULT 'active',    -- active | released
  applied_by_user_id  uuid,
  approved_by_user_id uuid,
  applied_at          timestamptz NOT NULL DEFAULT now(),
  effective_at        timestamptz NOT NULL DEFAULT now(),
  review_at           timestamptz,                       -- optional review / expiration date
  released_by_user_id uuid,
  released_at         timestamptz,
  release_reason      text,
  internal_notes      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_legal_holds_tenant_idx   ON customer_legal_holds (tenant_id);
CREATE INDEX IF NOT EXISTS customer_legal_holds_customer_idx ON customer_legal_holds (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_legal_holds_status_idx   ON customer_legal_holds (status);
-- At most one ACTIVE hold per customer (a customer can be re-held after release, but not double-held).
CREATE UNIQUE INDEX IF NOT EXISTS customer_legal_holds_active_customer_uq
  ON customer_legal_holds (customer_id)
  WHERE status = 'active' AND customer_id IS NOT NULL;
