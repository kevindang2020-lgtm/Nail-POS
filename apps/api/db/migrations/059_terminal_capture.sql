-- 059_terminal_capture.sql
-- Terminal auto-trigger ("customer taps Pay on the iPad -> the paired physical terminal starts the charge").
--
-- 1) pos_payment_terminals.hsn — the CardPointe Bolt Hardware Serial Number that addresses a specific physical
--    terminal on the Integrated Terminal API. A terminal without an HSN can be listed/paired for bookkeeping but can
--    NOT be charged through; capture refuses honestly instead of guessing.
-- 2) tenant_payment_config.bolt_base_url + bolt_api_key_enc — the per-tenant Bolt site URL
--    (e.g. https://<site>.bolt.cardpointe.com) and the Bolt Authorization api key, encrypted at rest with the same
--    AES-256-GCM cipher as the gateway credentials in 036 (mfa-enc). The Bolt API is a SEPARATE product from the
--    CardPointe Gateway: different host, different auth, different payload casing — so it gets its own columns
--    rather than overloading base_url/api_username_enc.
--
-- Idempotent; additive only.

ALTER TABLE pos_payment_terminals
  ADD COLUMN IF NOT EXISTS hsn TEXT;

ALTER TABLE tenant_payment_config
  ADD COLUMN IF NOT EXISTS bolt_base_url   TEXT,
  ADD COLUMN IF NOT EXISTS bolt_api_key_enc TEXT;
