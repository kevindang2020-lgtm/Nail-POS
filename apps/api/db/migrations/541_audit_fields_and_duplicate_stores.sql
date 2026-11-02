-- 541_audit_fields_and_duplicate_stores.sql — BUILD_PLAN Phase 10 (Constitution 1 §32–§33, §39, §64, §111 line 7
-- "duplicate tables merged").
--
-- 1. audit_events gains what an investigator needs and the table lacked: the state before and after, the reason, and the
--    request / correlation / session the change came from. AuditService.record fills them from the request context.
--    audit_logs stays the second, tenant-facing + platform log (decided Phase 10: both are append-only; audit_events is
--    the structured trail, audit_logs carries tenant-less platform actions — merging them is not worth a rewrite of
--    126 writers).
-- 2. Support Mode has ONE store, support_access_sessions (Constitution 7). The two older stores are contracted:
--    every super_admin_support_sessions row (no longer written since Constitution 7; read only for sessions opened
--    before that merge) and every membership_support_sessions row (no reader, no writer) is copied in with its own id,
--    then both tables are dropped. Their readers were repointed in the same change.
-- 3. Idempotency has ONE store, api_idempotency (502). The AI checkout upsell and the voice gateway kept their own
--    tables; both now write api_idempotency under their own `scope` ('ai_upsell:…' / 'voice:…'), so the sweep, the
--    tenant deletion and the Super Admin view cover them. Open rows are copied, then the tables are dropped.

-- 1. audit_events fields ---------------------------------------------------------------------------------------------
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS before_state   jsonb;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS after_state    jsonb;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS reason         text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_id     text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS session_id     text;
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_correlation ON audit_events (tenant_id, correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_events_request ON audit_events (request_id) WHERE request_id IS NOT NULL;

-- 2. support sessions → support_access_sessions -----------------------------------------------------------------------
DO $$ BEGIN
  IF to_regclass('super_admin_support_sessions') IS NOT NULL THEN
    INSERT INTO support_access_sessions (id, tenant_id, admin_user_id, reason, scope, started_at, expires_at, ended_at, extension_count, created_at)
    SELECT s.id, s.tenant_id, s.super_admin_user_id, s.reason, 'READ_ONLY', s.started_at, s.expires_at, s.ended_at,
           coalesce(s.extension_count, 0), s.started_at
      FROM super_admin_support_sessions s
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE super_admin_support_sessions;
  END IF;
  IF to_regclass('membership_support_sessions') IS NOT NULL THEN
    INSERT INTO support_access_sessions (id, tenant_id, admin_user_id, reason, scope, started_at, expires_at, ended_at, created_at)
    SELECT m.id, m.tenant_id, m.opened_by_user_id, m.reason,
           CASE WHEN m.access_level = 'assist' THEN 'STANDARD_SUPPORT' ELSE 'READ_ONLY' END,
           m.opened_at, m.expires_at, coalesce(m.closed_at, CASE WHEN m.status <> 'active' THEN m.expires_at END), m.opened_at
      FROM membership_support_sessions m
     WHERE m.opened_by_user_id IS NOT NULL                -- the canonical store requires the admin; an anonymous grant has no one to attribute
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE membership_support_sessions;
  END IF;
END $$;

-- 3. idempotency → api_idempotency -----------------------------------------------------------------------------------
DO $$ BEGIN
  IF to_regclass('ai_checkout_upsell_idempotency') IS NOT NULL THEN
    INSERT INTO api_idempotency (scope, idem_key, tenant_id, method, route, request_hash, state, response_body, created_at, completed_at, expires_at)
    SELECT 'ai_upsell:' || u.tenant_id || ':' || u.branch_id || ':' || u.checkout_id || ':' || u.operation || ':' || u.target_id,
           u.idem_key, u.tenant_id, 'INTERNAL', 'ai_checkout_upsell.' || u.operation, u.payload_hash,
           CASE WHEN u.status = 'done' THEN 'done' ELSE 'inflight' END, u.result, u.created_at, u.completed_at, now() + interval '7 days'
      FROM ai_checkout_upsell_idempotency u
    ON CONFLICT (scope, idem_key) DO NOTHING;
    DROP TABLE ai_checkout_upsell_idempotency;
  END IF;
  IF to_regclass('voice_gateway_idempotency') IS NOT NULL THEN
    INSERT INTO api_idempotency (scope, idem_key, tenant_id, method, route, request_hash, state, response_body, created_at, completed_at, expires_at)
    SELECT 'voice:' || v.tenant_id || ':' || v.operation, v.idempotency_key, v.tenant_id, 'INTERNAL', 'voice_gateway.' || v.operation, v.request_hash,
           CASE WHEN v.status = 'committed' THEN 'done' ELSE 'inflight' END, v.response, v.created_at,
           CASE WHEN v.status = 'committed' THEN v.updated_at END, now() + interval '7 days'
      FROM voice_gateway_idempotency v
    ON CONFLICT (scope, idem_key) DO NOTHING;
    DROP TABLE voice_gateway_idempotency;
  END IF;
END $$;

-- §9/§11: the two customer roots (customer_identities = sign-in, global_customers = the cross-salon profile) get a
-- bridge. Which root wins a merge is Kevin's decision; this only LINKS them (filled by scripts/db-backfill-customer-identity.mjs
-- by normalized phone, resumable through runBackfill). NOT VALID: existing rows are validated by the backfill's last step.
ALTER TABLE global_customers ADD COLUMN IF NOT EXISTS customer_identity_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_global_customers_customer_identity') THEN
    ALTER TABLE global_customers ADD CONSTRAINT fk_global_customers_customer_identity
      FOREIGN KEY (customer_identity_id) REFERENCES customer_identities (id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM global_customers g
   WHERE g.customer_identity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customer_identities c WHERE c.id = g.customer_identity_id);
  IF n = 0 THEN EXECUTE 'ALTER TABLE global_customers VALIDATE CONSTRAINT fk_global_customers_customer_identity';
  ELSE PERFORM schema_defer_constraint('fk_global_customers_customer_identity', 'global_customers', 'foreign_key_validation', '541_audit_fields_and_duplicate_stores.sql',
         format('%s orphan identity links', n), n, 'ALTER TABLE global_customers VALIDATE CONSTRAINT fk_global_customers_customer_identity');
  END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_global_customers_customer_identity ON global_customers (customer_identity_id) WHERE customer_identity_id IS NOT NULL;
