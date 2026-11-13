-- 991_walkin_service_requests_updated_by.sql — round 12 (CPad walk-in, Section 4A): actor stamp for the request table.
-- Requests are written by the authenticated customer display (no staff user), so updated_by stays NULL for display
-- writes; a staff-side change (resolve / cancel through the POS) records the user. Additive and nullable.
ALTER TABLE walkin_service_requests ADD COLUMN IF NOT EXISTS updated_by UUID NULL;
