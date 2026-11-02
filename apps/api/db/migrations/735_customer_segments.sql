-- 735_customer_segments.sql — Customer Segments Complete Build Guide (30 Oct 2026) §11 + §10 Upgrade C. ADDITIVE.
--
--   customer_retention_daily_snapshots  + is_vip / loyalty_tier: the durable, idempotent, rule-versioned daily snapshot the
--                                        Retention module already writes (one row per customer per salon day) now also
--                                        records the VIP flag and loyalty tier IN FORCE when the nightly run computed the
--                                        day. NULL = not recorded (every row written before this migration, and every
--                                        reconstructed / backfilled day: a past VIP flag is not reproducible from history,
--                                        so it is never invented). New / Returning / Never Visited / Inactive come from the
--                                        stored visit_count + segment under ruleset segments-v1 (no second snapshot table).
--   segment_audience_drafts / _members  the Smart Marketing Audience Builder's UNSENT audience: the exact customers chosen
--                                        (page / selected / all matching), each with its consent verdict at creation; it
--                                        sends nothing. A draft expires; launching happens only in Campaign Center after
--                                        its own approval, which re-checks consent at send time.

ALTER TABLE customer_retention_daily_snapshots ADD COLUMN IF NOT EXISTS is_vip       BOOLEAN;
ALTER TABLE customer_retention_daily_snapshots ADD COLUMN IF NOT EXISTS loyalty_tier TEXT;

CREATE TABLE IF NOT EXISTS segment_audience_drafts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  branch_id              UUID,
  channel                TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'discarded', 'expired')),
  ruleset_version        TEXT NOT NULL,
  segment                TEXT NOT NULL,
  selection_mode         TEXT NOT NULL CHECK (selection_mode IN ('page', 'selected', 'all_matching')),
  filters_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_count         INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  eligible_count         INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  excluded_count         INTEGER NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),
  excluded_reasons_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_preview        TEXT,
  estimated_cost_cents   INTEGER,
  campaign_id            UUID,                                   -- the Campaign Center draft it was handed to (no send)
  idempotency_key        TEXT NOT NULL,
  created_by_user_id     UUID,
  updated_by             UUID,
  expires_at             TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_segment_audience_draft_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_segment_audience_drafts_tenant ON segment_audience_drafts (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS segment_audience_members (
  draft_id               UUID NOT NULL REFERENCES segment_audience_drafts(id),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  customer_id            UUID NOT NULL,
  eligibility            TEXT NOT NULL,                          -- eligible | no_consent | opted_out | no_phone | invalid_phone | no_email | invalid_email | never_visited | not_found
  destination_masked     TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, customer_id)
);
CREATE INDEX IF NOT EXISTS ix_segment_audience_members_tenant ON segment_audience_members (tenant_id, draft_id, eligibility);
