-- 707_service_done_checklist.sql — Service Done mandate (Oct 28 2026, §22–§30, §108): the quality checklist joins the
-- Service Done workflow columns migration 025 put on tickets (quality status, checkout status, notes, customer-visible
-- notes, notified-at, send key, helper). Until now the Postgres repository kept ALL of that in the API process's memory —
-- two POS stations on two API instances disagreed, and a restart forgot every quality approval and every "sent" key.
-- The repository now reads and writes the columns; this adds the one piece 025 had no column for.
-- Additive, nullable, no backfill (NULL = the default checklist). Idempotent.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS service_done_checklist JSONB;
