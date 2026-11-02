-- 442_campaign_started_at.sql — the moment a campaign actually began sending.
--
-- WHY: platform campaign limits (max campaigns per day, max sends per day, minimum hours between campaigns) were
-- configurable in campaign_limits and enforced by nothing. Enforcing them needs to know when each campaign
-- STARTED. The only timestamp available was updated_at, which moves on every edit — counting "campaigns started
-- today" by updated_at would count a campaign renamed today that started last week.
--
-- started_at is set ONCE, on the first transition into 'in_progress', and never moved afterwards. Existing rows
-- stay NULL: they started before this was recorded, and guessing a value would invent history.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- The limit check asks "how many campaigns has this tenant started since the start of its local day" and
-- "when did it last start one" — both served by this index.
CREATE INDEX IF NOT EXISTS ix_campaigns_tenant_started ON campaigns (tenant_id, started_at) WHERE started_at IS NOT NULL;
