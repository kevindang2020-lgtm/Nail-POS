-- 321_ai_marketing_campaign_plans.sql — the "send plan" for an AI Marketing campaign. The shared `campaigns`
-- table is only a header (name/channel/status/counters); it does NOT store the message body or the audience
-- definition. This table (owned by ai_marketing, not polluting the shared campaigns module) carries exactly
-- what the send pipeline needs: the approved message body, its version, and the APPROVED-registry audience
-- definition (JSON of named dimensions only — never raw SQL). One plan per campaign.
--
-- Tenant-scoped at the application layer. No customer rows are stored here — only the audience DEFINITION, which
-- is re-evaluated live at send time so opt-outs/eligibility are always fresh.
create table if not exists ai_marketing_campaign_plans (
  campaign_id          uuid primary key,          -- 1:1 with campaigns.id
  tenant_id            uuid not null,
  branch_id            uuid,
  channel              text not null check (channel in ('sms','email','push')),
  message_version      integer not null default 1,
  body                 text not null,             -- approved draft text (token template; personalized at send)
  offer_name           text,                      -- human-approved offer name, or null
  audience_definition  jsonb not null,            -- validated AudienceDefinition (named dimensions only)
  created_by_user_id   uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_ai_mkt_plans_tenant on ai_marketing_campaign_plans (tenant_id, created_at);
