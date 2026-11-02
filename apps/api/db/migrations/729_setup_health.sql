-- 729_setup_health.sql — Four-Module Completion Guide (Oct 30 2026) §13–§15: Setup Health dashboard (HL-01), nightly
-- verification + escalation (HL-02) and recorded release evidence (QA-01..04). EXPAND-ONLY and idempotent.
--
--   health_check_runs      one run of the verifier for one salon (manual "Run Health Check" or the nightly job). A nightly
--                          run is unique per salon × salon-local date (idempotent: a rerun returns the same run).
--   health_check_results   one row per check × branch scope in a run: status (ready · warning · action_required ·
--                          pending_external · unknown · disabled · error), severity, source table / provider, the time the
--                          underlying fact was VERIFIED (not when we looked), when it expires, the last good time, and a
--                          safe detail object (codes and counts — never a credential, phone number or customer).
--   health_check_alerts    deduplicated open issues per salon × check × branch (fingerprint): first / last seen, occurrences,
--                          escalation time, acknowledgement. In-app only; nothing is texted or emailed from here.
--   release_evidence       platform-recorded proof (CI run, staging run, migration apply, screen test, physical device
--                          test) per version. Absent evidence is reported as missing — never assumed.
-- Recovery: new tables only; rolling the code back leaves them unread.

CREATE TABLE IF NOT EXISTS health_check_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  trigger_kind  text NOT NULL CHECK (trigger_kind IN ('manual', 'nightly')),
  run_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  summary_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  error         text,
  requested_by_user_id uuid,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_health_check_runs_nightly ON health_check_runs (tenant_id, run_date) WHERE trigger_kind = 'nightly';
CREATE INDEX IF NOT EXISTS health_check_runs_tenant_idx ON health_check_runs (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS health_check_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES health_check_runs(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid,
  area          text NOT NULL,
  check_key     text NOT NULL,
  status        text NOT NULL CHECK (status IN ('ready', 'warning', 'action_required', 'pending_external', 'unknown', 'disabled', 'error')),
  severity      text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  source        text NOT NULL,
  verified_at   timestamptz,
  expires_at    timestamptz,
  last_good_at  timestamptz,
  detail_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_check_results_run_idx ON health_check_results (run_id);
CREATE INDEX IF NOT EXISTS health_check_results_tenant_key_idx ON health_check_results (tenant_id, check_key, created_at DESC);

CREATE TABLE IF NOT EXISTS health_check_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  branch_id        uuid,
  check_key        text NOT NULL,
  fingerprint      text NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  severity         text NOT NULL,
  last_status      text NOT NULL,
  occurrences      integer NOT NULL DEFAULT 1,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  escalated_at     timestamptz,
  acknowledged_at  timestamptz,
  acknowledged_by_user_id uuid,
  last_run_id      uuid,
  CONSTRAINT uq_health_check_alerts UNIQUE (tenant_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS health_check_alerts_open_idx ON health_check_alerts (tenant_id, severity) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS release_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('ci_run', 'staging_run', 'migration_apply', 'screen_test', 'device_test')),
  app_version   text NOT NULL,
  commit_sha    text,
  reference     text,
  outcome       text NOT NULL CHECK (outcome IN ('passed', 'failed', 'partial')),
  summary       text,
  recorded_by_user_id uuid,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS release_evidence_kind_idx ON release_evidence (kind, recorded_at DESC);
