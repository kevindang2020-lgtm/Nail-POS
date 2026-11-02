-- 178_merchant_risk_reviews.sql — append-only risk-review history for Merchant Accounts (§38). Each review is an
-- immutable record; the merchant's CURRENT risk is the review with the greatest reviewed_at. History is preserved
-- (reviews are never overwritten). Overview surfaces do NOT expose sensitive underwriting detail — only the risk
-- level, reasons summary, review dates, reviewer, and processor risk status.

create table if not exists merchant_risk_reviews (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null,
  risk_level               text not null default 'unknown'
    check (risk_level in ('low','medium','high','critical','under_review','restricted','unknown')),
  risk_reasons             jsonb not null default '[]'::jsonb,
  reviewed_at              timestamptz not null default now(),
  next_review_at           timestamptz,
  reviewer_user_id         uuid,
  reviewer_name            text,
  processor_risk_status    text,
  processing_restrictions  jsonb not null default '[]'::jsonb,
  funding_hold             boolean not null default false,
  documentation_required   jsonb not null default '[]'::jsonb,
  resolution               text,
  status                   text not null default 'open'
    check (status in ('open','acknowledged','investigating','resolved','closed')),
  created_by               uuid,
  created_at               timestamptz not null default now()
);

-- Latest-review-per-tenant lookup (current risk) and high-risk filtering.
create index if not exists idx_merchant_risk_reviews_tenant_reviewed
  on merchant_risk_reviews (tenant_id, reviewed_at desc);
create index if not exists idx_merchant_risk_reviews_level
  on merchant_risk_reviews (tenant_id, risk_level);
