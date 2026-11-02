-- 324_money_protection_investigations.sql — tenant-scoped investigation case workflow for ai_money_protection.
-- Investigations are opened by authorized humans from one or more alerts. Notes are APPEND-ONLY (corrections add
-- a new note; history is never rewritten — spec §36/§41). Resolutions are recorded by humans only; the sensitive
-- resolutions (EMPLOYEE_MISUSE_CONFIRMED, ACCOUNT_COMPROMISE) require elevated permission (enforced in the service).
create table if not exists money_protection_investigations (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  branch_id            uuid,
  title                text not null,
  category             text not null default 'general',
  severity             text not null default 'MEDIUM'
                         check (severity in ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  status               text not null default 'OPEN'
                         check (status in ('OPEN','INVESTIGATING','WAITING_FOR_INFORMATION','ESCALATED','RESOLVED','CLOSED')),
  assigned_user_id     uuid,
  value_under_review_cents bigint not null default 0,   -- snapshot from linked alerts — NOT confirmed loss
  recovery_amount_cents    bigint not null default 0,   -- recorded by a human at resolution
  resolution           text,                            -- one of the ResolutionType values (null until resolved)
  related              jsonb not null default '{}'::jsonb, -- {alertIds, userIds, ticketIds, transactionIds}
  created_by_user_id   uuid not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  closed_at            timestamptz
);
create index if not exists idx_mp_inv_tenant_status_updated on money_protection_investigations (tenant_id, status, updated_at desc);
create index if not exists idx_mp_inv_tenant_branch on money_protection_investigations (tenant_id, branch_id, created_at desc);

-- Append-only notes: no UPDATE/DELETE in application code; the repo only ever INSERTs and SELECTs.
create table if not exists money_protection_investigation_notes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  investigation_id  uuid not null,
  author_user_id    uuid not null,
  body              text not null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_mp_inv_notes_tenant_inv on money_protection_investigation_notes (tenant_id, investigation_id, created_at);
