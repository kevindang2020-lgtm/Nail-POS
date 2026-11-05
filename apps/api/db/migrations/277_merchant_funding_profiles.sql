-- 179_merchant_funding_profiles.sql — funding + bank-verification configuration for Merchant Accounts (§18, §28, §39).
-- SECURITY: full bank/routing numbers are NEVER stored in a display column. Only masked, display-safe fields live in
-- readable columns (bank_name, account_type, account_last4, routing_last4). The authoritative full values live ONLY in
-- the *_enc vault columns (populated through the approved encryption/vaulting system) and are NEVER selected for the
-- overview. Profiles are append-only + effective-dated: a funding change supersedes the prior row (superseded_at set)
-- and inserts a new current row (superseded_at is null). History is preserved; the CURRENT profile is the un-superseded one.

create table if not exists merchant_funding_profiles (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null,
  funding_schedule         text not null default 'not_configured'
    check (funding_schedule in ('same_day','next_day','two_business_days','daily','weekly','custom','funding_hold','not_configured')),
  bank_verification_status text not null default 'not_started'
    check (bank_verification_status in ('not_started','pending','submitted','verified','failed','information_required','expired','reverification_required')),
  verification_method      text,
  verified_at              timestamptz,
  funding_hold             boolean not null default false,
  -- display-safe (masked) fields only:
  bank_name                text,
  account_type             text check (account_type in ('checking','savings') or account_type is null),
  account_last4            text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  routing_last4            text check (routing_last4 is null or routing_last4 ~ '^[0-9]{4}$'),
  -- encrypted vault columns — NEVER selected for display:
  bank_account_enc         text,
  routing_number_enc       text,
  -- funding-issue linkage (drives Funding Issues KPI + Top Funding Issues):
  has_funding_issue        boolean not null default false,
  funding_issue_type       text
    check (funding_issue_type is null or funding_issue_type in ('bank_verification_pending','document_expired','account_info_mismatch','funding_delays','other')),
  effective_at             timestamptz not null default now(),
  superseded_at            timestamptz,
  created_by               uuid,
  created_at               timestamptz not null default now()
);

-- Current-profile lookup (superseded_at is null) per tenant, plus issue filtering.
create index if not exists idx_merchant_funding_profiles_current
  on merchant_funding_profiles (tenant_id) where superseded_at is null;
create index if not exists idx_merchant_funding_profiles_issue
  on merchant_funding_profiles (tenant_id, has_funding_issue) where superseded_at is null;
