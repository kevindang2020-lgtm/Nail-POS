-- 109_ticket_satisfaction_rating.sql — per-ticket guest satisfaction rating (1–5).
-- Captured post-service (customer display, SMS follow-up, or by the technician) via the checkout
-- rating endpoint. Nullable: a ticket is unrated until a guest/staff submits a score. The
-- Customer Satisfaction KPI averages this over today's rated tickets. Idempotent + additive.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS satisfaction_rating SMALLINT;
