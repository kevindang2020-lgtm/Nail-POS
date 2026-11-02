-- 185_reminder_templates.sql — global (and tenant) reminder templates with APPEND-ONLY versioning (§30). Each template
-- is bound to one of the 10 reminder types and carries per-channel content (SMS / email / push). A head row
-- (reminder_templates) tracks the current published version; every edit inserts a NEW row in
-- reminder_template_versions. Published versions are NEVER overwritten — publishing a new version retires the prior
-- published one (both rows preserved) so any reminder job can reference the exact version it used. Retiring a template
-- deletes no history. This is the Smart Reminders orchestration template store, distinct from the Communications
-- message-transport templates (message_templates) — the two domains are intentionally separate.
create table if not exists reminder_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                                  -- null = platform/global template
  reminder_type text not null,                     -- one of the 10 reminder-type catalog keys
  name text not null,
  status text not null default 'draft' check (status in ('draft','pending_review','published','retired','archived')),
  current_version int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reminder_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references reminder_templates(id) on delete cascade,
  version int not null,
  sms_content text,
  email_subject text,
  email_body text,
  push_title text,
  push_body text,
  placeholders text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','pending_review','published','retired')),
  created_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create index if not exists ix_reminder_templates_scope on reminder_templates (tenant_id, reminder_type);
create index if not exists ix_reminder_template_versions_tpl on reminder_template_versions (template_id, version desc);
