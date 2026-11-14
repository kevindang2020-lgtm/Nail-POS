-- 992_checkin_technician_preference_on.sql — Kevin, Nov 13 2026: "turn it on — allow guests to pick a technician".
-- Restores the default to ON (990 had set it OFF per the CPad guide) and turns it ON for every salon: the 990 default
-- change shipped the same day and was never deployed, so no salon has chosen OFF through the settings card yet.
ALTER TABLE tenant_checkin_settings ALTER COLUMN technician_preference_enabled SET DEFAULT true;
UPDATE tenant_checkin_settings SET technician_preference_enabled = true WHERE technician_preference_enabled = false;
