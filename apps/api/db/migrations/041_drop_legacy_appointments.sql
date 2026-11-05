-- 041_drop_legacy_appointments.sql
--
-- The legacy `appointments` and `appointment_service_lines` tables were superseded by `pos_tech_appointments`,
-- which is now the single source of truth for appointments across every booking source (front-desk booking,
-- customer-app self-booking, live-schedule walk-ins) and every reader (dashboard, overview, check-in, the
-- customer app, and the customers directory/merge). A full-repo audit confirmed these two tables have ZERO
-- remaining readers or writers, and an FK check confirmed no foreign-key dependencies in either direction.
--
-- Dropping them removes dead schema and prevents the (already-seen) class of bug where new code accidentally
-- reads/writes the unwritten legacy table instead of `pos_tech_appointments`.
--
-- Reversible: re-running migrations 009 / 014 (which CREATE ... IF NOT EXISTS) recreates the empty tables if
-- ever needed. This migration is idempotent (IF EXISTS).

DROP TABLE IF EXISTS appointment_service_lines;
DROP TABLE IF EXISTS appointments;
