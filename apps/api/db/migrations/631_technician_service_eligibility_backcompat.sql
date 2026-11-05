-- 631_technician_service_eligibility_backcompat.sql — the exact-service eligibility engine (583 + modules/workforce
-- eligibility) must not break a salon that existed before it. Fix Oct 12 2026 (wave-2 regression).
--
-- == WHY ===================================================================================================
-- Before 583 "can she do this service" was a CATEGORY rule everywhere it was asked (queue / tech-queue / booking /
-- check-in / AI plan: the categories of the services she is mapped to in technician_services), and the Tech App's
-- accept / start and the POS serving start asked no skills question at all. The engine now asks, on those paths, for
-- the EXACT service row. Two kinds of existing data would be refused the morning after the deploy:
--   (a) a technician mapped to ONE service of a category ("Gel Manicure") who has been doing the rest of it
--       ("Classic Manicure") — the category rule said yes;
--   (b) a technician with NO mapping at all (the roster's service list was optional) — accept / start never asked.
--
-- == WHAT ==================================================================================================
-- (a) is MATERIALISED: every technician that has a mapping today is granted, explicitly, every service of the
--     categories she already covers (granted_via 'legacy_category_backfill'). After this her eligibility is exactly
--     what the category rule gave her today, as exact rows — the queue / booking category derivation is unchanged
--     (the same categories), and a service created AFTER the deploy needs an explicit grant (the mandate's rule).
-- (b) is MARKED, never granted: technicians.service_eligibility_mode = 'legacy_unconfigured' for a technician that
--     exists now with no mapping. The engine skips ONLY the skills step for her while she still has no mapping (the
--     pre-deploy behaviour); certification, employment, branch and the live-service check still apply. Granting her
--     every service instead would have WIDENED her booking / queue eligibility (those read the same table). The one
--     writer (technician-skills.ts) flips her to 'exact' the first time a manager sets her list or a skill request
--     is approved. Every technician created after this migration is 'exact' (the column default).
--
-- Idempotent: the grants are INSERT … ON CONFLICT DO NOTHING on the 583 unique index; the marking only touches rows
-- whose mode is still NULL (i.e. that predate the column).

ALTER TABLE technicians ADD COLUMN IF NOT EXISTS service_eligibility_mode TEXT;

-- (a) materialise the category rule for technicians that predate the column and have a mapping
INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id, is_primary, granted_via)
SELECT DISTINCT ON (t.tenant_id, t.id, s.id) t.tenant_id, COALESCE(t.branch_id, s.branch_id), t.id, s.id, false, 'legacy_category_backfill'
  FROM technicians t
  JOIN technician_services ts ON ts.tenant_id = t.tenant_id AND ts.technician_id = t.id
  JOIN services ms ON ms.tenant_id = ts.tenant_id AND ms.id = ts.service_id
  JOIN service_categories mc ON mc.tenant_id = ms.tenant_id AND mc.id = ms.category_id
  JOIN service_categories sc ON sc.tenant_id = t.tenant_id AND sc.name = mc.name          -- the old rule matched by category NAME
  JOIN services s ON s.tenant_id = t.tenant_id AND s.category_id = sc.id
 WHERE t.service_eligibility_mode IS NULL
ON CONFLICT (tenant_id, technician_id, service_id) DO NOTHING;

-- (b) mark the pre-existing technicians: no mapping → legacy_unconfigured; everyone else → exact
UPDATE technicians t SET service_eligibility_mode = 'legacy_unconfigured'
 WHERE t.service_eligibility_mode IS NULL
   AND NOT EXISTS (SELECT 1 FROM technician_services ts WHERE ts.tenant_id = t.tenant_id AND ts.technician_id = t.id);
UPDATE technicians SET service_eligibility_mode = 'exact' WHERE service_eligibility_mode IS NULL;

ALTER TABLE technicians ALTER COLUMN service_eligibility_mode SET DEFAULT 'exact';
ALTER TABLE technicians ALTER COLUMN service_eligibility_mode SET NOT NULL;
ALTER TABLE technicians DROP CONSTRAINT IF EXISTS chk_technicians_service_eligibility_mode;
ALTER TABLE technicians ADD CONSTRAINT chk_technicians_service_eligibility_mode CHECK (service_eligibility_mode IN ('exact', 'legacy_unconfigured'));
