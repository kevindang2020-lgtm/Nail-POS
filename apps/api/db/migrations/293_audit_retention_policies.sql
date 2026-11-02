-- 196_audit_retention_policies.sql — per-category audit retention policies (hot-storage days + archive days), with
-- append-only versioning: setting a category's policy supersedes the prior active version (history preserved). Policies
-- describe how long each category of audit events is retained before archival/purge; the actual surface NEVER deletes a
-- log row — eligibility is computed and previewed only, and legal holds always override retention.
create table if not exists audit_retention_policies (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  hot_days int not null default 0 check (hot_days >= 0),
  archive_days int not null default 0 check (archive_days >= 0),
  version int not null default 1,
  status text not null default 'active' check (status in ('active','superseded')),
  reason text,
  effective_date date not null default current_date,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
-- One active version per category.
create unique index if not exists ux_audit_retention_active on audit_retention_policies (category) where status = 'active';
create index if not exists ix_audit_retention_category on audit_retention_policies (category, version);
