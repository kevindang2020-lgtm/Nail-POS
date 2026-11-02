-- 601_turn_unit_rules.sql — Fair Turn Engine mandate §41–45, §74–75: turn units per service.
--
-- One row per VERSION of a rule. A rule is identified by rule_key; editing a rule supersedes the active version (active
-- = false, superseded_at / superseded_by stamped) and inserts version + 1 — the old version is never rewritten, so an
-- assignment that recorded (turn_rule_id, turn_rule_version, turn_units) stays explainable after the owner edits it (§45).
--   scope 'service'  — service_id;  'category' — category (the service category name);  'duration' — the rule for
--   services up to max_duration_minutes (the smallest matching bound wins). Precedence: service → category → duration →
--   the salon's default units (turn_policy.defaultTurnUnits) — deterministic (§44).
-- turn_units is FIXED POINT in hundredths of a turn (25 = 0.25, 50 = 0.50, 100 = 1.00, 150 = 1.50) — never floats (§43).
-- special_rotation (§74): a job counted in the separate reverse-rotation pool instead of the normal turn count.
CREATE TABLE IF NOT EXISTS turn_unit_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  rule_key              UUID NOT NULL DEFAULT gen_random_uuid(),
  version               INTEGER NOT NULL DEFAULT 1,
  scope                 TEXT NOT NULL,
  service_id            UUID,
  category              TEXT,
  max_duration_minutes  INTEGER,
  turn_units            INTEGER NOT NULL,
  special_rotation      BOOLEAN NOT NULL DEFAULT false,
  active                BOOLEAN NOT NULL DEFAULT true,
  reason                TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMPTZ,
  superseded_by         UUID,
  CONSTRAINT chk_turn_unit_rules_scope CHECK (scope IN ('service', 'category', 'duration')),
  CONSTRAINT chk_turn_unit_rules_units CHECK (turn_units >= 0 AND turn_units <= 1000),
  CONSTRAINT chk_turn_unit_rules_target CHECK (
    (scope = 'service'  AND service_id IS NOT NULL) OR
    (scope = 'category' AND category IS NOT NULL AND length(trim(category)) > 0) OR
    (scope = 'duration' AND max_duration_minutes IS NOT NULL AND max_duration_minutes > 0)),
  CONSTRAINT uq_turn_unit_rules_version UNIQUE (tenant_id, rule_key, version)
);
-- one ACTIVE version per rule, and one active rule per target
CREATE UNIQUE INDEX IF NOT EXISTS uq_turn_unit_rules_active_key ON turn_unit_rules (tenant_id, rule_key) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_turn_unit_rules_active_service ON turn_unit_rules (tenant_id, service_id) WHERE active AND scope = 'service';
CREATE UNIQUE INDEX IF NOT EXISTS uq_turn_unit_rules_active_category ON turn_unit_rules (tenant_id, lower(category)) WHERE active AND scope = 'category';
CREATE UNIQUE INDEX IF NOT EXISTS uq_turn_unit_rules_active_duration ON turn_unit_rules (tenant_id, max_duration_minutes) WHERE active AND scope = 'duration';
CREATE INDEX IF NOT EXISTS idx_turn_unit_rules_tenant ON turn_unit_rules (tenant_id, active);

DROP TRIGGER IF EXISTS trg_tc_turn_unit_rule_service ON turn_unit_rules;
CREATE TRIGGER trg_tc_turn_unit_rule_service BEFORE INSERT OR UPDATE OF tenant_id, service_id ON turn_unit_rules
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('services', 'service_id');
