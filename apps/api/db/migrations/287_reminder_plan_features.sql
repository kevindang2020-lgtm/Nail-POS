-- 190_reminder_plan_features.sql — per-plan reminder capability matrix (§41). Keyed by (plan_code, feature_key); the
-- backend resolves a tenant's plan from tenant_subscriptions and consults this matrix before allowing a reminder
-- capability. State semantics: enabled/trial/grandfathered = allowed; disabled/add_on/approval = blocked until the
-- respective condition is met. A missing row means "not restricted by plan" (allowed by default) — the matrix is a
-- restriction mechanism, and enforcement is server-side (hiding a frontend control is never sufficient).
create table if not exists reminder_plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null,
  feature_key text not null,
  state text not null default 'enabled' check (state in ('enabled','disabled','trial','add_on','approval','grandfathered')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (plan_code, feature_key)
);
create index if not exists ix_reminder_plan_features on reminder_plan_features (plan_code);
