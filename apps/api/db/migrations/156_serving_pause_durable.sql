-- 140_serving_pause_durable.sql — durable, cross-node serving-pause state (spec §33 foundation).
-- The POS Serving pause was in-memory only (per-instance overlay), so it was lost on restart and invisible across
-- API nodes. These columns let the pause be persisted on the canonical ticket. PHASE A is additive: the columns are
-- WRITTEN by serving pause/resume and by the tech-side pause, but the Serving read-path derivation that surfaces a
-- 'paused' status from them is intentionally deferred (it is money-path-adjacent — feeds elapsed/commission — and
-- must ship with a checkout regression). Idempotent. DDL verified on live Postgres 16.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS serving_paused_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS accumulated_paused_ms BIGINT NOT NULL DEFAULT 0;
