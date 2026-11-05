-- 313_a2p_business_info.sql — adds the business identity inputs and TrustHub bundle statuses needed to AUTOMATE creation
-- of a salon's Secondary Customer Profile + A2P profile bundle (the prerequisite for Brand/Campaign, migration 312).
-- business_info holds the collected fields (business name, EIN, address, industry, authorized representative) as JSONB.
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS business_info JSONB;
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS secondary_profile_status TEXT;   -- draft | pending-review | twilio-approved | twilio-rejected
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS a2p_profile_status TEXT;          -- (same lifecycle)
