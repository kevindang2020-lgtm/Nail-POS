-- 436_skill_request_and_schedule.sql
-- Add new fields and statuses to technician_skill_change_requests
-- Add shifts and breaks to technician_schedules

-- 1. Skill Requests
ALTER TABLE technician_skill_change_requests DROP CONSTRAINT IF EXISTS technician_skill_change_requests_status_check;

ALTER TABLE technician_skill_change_requests
ADD COLUMN proficiency_level VARCHAR(50),
ADD COLUMN experience_years INTEGER,
ADD COLUMN supporting_photos JSONB DEFAULT '[]'::jsonb,
ADD COLUMN certificate_evidence TEXT,
ADD COLUMN review_notes TEXT,
ADD COLUMN submitted_at TIMESTAMPTZ;

ALTER TABLE technician_skill_change_requests
ADD CONSTRAINT technician_skill_change_requests_status_check
CHECK (status IN ('draft', 'submitted', 'pending', 'under_review', 'more_information_required', 'approved', 'rejected'));

-- 2. Staff Schedule
ALTER TABLE technician_schedules
ADD COLUMN shifts JSONB,
ADD COLUMN breaks JSONB;

-- Set default values for existing schedules (optional, but good for data consistency if needed, leaving as null for now as backend handles fallback)
