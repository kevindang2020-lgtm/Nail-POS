-- 757_reception_copilot_center.sql — Reception Copilot completion (Reception Copilot Complete Build Guide, Oct 2026).
-- Additive only. Rollback: DROP TABLE reception_copilot_health_runs; DROP INDEX ix_rcopilot_ledger_recent; ALTER TABLE
-- reception_copilot_action_ledger DROP COLUMN state, actor_user_id, payload_hash, correlation_id, error_code, summary,
-- finished_at, updated_at, updated_by; ALTER COLUMN ok DROP DEFAULT. (No existing row is rewritten except the state backfill.)
--
-- 1. The action ledger becomes claim-before-run: a confirmed action CLAIMS its idempotency key (state 'pending') before the
--    booking / messaging service is called, so two simultaneous confirms can no longer both execute (the old ledger was
--    find → run → record). State is the action's true lifecycle: pending → succeeded | failed | unknown.
-- 2. Check Copilot System runs are recorded (evidence + a 30-second rate limit), never changing business data.

ALTER TABLE reception_copilot_action_ledger
  ADD COLUMN IF NOT EXISTS state          TEXT CHECK (state IN ('pending', 'succeeded', 'failed', 'unknown')),
  ADD COLUMN IF NOT EXISTS actor_user_id  UUID,
  ADD COLUMN IF NOT EXISTS payload_hash   TEXT,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS error_code     TEXT,
  ADD COLUMN IF NOT EXISTS summary        TEXT,
  ADD COLUMN IF NOT EXISTS finished_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by     UUID;

ALTER TABLE reception_copilot_action_ledger ALTER COLUMN ok SET DEFAULT false;

-- legacy rows: their outcome was recorded after the fact, so they are finished
UPDATE reception_copilot_action_ledger SET state = CASE WHEN ok THEN 'succeeded' ELSE 'failed' END, finished_at = created_at
 WHERE state IS NULL;

ALTER TABLE reception_copilot_action_ledger ALTER COLUMN state SET DEFAULT 'pending';
-- the state vocabulary is the inline CHECK on the column above (pending · succeeded · failed · unknown)

CREATE INDEX IF NOT EXISTS ix_rcopilot_ledger_recent ON reception_copilot_action_ledger (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS reception_copilot_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('READY', 'WARNING', 'FAILED', 'NOT_CONFIGURED', 'DISABLED', 'UNKNOWN')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rcopilot_health_recent ON reception_copilot_health_runs (tenant_id, created_at DESC);
