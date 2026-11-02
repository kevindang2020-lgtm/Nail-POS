-- 312_tenant_a2p_registrations.sql — tracks each salon's A2P 10DLC registration journey under the ISV (AIPowerSalon)
-- Twilio account. In the ISV model, brands/campaigns are created under ONE Twilio account using each salon's Secondary
-- Customer Profile bundle; this table stores the resulting Twilio SIDs and per-step status so registration can be
-- driven and monitored from Super Admin (campaign review is ~10-15 business days, surfaced here as a status).
CREATE TABLE IF NOT EXISTS tenant_a2p_registrations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  -- Inputs (the salon's TrustHub bundles, created first in Console or via TrustHub):
  customer_profile_bundle_sid TEXT,            -- Secondary Customer Profile (BU…)
  a2p_profile_bundle_sid      TEXT,            -- A2P Messaging Profile / TrustProduct (BU…)
  brand_type                  TEXT NOT NULL DEFAULT 'STANDARD',   -- STANDARD | SOLE_PROPRIETOR
  is_mock                     BOOLEAN NOT NULL DEFAULT false,      -- Twilio Mock=true → no fees, no vetting (dry run)
  -- Campaign content (collected once, reused on submit):
  campaign_usecase            TEXT,            -- e.g. MIXED, LOW_VOLUME, CUSTOMER_CARE
  campaign_description        TEXT,
  message_samples             JSONB,           -- array of sample strings
  message_flow                TEXT,            -- opt-in description, 40-2049 chars
  opt_in_message              TEXT,
  opt_out_message             TEXT,
  help_message                TEXT,
  privacy_policy_url          TEXT,
  terms_and_conditions_url    TEXT,
  has_embedded_links          BOOLEAN NOT NULL DEFAULT false,
  has_embedded_phone          BOOLEAN NOT NULL DEFAULT false,
  -- Twilio SIDs produced by each step:
  brand_sid                   TEXT,            -- BN…
  brand_status                TEXT,            -- PENDING | IN_REVIEW | APPROVED | FAILED
  messaging_service_sid       TEXT,            -- MG…
  campaign_sid                TEXT,            -- QE… (UsAppToPerson identifier)
  campaign_status             TEXT,            -- PENDING | IN_PROGRESS | VERIFIED | FAILED
  number_sid                  TEXT,            -- PN… attached to the messaging service
  -- Overall progress + diagnostics:
  status                      TEXT NOT NULL DEFAULT 'not_started',
    -- not_started | brand_submitted | brand_approved | campaign_submitted | campaign_approved | number_attached | live | failed
  last_error                  TEXT,
  updated_by_user_id          TEXT,             -- actor (a user UUID or 'super-admin')
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_a2p_registration ON tenant_a2p_registrations (tenant_id);
