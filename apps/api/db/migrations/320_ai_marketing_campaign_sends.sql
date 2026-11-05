-- 320_ai_marketing_campaign_sends.sql — per-recipient send ledger for AI Marketing campaigns. This is the
-- DURABLE idempotency backstop the send pipeline requires: the UNIQUE index guarantees a given recipient can
-- receive a given campaign+channel+message_version AT MOST ONCE, regardless of worker retries, queue
-- redelivery, provider retries, campaign resume, or double-clicked approval. The app-level ledger "claim"
-- inserts a row here first; a duplicate insert violates the unique index and is treated as "already handled"
-- (no second send). Tenant-scoped at the application layer (every read/write carries tenant_id).
--
-- No raw contact info is stored here — only the customer_id and a status/skip_reason. Full contact resolution
-- happens in the existing notifications send path, which masks/So logs safely.
create table if not exists ai_marketing_campaign_sends (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  branch_id        uuid,
  campaign_id      uuid not null,
  customer_id      uuid not null,
  channel          text not null check (channel in ('sms','email','push')),
  message_version  integer not null default 1,
  status           text not null default 'queued'
    check (status in ('queued','sent','blocked','failed','skipped')),
  -- why a recipient was NOT sent to (honest audit): opted_out | suppressed | no_consent | missing_contact |
  -- frequency_capped | quiet_hours | already_sent | provider_error. Null when status = 'sent'.
  skip_reason      text,
  provider_id      text,                 -- provider message id when sent (no contact info)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Idempotency: one send row per (tenant, campaign, recipient, channel, message_version).
create unique index if not exists ux_ai_mkt_sends_idem
  on ai_marketing_campaign_sends (tenant_id, campaign_id, customer_id, channel, message_version);

-- Read paths: per-campaign status rollup, and tenant-wide recency.
create index if not exists idx_ai_mkt_sends_campaign
  on ai_marketing_campaign_sends (tenant_id, campaign_id, status);
create index if not exists idx_ai_mkt_sends_tenant_created
  on ai_marketing_campaign_sends (tenant_id, created_at);
