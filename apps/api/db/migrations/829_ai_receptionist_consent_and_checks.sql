-- 829_ai_receptionist_consent_and_checks.sql — A9 AI Receptionist Settings guide, the parts listed as "not built" (Nov 6 2026).
-- 1. Recording-notice approval: an owner approves the exact recording notice text for the salon (branch_id = the all-zero
--    sentinel) or one branch. Recording can only be switched on, or the notice changed while recording is on, when the
--    effective text has an approval row. Rows are append-only history (who approved which text, when).
-- 2. Settings health runs: every "Check Receptionist Settings" result is recorded (overall, per-check results, who, when).
CREATE TABLE IF NOT EXISTS ai_receptionist_consent_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  text_sha256   TEXT NOT NULL,
  consent_text  TEXT NOT NULL,
  approved_by   UUID,
  approved_role TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_receptionist_consent_approvals_scope ON ai_receptionist_consent_approvals (tenant_id, branch_id, text_sha256);

CREATE TABLE IF NOT EXISTS ai_receptionist_settings_checks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  branch_id   UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  overall     TEXT NOT NULL CHECK (overall IN ('READY', 'WARNING', 'FAILED')),
  checks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  run_by      UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_receptionist_settings_checks_scope ON ai_receptionist_settings_checks (tenant_id, branch_id, created_at DESC);
