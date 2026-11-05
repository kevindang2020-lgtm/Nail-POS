-- 524_ai_queue_assignment_complete.sql — BUILD_PLAN Phase 6 (ai_queue_assignment → complete).
--
-- Expand-only. One queue model the engine, the boards and the auto-run all act on:
--   • pos_queue_items gains a VERSION (every transition bumps it; a stale write is refused), a board POSITION (reorder),
--     a GROUP (a party checked in together) and a late-arrival stamp; every status / technician change is written to
--     pos_queue_status_history (who, from → to, version, source, reason).
--   • queue_assignment_locks — a manager pins a guest to a technician (or to "nobody yet"); the engine, the boards and
--     the auto-run all respect it. One active lock per guest.
--   • queue_service_assignments — a multi-technician visit: each requested service on its own technician.
--   • queue_groups — a party (2–N guests) checked in together, assigned side by side.
--   • Settings: salon-wide defaults (queue_assignment_tenant_settings) under the per-branch rows, both VERSIONED, with
--     every change kept in queue_assignment_settings_versions; the tenant-wide auto-assign kill switch; exclusions,
--     delay, thresholds for stuck / congestion / late arrival.
--   • Decisions: 'auto_assigned' is its own decision (it was logged as 'accepted', inflating acceptance); applied flag,
--     idempotency key, the previous technician, the reviewer.
--   • Alerts: more types (late appointment, long service, overloaded technician), auto-resolution, reviewer notes.
--   • Recommendations record the config version they were made under.
--   • Rotation: who was served last and when, a fixed order.

-- ── the queue itself ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE pos_queue_items ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pos_queue_items ADD COLUMN IF NOT EXISTS position INTEGER;                 -- board order within the branch (null = by check-in time)
ALTER TABLE pos_queue_items ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE pos_queue_items ADD COLUMN IF NOT EXISTS late_minutes INTEGER;             -- appointment guests: minutes late at check-in (null = on time / walk-in)
ALTER TABLE pos_queue_items ADD COLUMN IF NOT EXISTS previous_technician_id UUID;      -- the technician of this customer's last finished visit, stamped at check-in

CREATE INDEX IF NOT EXISTS idx_pos_queue_items_branch_active
  ON pos_queue_items (tenant_id, branch_id, status, checked_in_at) WHERE status NOT IN ('completed', 'done', 'cancelled', 'removed');
CREATE INDEX IF NOT EXISTS idx_pos_queue_items_group ON pos_queue_items (tenant_id, group_id) WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_queue_status_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID NOT NULL,
  queue_item_id    UUID NOT NULL,
  version          INTEGER NOT NULL,                 -- the item's version AFTER this change
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  from_technician  UUID,
  to_technician    UUID,
  action           TEXT NOT NULL,                    -- assign / unassign / call / start / move / cancel / reorder / lock / repair / auto_assign …
  source           TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'ai_suggestion', 'auto_assign', 'repair', 'system', 'customer', 'kiosk', 'technician')),
  actor_id         UUID,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_queue_status_history_item ON pos_queue_status_history (tenant_id, queue_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_queue_status_history_branch ON pos_queue_status_history (tenant_id, branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS queue_assignment_locks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID NOT NULL,
  queue_item_id    UUID NOT NULL,
  technician_id    UUID,                              -- null = "do not assign anyone yet"
  reason           TEXT NOT NULL,
  locked_by        UUID,
  expires_at       TIMESTAMPTZ,
  released_at      TIMESTAMPTZ,
  released_by      UUID,
  release_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_assignment_lock_active ON queue_assignment_locks (tenant_id, queue_item_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_queue_assignment_locks_branch ON queue_assignment_locks (tenant_id, branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS queue_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID NOT NULL,
  label            TEXT NOT NULL,
  size             INTEGER NOT NULL CHECK (size >= 2 AND size <= 20),
  together         BOOLEAN NOT NULL DEFAULT true,      -- start side by side (true) or whenever each is ready
  status           TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_service', 'done', 'cancelled')),
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_groups_branch ON queue_groups (tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS queue_service_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID NOT NULL,
  queue_item_id    UUID NOT NULL,
  service_id       UUID NOT NULL,
  technician_id    UUID,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_service', 'done', 'cancelled')),
  sequence         INTEGER NOT NULL DEFAULT 0,          -- order of the services in the visit
  assigned_by      UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, queue_item_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_queue_service_assignments_tech ON queue_service_assignments (tenant_id, technician_id, status);

-- ── settings: salon defaults under branch rows, versioned ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS queue_assignment_tenant_settings (
  tenant_id              UUID PRIMARY KEY,
  version                INTEGER NOT NULL DEFAULT 1,
  wait_approaching_min   INTEGER NOT NULL DEFAULT 10 CHECK (wait_approaching_min >= 0),
  wait_exceeded_min      INTEGER NOT NULL DEFAULT 20 CHECK (wait_exceeded_min >= 0),
  wait_severe_min        INTEGER NOT NULL DEFAULT 30 CHECK (wait_severe_min >= 0),
  wait_critical_min      INTEGER NOT NULL DEFAULT 45 CHECK (wait_critical_min >= 0),
  stuck_minutes          INTEGER NOT NULL DEFAULT 30 CHECK (stuck_minutes >= 5),
  long_service_factor    NUMERIC(4,2) NOT NULL DEFAULT 1.5 CHECK (long_service_factor >= 1),
  congestion_waiting_per_tech NUMERIC(5,2) NOT NULL DEFAULT 2.0 CHECK (congestion_waiting_per_tech > 0),
  late_grace_min         INTEGER NOT NULL DEFAULT 10 CHECK (late_grace_min >= 0),
  rotation_policy        TEXT NOT NULL DEFAULT 'hybrid' CHECK (rotation_policy IN ('hybrid','least_minutes','least_customers','first_available','fixed_order')),
  auto_enabled           BOOLEAN NOT NULL DEFAULT false,
  auto_killed            BOOLEAN NOT NULL DEFAULT false,  -- the salon-wide kill switch: no branch auto-assigns while on
  auto_killed_reason     TEXT,
  auto_confidence_floor  NUMERIC(5,4) NOT NULL DEFAULT 0.75 CHECK (auto_confidence_floor >= 0 AND auto_confidence_floor <= 1),
  auto_max_per_run       INTEGER NOT NULL DEFAULT 5 CHECK (auto_max_per_run >= 0 AND auto_max_per_run <= 100),
  auto_delay_seconds     INTEGER NOT NULL DEFAULT 120 CHECK (auto_delay_seconds >= 0 AND auto_delay_seconds <= 3600),
  auto_exclusions        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { vip: bool, appointments: bool, requested: bool, groups: bool, technicianIds: [], serviceIds: [] }
  updated_by             UUID,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS inherit BOOLEAN NOT NULL DEFAULT true;   -- null columns below fall back to the salon defaults
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS stuck_minutes INTEGER CHECK (stuck_minutes IS NULL OR stuck_minutes >= 5);
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS long_service_factor NUMERIC(4,2) CHECK (long_service_factor IS NULL OR long_service_factor >= 1);
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS congestion_waiting_per_tech NUMERIC(5,2) CHECK (congestion_waiting_per_tech IS NULL OR congestion_waiting_per_tech > 0);
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS late_grace_min INTEGER CHECK (late_grace_min IS NULL OR late_grace_min >= 0);
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS auto_delay_seconds INTEGER CHECK (auto_delay_seconds IS NULL OR (auto_delay_seconds >= 0 AND auto_delay_seconds <= 3600));
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS auto_exclusions JSONB;
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS last_auto_run_at TIMESTAMPTZ;
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS last_scan_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS queue_assignment_settings_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,                               -- null = the salon-wide defaults
  version          INTEGER NOT NULL,
  settings         JSONB NOT NULL,                      -- the full effective row after the change
  change           TEXT NOT NULL,                       -- settings / auto / kill / unkill / rotation / platform
  reason           TEXT,
  changed_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_settings_versions ON queue_assignment_settings_versions (tenant_id, branch_id, created_at DESC);

-- ── rotation ────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE queue_assignment_rotation_state ADD COLUMN IF NOT EXISTS last_served_at TIMESTAMPTZ;
ALTER TABLE queue_assignment_rotation_state ADD COLUMN IF NOT EXISTS fixed_order JSONB NOT NULL DEFAULT '[]'::jsonb;   -- technician ids, in turn order
ALTER TABLE queue_assignment_rotation_state ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ── recommendations / decisions ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE queue_assignment_recommendations ADD COLUMN IF NOT EXISTS config_version INTEGER;
ALTER TABLE queue_assignment_recommendations ADD COLUMN IF NOT EXISTS queue_version INTEGER;   -- the guest's version the suggestion was made on
ALTER TABLE queue_assignment_recommendations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'staff';   -- staff / auto_run / board

ALTER TABLE queue_assignment_decisions DROP CONSTRAINT IF EXISTS queue_assignment_decisions_decision_check;
ALTER TABLE queue_assignment_decisions ADD CONSTRAINT queue_assignment_decisions_decision_check
  CHECK (decision IN ('accepted', 'rejected', 'overridden', 'kept_unassigned', 'auto_assigned'));
ALTER TABLE queue_assignment_decisions ADD COLUMN IF NOT EXISTS applied BOOLEAN NOT NULL DEFAULT false;   -- the queue really assigned
ALTER TABLE queue_assignment_decisions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE queue_assignment_decisions ADD COLUMN IF NOT EXISTS previous_technician TEXT;
ALTER TABLE queue_assignment_decisions ADD COLUMN IF NOT EXISTS feedback_code TEXT;              -- structured rejection reason
ALTER TABLE queue_assignment_decisions ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE queue_assignment_decisions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_qad_idempotency ON queue_assignment_decisions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- the backfill: auto-runs were written as 'accepted' with reason 'auto_assignment'
UPDATE queue_assignment_decisions SET decision = 'auto_assigned', applied = true WHERE decision = 'accepted' AND reason = 'auto_assignment';

-- ── alerts ──────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE queue_alerts DROP CONSTRAINT IF EXISTS queue_alerts_type_check;
ALTER TABLE queue_alerts ADD CONSTRAINT queue_alerts_type_check
  CHECK (type IN ('waiting_too_long', 'unassigned', 'congestion', 'stuck_record', 'late_appointment', 'long_service', 'overloaded_technician'));
ALTER TABLE queue_alerts ADD COLUMN IF NOT EXISTS auto_resolved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE queue_alerts ADD COLUMN IF NOT EXISTS resolution TEXT;             -- why it closed (condition cleared, repaired, dismissed …)
ALTER TABLE queue_alerts ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE queue_alerts ADD COLUMN IF NOT EXISTS technician_id UUID;          -- overloaded / long-service alerts name the technician
ALTER TABLE queue_alerts ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;    -- the scan still saw the condition at this time
