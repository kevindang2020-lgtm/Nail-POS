-- 183_revenue_export_jobs.sql — Super Admin › Revenue & Residuals › background export jobs.
-- Large payout-report exports can be run off the request path: a job is enqueued, processed asynchronously, and
-- its result persisted for download. Reuses the same filter-aware, formula-injection-guarded, audited builder.
-- The stored content carries no card/bank/credential fields (same guarantee as the synchronous export).

create table if not exists revenue_export_jobs (
  id uuid primary key default gen_random_uuid(),
  dataset text not null,
  format text not null,
  filters jsonb,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  row_count int,
  filename text,
  mime text,
  encoding text,                 -- 'utf8' (csv) or 'base64' (xlsx/pdf)
  content text,                  -- csv text or base64-encoded bytes; only populated when completed
  error text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists idx_rev_export_jobs_status on revenue_export_jobs (status, created_at desc);
