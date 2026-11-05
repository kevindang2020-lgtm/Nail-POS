-- 646_technician_employment_history_and_profile_policy.sql — Technician Profile mandate (Oct 13 2026)
--   §128 employment history · §62 portable career history (consented) · §95 public-profile change approval · §53 status
--
-- Additive + idempotent; safe on a running salon (new tables, nullable/defaulted columns, a one-off INSERT backfill
-- guarded by NOT EXISTS). Production note: the two indexes on technician_employment_events are on a NEW table and
-- build instantly; no existing table is re-indexed here (no CONCURRENTLY needed).
--
-- 1. technician_employment_events — the APPEND-ONLY employment history of one roster technician at one salon:
--      hired | rehired | role_changed | branch_added | branch_removed | suspended | reactivated | terminated | transferred
--    Leave / Returned are NOT duplicated here: an approved VACATION/SICK row in technician_time_off (528/582) IS the
--    leave, and the history read merges it in (one store per fact). Writer: modules/workforce/src/technicians/
--    employment-history.ts ONLY, called inside the transactions that make the change (materializeMembership,
--    endEmployment, the POS lifecycle chain, branch grants, role edits). Tenant-private: never in a public projection.
CREATE TABLE IF NOT EXISTS technician_employment_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  technician_id           UUID NOT NULL REFERENCES technicians(id),
  global_tech_profile_id  UUID,
  branch_id               UUID,
  event_type              TEXT NOT NULL,
  from_value              TEXT,
  to_value                TEXT,
  reason                  TEXT,
  actor_user_id           UUID,
  actor_role              TEXT,
  source                  TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE technician_employment_events DROP CONSTRAINT IF EXISTS chk_tee_event_type;
ALTER TABLE technician_employment_events ADD CONSTRAINT chk_tee_event_type CHECK (event_type IN
  ('hired','rehired','role_changed','branch_added','branch_removed','suspended','reactivated','terminated','transferred'));
CREATE INDEX IF NOT EXISTS idx_tee_tenant_tech_time ON technician_employment_events (tenant_id, technician_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tee_profile ON technician_employment_events (global_tech_profile_id) WHERE global_tech_profile_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_tee_append_only ON technician_employment_events;
CREATE TRIGGER trg_tee_append_only BEFORE UPDATE OR DELETE ON technician_employment_events
  FOR EACH ROW EXECUTE FUNCTION audit_append_only('occurred_at', 'no');
DROP TRIGGER IF EXISTS trg_tc_tee_technician ON technician_employment_events;
CREATE TRIGGER trg_tc_tee_technician BEFORE INSERT ON technician_employment_events
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('technicians', 'technician_id');
DROP TRIGGER IF EXISTS trg_tc_tee_branch ON technician_employment_events;
CREATE TRIGGER trg_tc_tee_branch BEFORE INSERT ON technician_employment_events
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');

-- Backfill: every existing roster technician gets ONE 'hired' row dated at its created_at (source 'backfill_646'),
-- and an ended one a 'terminated'/'transferred' row at its updated_at. Idempotent (NOT EXISTS on the source tag).
INSERT INTO technician_employment_events (tenant_id, technician_id, global_tech_profile_id, branch_id, event_type, to_value, source, occurred_at)
SELECT t.tenant_id, t.id, t.global_tech_profile_id, t.branch_id, 'hired', coalesce(t.role_label, 'Technician'), 'backfill_646', t.created_at
  FROM technicians t
 WHERE NOT EXISTS (SELECT 1 FROM technician_employment_events e WHERE e.technician_id = t.id AND e.source = 'backfill_646' AND e.event_type = 'hired');
INSERT INTO technician_employment_events (tenant_id, technician_id, global_tech_profile_id, branch_id, event_type, reason, source, occurred_at)
SELECT t.tenant_id, t.id, t.global_tech_profile_id, t.branch_id,
       CASE WHEN t.ended_reason = 'transferred' THEN 'transferred' ELSE 'terminated' END, t.ended_reason, 'backfill_646', t.updated_at
  FROM technicians t
 WHERE (t.is_active = false OR t.archived_at IS NOT NULL) AND t.status IN ('inactive','archived')
   AND NOT EXISTS (SELECT 1 FROM technician_employment_events e WHERE e.technician_id = t.id AND e.source = 'backfill_646' AND e.event_type IN ('terminated','transferred'));

-- 2. §62 portable career history — OFF by default. Only the technician turns it on (PATCH /tech/profile); when on, the
--    public profile lists salon NAMES + start/end YEARS of active/former memberships. Nothing else crosses.
ALTER TABLE global_tech_profiles ADD COLUMN IF NOT EXISTS career_history_public BOOLEAN NOT NULL DEFAULT false;

-- 3. §95 per-salon policy for the technician's PUBLIC profile edits. Mirrors nail_showcase_tenant_policy (576).
CREATE TABLE IF NOT EXISTS technician_profile_tenant_policy (
  tenant_id                               UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  public_profile_changes_require_approval BOOLEAN NOT NULL DEFAULT false,
  updated_by                              UUID,
  updated_at                              TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE technician_profile_tenant_policy ADD COLUMN IF NOT EXISTS updated_by UUID;   -- actor stamp (check:actor-stamp)

-- 4. §95 held public-profile changes. A technician employed (active) at ANY salon whose policy requires approval has
--    public field edits HELD here instead of applied; a manager of one of those salons approves (applied verbatim,
--    re-sanitised) or rejects (with a note). ONE open request per profile (partial unique) — a new edit replaces the
--    pending payload. version = optimistic concurrency for the decision (§104).
CREATE TABLE IF NOT EXISTS tech_profile_change_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_tech_profile_id  UUID NOT NULL REFERENCES global_tech_profiles(id),
  requested_by_user_id    UUID,
  requested_in_tenant_id  UUID,
  changes                 JSONB NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',
  decided_by_user_id      UUID,
  decided_in_tenant_id    UUID,
  decision_note           TEXT,
  decided_at              TIMESTAMPTZ,
  version                 INTEGER NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tech_profile_change_requests DROP CONSTRAINT IF EXISTS chk_tpcr_status;
ALTER TABLE tech_profile_change_requests ADD CONSTRAINT chk_tpcr_status CHECK (status IN ('pending','approved','rejected','withdrawn'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_tpcr_one_pending ON tech_profile_change_requests (global_tech_profile_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tpcr_status ON tech_profile_change_requests (status, created_at);

-- 5. §112 technician import — one row per import run (preview → commit), the per-row outcome kept as JSON so the
--    manager sees exactly which rows created, invited, matched an existing account or were refused (never merged by name).
CREATE TABLE IF NOT EXISTS technician_import_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  created_by_user_id UUID,
  status            TEXT NOT NULL DEFAULT 'committed',
  total_rows        INTEGER NOT NULL DEFAULT 0,
  created_count     INTEGER NOT NULL DEFAULT 0,
  invited_existing_count INTEGER NOT NULL DEFAULT 0,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  results           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE technician_import_runs DROP CONSTRAINT IF EXISTS chk_tir_status;
ALTER TABLE technician_import_runs ADD CONSTRAINT chk_tir_status CHECK (status IN ('committed','partial','failed'));
CREATE INDEX IF NOT EXISTS idx_tir_tenant_time ON technician_import_runs (tenant_id, created_at DESC);
