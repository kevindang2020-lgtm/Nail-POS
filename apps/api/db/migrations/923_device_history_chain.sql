-- 923_device_history_chain.sql — Device Assignments 25 (extras round 10): a tamper-evident hash chain over device history.
-- Every audit_logs row about a device (registration, station / terminal changes, revocation, diagnostics — the entity types
-- the device History tab reads) is linked into one chain per salon at insert time: row_hash = sha256(prev_hash || the row's
-- facts). The chain table is append-only. A later edit of a device audit row, a removed row or a broken link is found by the
-- read-only verify (recompute and compare); nothing is ever repaired silently. Built-in sha256 (PG ≥ 11), no pgcrypto.
CREATE TABLE IF NOT EXISTS device_history_chain (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants (id),
  seq           BIGINT NOT NULL,
  audit_log_id  UUID NOT NULL UNIQUE,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  prev_hash     TEXT NOT NULL,
  row_hash      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, seq)
);
CREATE OR REPLACE FUNCTION device_history_row_digest(p_prev TEXT, p_id UUID, p_tenant UUID, p_entity_type TEXT, p_entity_id TEXT, p_action TEXT, p_user UUID, p_at TIMESTAMPTZ, p_meta TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|', p_prev, p_id::text, p_tenant::text, coalesce(p_entity_type, ''), coalesce(p_entity_id, ''), coalesce(p_action, ''),
    coalesce(p_user::text, ''), to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(p_meta, '')), 'UTF8')), 'hex')
$$;
CREATE OR REPLACE FUNCTION device_history_chain_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prev TEXT; v_seq BIGINT;
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.entity_type IS NULL OR NEW.entity_type NOT IN ('customer_display', 'pos_station', 'payment_terminal', 'pos_payment_terminal') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('device-history-chain:' || NEW.tenant_id::text));
  SELECT c.row_hash, c.seq INTO v_prev, v_seq FROM device_history_chain c WHERE c.tenant_id = NEW.tenant_id ORDER BY c.seq DESC LIMIT 1;
  INSERT INTO device_history_chain (tenant_id, seq, audit_log_id, entity_type, entity_id, prev_hash, row_hash)
  VALUES (NEW.tenant_id, coalesce(v_seq, 0) + 1, NEW.id, NEW.entity_type, NEW.entity_id::text, coalesce(v_prev, 'GENESIS'),
    device_history_row_digest(coalesce(v_prev, 'GENESIS'), NEW.id, NEW.tenant_id, NEW.entity_type, NEW.entity_id::text, NEW.action_type, NEW.user_id, NEW.created_at, NEW.metadata_json::text));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_logs_device_chain ON audit_logs;
CREATE TRIGGER trg_audit_logs_device_chain AFTER INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION device_history_chain_link();
CREATE OR REPLACE FUNCTION device_history_chain_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'device_history_chain is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_device_history_chain_append_only ON device_history_chain;
CREATE TRIGGER trg_device_history_chain_append_only BEFORE UPDATE OR DELETE ON device_history_chain FOR EACH ROW EXECUTE FUNCTION device_history_chain_append_only();
