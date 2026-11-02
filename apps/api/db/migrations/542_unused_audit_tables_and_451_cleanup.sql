-- 542_unused_audit_tables_and_451_cleanup.sql — BUILD_PLAN Phase 10 (Constitution 1 §111 lines 7 and 43; Constitution 12
-- §13/§47; audit bug 6).
--
-- 1. Three per-screen audit tables no code reads or writes (grep across modules/, apps/, packages/, tooling/ on Oct 8 2026:
--    the only mention was scripts/clean-bookings.mjs deleting from them). pos_queue_audit stays — 11 readers.
-- 2. The cleanup migration 451 promised and never shipped: bank_webhook_endpoints kept the URL token and the signing
--    secret in plaintext beside token_hash / signing_secret_enc. The repository no longer reads either plaintext column.
--      token          — every row's hash is computable in SQL, so it is filled first and the column dropped when every
--                       plaintext token has its hash;
--      signing_secret — the encryption key lives in the application, so SQL cannot seal it: the column is dropped only
--                       when no row still holds a plaintext secret without its encrypted twin. Otherwise the drop is
--                       DEFERRED (schema_deferred_constraints, counts only) and `node apps/api/scripts/seal-bank-webhook-secrets.mjs`
--                       seals the remaining rows; the recorded retry_sql then drops the column.

DROP TABLE IF EXISTS pos_tech_appointments_audit;
DROP TABLE IF EXISTS pos_tech_queue_audit;
DROP TABLE IF EXISTS pos_service_done_audit;

DO $$ DECLARE n int; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bank_webhook_endpoints' AND column_name = 'token') THEN
    EXECUTE $q$UPDATE bank_webhook_endpoints SET token_hash = encode(digest(token, 'sha256'), 'hex') WHERE token_hash IS NULL AND token IS NOT NULL$q$;
    EXECUTE 'SELECT count(*) FROM bank_webhook_endpoints WHERE token IS NOT NULL AND token_hash IS NULL' INTO n;
    IF n = 0 THEN EXECUTE 'ALTER TABLE bank_webhook_endpoints DROP COLUMN token';
    ELSE PERFORM schema_defer_constraint('bank_webhook_endpoints.token', 'bank_webhook_endpoints', 'other', '542_unused_audit_tables_and_451_cleanup.sql',
           format('%s plaintext tokens without a hash', n), n, 'ALTER TABLE bank_webhook_endpoints DROP COLUMN IF EXISTS token');
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bank_webhook_endpoints' AND column_name = 'signing_secret') THEN
    -- a plaintext copy beside an encrypted one is redundant: clear it (the encrypted value is what the code reads)
    EXECUTE 'UPDATE bank_webhook_endpoints SET signing_secret = NULL WHERE signing_secret IS NOT NULL AND signing_secret_enc IS NOT NULL';
    EXECUTE 'SELECT count(*) FROM bank_webhook_endpoints WHERE signing_secret IS NOT NULL AND signing_secret_enc IS NULL' INTO n;
    IF n = 0 THEN EXECUTE 'ALTER TABLE bank_webhook_endpoints DROP COLUMN signing_secret';
    ELSE PERFORM schema_defer_constraint('bank_webhook_endpoints.signing_secret', 'bank_webhook_endpoints', 'other', '542_unused_audit_tables_and_451_cleanup.sql',
           format('%s plaintext signing secrets without an encrypted twin (run apps/api/scripts/seal-bank-webhook-secrets.mjs)', n), n,
           'ALTER TABLE bank_webhook_endpoints DROP COLUMN IF EXISTS signing_secret');
    END IF;
  END IF;
END $$;
