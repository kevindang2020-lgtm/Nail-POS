-- 583_skill_requests_and_service_eligibility.sql — skill-request workflow vocabulary + ONE eligibility row per
-- (tenant, technician, service). Technician Profile package (their 466; mandate §38–§40, §86, §160).
--
-- == WHY ===================================================================================================
-- 053 created technician_skill_change_requests with CHECK chk_skill_req_status IN ('pending','approved','rejected').
-- 475 dropped a DIFFERENTLY NAMED constraint (technician_skill_change_requests_status_check) and added a new one
-- with the wider vocabulary — but chk_skill_req_status (053) was never dropped, so BOTH checks were in force and
-- every INSERT the code makes ('submitted' / 'draft') failed. No technician has been able to request a skill
-- since 475 shipped. This migration drops both and re-adds ONE check with the full vocabulary.
--
-- technician_services (003/006) had no uniqueness, so an approval racing a manager's direct PATCH (or two
-- concurrent approvals) could write the same eligibility twice. De-duplicated here (oldest row kept), then
-- UNIQUE (tenant_id, technician_id, service_id) so the approval path can INSERT ... ON CONFLICT DO NOTHING.

-- 1. The status vocabulary. Legacy 'pending' rows (053 default) are folded into 'submitted' first so the new
--    CHECK can be added without failing on historical data.
ALTER TABLE technician_skill_change_requests DROP CONSTRAINT IF EXISTS chk_skill_req_status;
ALTER TABLE technician_skill_change_requests DROP CONSTRAINT IF EXISTS technician_skill_change_requests_status_check;
UPDATE technician_skill_change_requests SET status = 'submitted' WHERE status = 'pending';
ALTER TABLE technician_skill_change_requests ALTER COLUMN status SET DEFAULT 'submitted';
ALTER TABLE technician_skill_change_requests
  ADD CONSTRAINT chk_skill_req_status
  CHECK (status IN ('draft', 'submitted', 'under_review', 'more_information_required', 'approved', 'rejected'));

-- 2. Review bookkeeping: who started the review / asked for more information, and when.
ALTER TABLE technician_skill_change_requests ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ;
ALTER TABLE technician_skill_change_requests ADD COLUMN IF NOT EXISTS review_started_by_user_id UUID;
ALTER TABLE technician_skill_change_requests ADD COLUMN IF NOT EXISTS more_info_requested_at TIMESTAMPTZ;
ALTER TABLE technician_skill_change_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3. Eligibility carries the approved proficiency and the certificate evidence the decision was made on.
ALTER TABLE technician_services ADD COLUMN IF NOT EXISTS proficiency TEXT;
ALTER TABLE technician_services ADD COLUMN IF NOT EXISTS certificate_document_key TEXT;
ALTER TABLE technician_services ADD COLUMN IF NOT EXISTS granted_by_user_id UUID;
ALTER TABLE technician_services ADD COLUMN IF NOT EXISTS granted_via TEXT;
ALTER TABLE technician_services DROP CONSTRAINT IF EXISTS chk_technician_services_proficiency;
ALTER TABLE technician_services
  ADD CONSTRAINT chk_technician_services_proficiency
  CHECK (proficiency IS NULL OR proficiency IN ('BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'));

-- 4. De-duplicate (keep the OLDEST row per key — it is the one the booking/queue screens have been reading), then
--    the unique constraint. Idempotent: a second run finds no duplicates and the index already exists.
DELETE FROM technician_services ts
 USING technician_services keep
 WHERE keep.tenant_id = ts.tenant_id AND keep.technician_id = ts.technician_id AND keep.service_id = ts.service_id
   AND (keep.created_at < ts.created_at OR (keep.created_at = ts.created_at AND keep.id < ts.id));
CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_services_tenant_tech_service
  ON technician_services (tenant_id, technician_id, service_id);

-- 5. A service may require a named certification (matched by name, case-insensitive, against
--    technician_certifications.name — migration 584). NULL = no certification required.
ALTER TABLE services ADD COLUMN IF NOT EXISTS required_certification TEXT;
