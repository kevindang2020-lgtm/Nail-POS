-- 685_go_checkin_sessions_tenant_started.sql — Security Deep Scan E10 (Oct 23 2026): the kiosk's salon-wide caps count
-- sessions started / lookups made in the last 15 minutes per salon; this keeps that read an index range scan.
CREATE INDEX IF NOT EXISTS idx_go_checkin_sessions_tenant_started ON go_checkin_sessions (tenant_id, started_at);
