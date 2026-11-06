-- 819_backup_recovery_catalog.sql — Enterprise Backup & Disaster Recovery guide (Nov 5 2026, G9).
--
-- ONE versioned recovery catalog (§31–33). It records what the provider's backup job ACTUALLY produced — a manifest with
-- artifact locations, sha256 checksums, encryption key REFERENCES (never a key), schema version and app release — and
-- what a real restore into a scratch database PROVED about it. The Super Admin Backup Center reads only these rows: a point
-- is shown as recoverable only once a verification proved it (§16 "display verified points only", §32 "do not say
-- HEALTHY merely because some S3 object exists"). backup_reports (447) stays the job/drill heartbeat it already is.
--
--   backup_recovery_points       one row per recovery point the provider job reported (platform / tenant / branch scope)
--   backup_point_verifications   append-only: every verification run against a point and its evidence
--   backup_restore_plans         a reviewed, checksummed restore plan + its job state (REQUESTED → … → COMPLETED/BLOCKED)
--   backup_restore_events        append-only: every transition, approval and refusal of a plan
--
-- No foreign key to tenants/branches on purpose: the catalog must outlive a deleted tenant (that is when it is needed).
-- Scope is validated by the service on every read and write, never taken from the client alone (§39).

CREATE TABLE IF NOT EXISTS backup_recovery_points (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment               text NOT NULL CHECK (environment ~ '^[a-z0-9_-]{1,40}$'),
  scope                     text NOT NULL CHECK (scope IN ('platform', 'tenant', 'branch')),
  tenant_id                 uuid,
  branch_id                 uuid,
  source                    text NOT NULL CHECK (source IN ('provider_snapshot', 'pitr_window', 'logical_export', 'pre_restore_safety')),
  backup_ref                text NOT NULL CHECK (length(backup_ref) BETWEEN 1 AND 200),
  recovery_timestamp        timestamptz NOT NULL,
  pitr_window_start         timestamptz,
  pitr_window_end           timestamptz,
  database_checkpoint       text CHECK (database_checkpoint IS NULL OR length(database_checkpoint) <= 200),
  wal_timeline              text CHECK (wal_timeline IS NULL OR length(wal_timeline) <= 60),
  schema_version            text NOT NULL CHECK (length(schema_version) BETWEEN 1 AND 200),
  app_release               text CHECK (app_release IS NULL OR length(app_release) <= 200),
  manifest                  jsonb NOT NULL,
  manifest_sha256           text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes                bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  retention_class           text NOT NULL CHECK (retention_class IN ('pitr', 'daily', 'weekly', 'monthly', 'annual', 'pre_restore_safety')),
  expires_at                timestamptz,
  immutable_replica_status  text NOT NULL DEFAULT 'missing' CHECK (immutable_replica_status IN ('present', 'missing')),
  verification_status       text NOT NULL DEFAULT 'UNVERIFIED'
                            CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'PARTIAL', 'FAILED', 'EXPIRED')),
  verification_detail       text CHECK (verification_detail IS NULL OR length(verification_detail) <= 2000),
  verified_at               timestamptz,
  rejected_reasons          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid,
  CONSTRAINT chk_brp_scope CHECK (
    (scope = 'platform' AND tenant_id IS NULL AND branch_id IS NULL) OR
    (scope = 'tenant' AND tenant_id IS NOT NULL AND branch_id IS NULL) OR
    (scope = 'branch' AND tenant_id IS NOT NULL AND branch_id IS NOT NULL)),
  CONSTRAINT chk_brp_pitr CHECK (
    (source = 'pitr_window') = (pitr_window_start IS NOT NULL AND pitr_window_end IS NOT NULL)),
  CONSTRAINT chk_brp_pitr_order CHECK (pitr_window_start IS NULL OR pitr_window_start <= pitr_window_end)
);
-- the same provider backup reported twice is ONE point (the job may retry its report)
CREATE UNIQUE INDEX IF NOT EXISTS uq_brp_backup_ref ON backup_recovery_points (environment, backup_ref);
CREATE INDEX IF NOT EXISTS idx_brp_scope_ts ON backup_recovery_points (scope, recovery_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_brp_tenant_ts ON backup_recovery_points (tenant_id, recovery_timestamp DESC) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS backup_point_verifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_point_id   uuid NOT NULL REFERENCES backup_recovery_points (id),
  result              text NOT NULL CHECK (result IN ('VERIFIED', 'PARTIAL', 'FAILED')),
  checks              jsonb NOT NULL,
  detail              text CHECK (detail IS NULL OR length(detail) <= 2000),
  started_at          timestamptz,
  completed_at        timestamptz NOT NULL,
  reported_by         text NOT NULL CHECK (length(reported_by) BETWEEN 1 AND 80),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bpv_point ON backup_point_verifications (recovery_point_id, completed_at DESC);
CREATE OR REPLACE FUNCTION bpv_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'backup_point_verifications is append-only' USING ERRCODE = 'P0001'; END $$;
DROP TRIGGER IF EXISTS trg_bpv_append_only ON backup_point_verifications;
CREATE TRIGGER trg_bpv_append_only BEFORE UPDATE OR DELETE ON backup_point_verifications FOR EACH ROW EXECUTE FUNCTION bpv_append_only();

CREATE TABLE IF NOT EXISTS backup_restore_plans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                   text NOT NULL CHECK (mode IN ('FULL_TENANT', 'ONE_BRANCH', 'SELECTED_DOMAIN', 'FULL_PLATFORM', 'NON_DESTRUCTIVE_PREVIEW')),
  tenant_id              uuid,
  branch_id              uuid,
  recovery_point_id      uuid NOT NULL REFERENCES backup_recovery_points (id),
  target_timestamp       timestamptz NOT NULL,
  reason                 text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
  plan                   jsonb NOT NULL,
  plan_sha256            text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  status                 text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'PLANNING', 'VALIDATING', 'AWAITING_APPROVAL', 'APPROVED',
                           'PREPARING', 'RESTORING', 'RECONCILING', 'VERIFYING', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'BLOCKED', 'CANCELLED')),
  version                integer NOT NULL DEFAULT 1,
  idempotency_key        text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  requested_by           uuid,
  approved_by            uuid,
  approved_at            timestamptz,
  approval_expires_at    timestamptz,
  approved_plan_sha256   text,
  finance_acknowledged   boolean NOT NULL DEFAULT false,
  job_id                 uuid,
  started_at             timestamptz,
  completed_at           timestamptz,
  failure_code           text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  failure_detail         text CHECK (failure_detail IS NULL OR length(failure_detail) <= 2000),
  evidence               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid,
  CONSTRAINT chk_brpl_scope CHECK (
    (mode = 'FULL_PLATFORM' AND tenant_id IS NULL AND branch_id IS NULL) OR
    (mode = 'ONE_BRANCH' AND tenant_id IS NOT NULL AND branch_id IS NOT NULL) OR
    (mode IN ('FULL_TENANT', 'SELECTED_DOMAIN', 'NON_DESTRUCTIVE_PREVIEW') AND tenant_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_brpl_idempotency ON backup_restore_plans (idempotency_key);
-- §18/§33 fencing: at most ONE restore in flight per tenant (and one platform restore) — a second execute is refused by
-- the database, not only by the service
CREATE UNIQUE INDEX IF NOT EXISTS uq_brpl_one_active ON backup_restore_plans ((coalesce(tenant_id::text, 'platform')))
  WHERE status IN ('PREPARING', 'RESTORING', 'RECONCILING', 'VERIFYING');
CREATE INDEX IF NOT EXISTS idx_brpl_created ON backup_restore_plans (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brpl_tenant ON backup_restore_plans (tenant_id, created_at DESC);
-- B-12: a salon's plan can name a platform point (tenant_id NULL) or its OWN point — never another salon's
DROP TRIGGER IF EXISTS trg_tc_backup_restore_plans__recovery_point_id ON backup_restore_plans;
CREATE TRIGGER trg_tc_backup_restore_plans__recovery_point_id BEFORE INSERT OR UPDATE OF recovery_point_id, tenant_id ON backup_restore_plans
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('backup_recovery_points', 'recovery_point_id');

CREATE TABLE IF NOT EXISTS backup_restore_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id            uuid NOT NULL REFERENCES backup_restore_plans (id),
  from_status        text,
  to_status          text NOT NULL,
  action             text NOT NULL CHECK (action ~ '^[a-z_]{2,40}$'),
  actor_user_id      uuid,
  actor_label        text CHECK (actor_label IS NULL OR length(actor_label) <= 120),
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bre_plan ON backup_restore_events (plan_id, created_at);
CREATE OR REPLACE FUNCTION bre_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'backup_restore_events is append-only' USING ERRCODE = 'P0001'; END $$;
DROP TRIGGER IF EXISTS trg_bre_append_only ON backup_restore_events;
CREATE TRIGGER trg_bre_append_only BEFORE UPDATE OR DELETE ON backup_restore_events FOR EACH ROW EXECUTE FUNCTION bre_append_only();
