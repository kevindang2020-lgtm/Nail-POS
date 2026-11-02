-- 183_message_templates.sql — platform/tenant message templates with APPEND-ONLY versioning (§25). A template "head"
-- (message_templates) tracks the current published version; every edit creates a NEW row in message_template_versions.
-- Published versions are NEVER overwritten — publishing a new version retires the prior published one (both rows are
-- preserved), so historically sent messages can always reference the exact version they used. Retiring a template does
-- not delete any version or communication history. (This is separate from pos_message_templates, the tenant runtime
-- store; these tables are the Super Admin-managed, versioned, approval-tracked templates.)
create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                                  -- null = platform-level template
  name text not null,
  channel text not null check (channel in ('sms','email','push','in_app')),
  category text,
  status text not null default 'draft' check (status in ('draft','pending_review','published','retired','archived')),
  current_version int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists message_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references message_templates(id) on delete cascade,
  version int not null,
  subject text,
  body text not null,
  push_title text,
  placeholders text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','pending_review','published','retired')),
  created_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create index if not exists ix_message_templates_scope on message_templates (tenant_id, channel);
create index if not exists ix_message_template_versions_tpl on message_template_versions (template_id, version desc);
