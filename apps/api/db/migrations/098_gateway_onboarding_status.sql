-- 098_gateway_onboarding_status.sql — real merchant-application / underwriting status on the per-tenant gateway, distinct
-- from the operational status (pending/active/error/disabled/paused). Drives the detail panel's "Underwriting Approved"
-- step from a stored value instead of a proxy. Set by the inbound processor webhook (application/underwriting events) or
-- manually by Super Admin via the Configure drawer. Lifecycle: not_started → submitted → under_review → approved | declined.
ALTER TABLE tenant_payment_config
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_status IN ('not_started', 'submitted', 'under_review', 'approved', 'declined'));
