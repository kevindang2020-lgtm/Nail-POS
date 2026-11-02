-- 451_hash_plaintext_tokens.sql — Constitution 12 §13, §47 (audit findings M6, M7, M8): no plaintext secrets or bearer tokens.
--
-- M6 bank_webhook_endpoints: the URL token that resolves the tenant is now looked up by its SHA-256 (token_hash);
--    the signing secret moves to signing_secret_enc (AES-256-GCM under WEBHOOK_SIGNING_KEK). The secret cannot be
--    encrypted in SQL (the key lives in the application), so the repository encrypts each row on its first use and
--    clears the plaintext; a later migration drops `signing_secret` once every row shows NULL there.
-- M7 billing_export_jobs.download_token → download_token_hash: a bearer token that downloads a billing export was
--    stored in the clear; existing values are hashed in place (old links keep working; they expire anyway).
-- M8 public_check_in_sessions.public_token: the table is referenced by no code (its only mention is a comment), and
--    the column held a kiosk bearer token in the clear. Dropped.
ALTER TABLE bank_webhook_endpoints ADD COLUMN IF NOT EXISTS signing_secret_enc TEXT;
ALTER TABLE bank_webhook_endpoints ADD COLUMN IF NOT EXISTS token_hash TEXT;
UPDATE bank_webhook_endpoints SET token_hash = encode(digest(token, 'sha256'), 'hex') WHERE token_hash IS NULL AND token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_webhook_endpoints_token_hash ON bank_webhook_endpoints (token_hash);
ALTER TABLE bank_webhook_endpoints ALTER COLUMN signing_secret DROP NOT NULL;
ALTER TABLE bank_webhook_endpoints ALTER COLUMN token DROP NOT NULL;

ALTER TABLE billing_export_jobs RENAME COLUMN download_token TO download_token_hash;
UPDATE billing_export_jobs SET download_token_hash = encode(digest(download_token_hash, 'sha256'), 'hex') WHERE download_token_hash IS NOT NULL AND length(download_token_hash) <> 64;

ALTER TABLE public_check_in_sessions DROP COLUMN IF EXISTS public_token;
