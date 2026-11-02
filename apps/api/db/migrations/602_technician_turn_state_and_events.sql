-- 602_technician_turn_state_and_events.sql — Fair Turn Engine mandate §25, §57–61, §133–137, §145–148, §181–187.
--
-- The technician TURN QUEUE (which eligible technician gets the next fair opportunity) — separate from the customer
-- queue (pos_queue_items) and from the workforce state (technician_workforce_state: employment / clock / service):
--
--   technician_turn_state  — the fast materialised CURRENT state, one row per (tenant, branch, business_date, technician).
--                            business_date is the BRANCH-local day (§126): a new day starts new rows, so the daily reset
--                            never deletes anything (§125). rotation_position orders the rotation (lower = sooner);
--                            units are FIXED POINT hundredths (100 = 1.00 turn). provisional_units = assigned, not yet
--                            completed; accumulated_units = credited (TURN_CREDIT at Service Done + ADJUST). version = CAS.
--   technician_turn_events — the APPEND-ONLY history (§133–134, §137): every join / ready / assign / start / complete /
--                            credit / hold / release / break / skip / decline / reorder / manual assign / adjust /
--                            correction / clock-out / day close, with the reason code, actor, policy version, the turn
--                            rule snapshot (§45) and a per-branch-day sequence_number. UPDATE is refused; DELETE only by
--                            the audit retention job after 365 days (audit_append_only, migration 452).
-- Writers: modules/workforce/src/turn-queue/turn-ledger.ts ONLY (called inside the assignment / clock / service
-- transactions of the queue and workforce modules). PostgreSQL is the truth; nothing lives only in Redis (§185–186).

CREATE TABLE IF NOT EXISTS technician_turn_state (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  branch_id                   UUID NOT NULL,
  business_date               DATE NOT NULL,
  technician_id               UUID NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'CLOCKED_IN',
  in_rotation                 BOOLEAN NOT NULL DEFAULT false,
  rotation_position           NUMERIC(14,4) NOT NULL DEFAULT 0,
  accumulated_units           INTEGER NOT NULL DEFAULT 0,
  provisional_units           INTEGER NOT NULL DEFAULT 0,
  pending_units               INTEGER NOT NULL DEFAULT 0,
  baseline_units              INTEGER NOT NULL DEFAULT 0,
  special_units               INTEGER NOT NULL DEFAULT 0,
  service_minutes             INTEGER NOT NULL DEFAULT 0,
  baseline_minutes            INTEGER NOT NULL DEFAULT 0,
  ready_since                 TIMESTAMPTZ,
  last_assignment_at          TIMESTAMPTZ,
  last_eligible_opportunity_at TIMESTAMPTZ,
  eligible_skip_count         INTEGER NOT NULL DEFAULT 0,
  consecutive_auto            INTEGER NOT NULL DEFAULT 0,
  hold_reason                 TEXT,
  break_started_at            TIMESTAMPTZ,
  joined_at                   TIMESTAMPTZ,
  closed_at                   TIMESTAMPTZ,
  policy_version              TEXT,
  version                     INTEGER NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                  UUID,
  CONSTRAINT chk_turn_state_status CHECK (status IN ('CLOCKED_IN', 'READY', 'ASSIGNED', 'SERVING', 'BREAK', 'HOLD', 'UNAVAILABLE', 'CLOCKED_OUT')),
  CONSTRAINT chk_turn_state_units CHECK (accumulated_units >= -100000 AND provisional_units >= 0 AND pending_units >= 0 AND service_minutes >= 0 AND eligible_skip_count >= 0 AND consecutive_auto >= 0),
  CONSTRAINT uq_turn_state_day_tech UNIQUE (tenant_id, branch_id, business_date, technician_id)
);
CREATE INDEX IF NOT EXISTS idx_turn_state_board ON technician_turn_state (tenant_id, branch_id, business_date, status);
CREATE INDEX IF NOT EXISTS idx_turn_state_tech_day ON technician_turn_state (tenant_id, technician_id, business_date);
CREATE INDEX IF NOT EXISTS idx_turn_state_open_days ON technician_turn_state (business_date) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS technician_turn_events (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  branch_id                   UUID NOT NULL,
  business_date               DATE NOT NULL,
  sequence_number             BIGINT NOT NULL,
  technician_id               UUID NOT NULL,
  event_type                  TEXT NOT NULL,
  status_before               TEXT,
  status_after                TEXT,
  queue_item_id               UUID,
  appointment_id              UUID,
  ticket_id                   UUID,
  service_id                  UUID,
  assignment_ref              UUID,               -- the ASSIGN event a TURN_CREDIT / CORRECTION / DECLINE closes
  turn_units                  INTEGER NOT NULL DEFAULT 0,   -- the snapshot units of an assignment (hundredths)
  turn_units_delta            INTEGER NOT NULL DEFAULT 0,   -- the change to the CREDITED units (TURN_CREDIT, ADJUST)
  turn_rule_id                UUID,
  turn_rule_version           INTEGER,
  reason_code                 TEXT,
  reason_text                 TEXT,
  assignment_source           TEXT,               -- auto_assign | ai_suggestion | staff | implicit
  assignment_kind             TEXT,               -- walk_in_shared | walk_in_requested | appointment_any | appointment_requested
  recommended_technician_id   UUID,
  position_before             NUMERIC(14,4),
  position_after              NUMERIC(14,4),
  policy_version              TEXT,
  actor_id                    UUID,
  actor_type                  TEXT NOT NULL DEFAULT 'system',
  idempotency_key             TEXT,
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_turn_event_type CHECK (event_type IN ('JOIN', 'READY', 'ASSIGN', 'MANUAL_ASSIGN', 'START', 'COMPLETE', 'TURN_CREDIT',
    'HOLD', 'RELEASE', 'BREAK_START', 'BREAK_END', 'SKIP', 'DECLINE', 'CUSTOMER_DECLINED', 'OFFER_TIMEOUT', 'REORDER', 'ADJUST',
    'CORRECTION', 'CLOCK_OUT', 'DAY_CLOSE')),
  CONSTRAINT chk_turn_event_actor CHECK (actor_type IN ('user', 'system', 'technician')),
  CONSTRAINT uq_turn_events_sequence UNIQUE (tenant_id, branch_id, business_date, sequence_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_turn_events_idempotency ON technician_turn_events (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_turn_events_day_tech ON technician_turn_events (tenant_id, branch_id, business_date, technician_id);
CREATE INDEX IF NOT EXISTS idx_turn_events_occurred ON technician_turn_events (tenant_id, branch_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_turn_events_queue_item ON technician_turn_events (tenant_id, queue_item_id) WHERE queue_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_turn_events_appointment ON technician_turn_events (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_turn_events_assignment_ref ON technician_turn_events (assignment_ref) WHERE assignment_ref IS NOT NULL;

DROP TRIGGER IF EXISTS trg_turn_events_append_only ON technician_turn_events;
CREATE TRIGGER trg_turn_events_append_only BEFORE UPDATE OR DELETE ON technician_turn_events
  FOR EACH ROW EXECUTE FUNCTION audit_append_only('occurred_at');

-- §181: a turn row / event never names another salon's technician or branch.
DROP TRIGGER IF EXISTS trg_tc_turn_state_technician ON technician_turn_state;
CREATE TRIGGER trg_tc_turn_state_technician BEFORE INSERT OR UPDATE OF tenant_id, technician_id ON technician_turn_state
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('technicians', 'technician_id');
DROP TRIGGER IF EXISTS trg_tc_turn_state_branch ON technician_turn_state;
CREATE TRIGGER trg_tc_turn_state_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON technician_turn_state
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
DROP TRIGGER IF EXISTS trg_tc_turn_event_technician ON technician_turn_events;
CREATE TRIGGER trg_tc_turn_event_technician BEFORE INSERT ON technician_turn_events
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('technicians', 'technician_id');
DROP TRIGGER IF EXISTS trg_tc_turn_event_branch ON technician_turn_events;
CREATE TRIGGER trg_tc_turn_event_branch BEFORE INSERT ON technician_turn_events
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
DROP TRIGGER IF EXISTS trg_tc_turn_event_queue_item ON technician_turn_events;
CREATE TRIGGER trg_tc_turn_event_queue_item BEFORE INSERT ON technician_turn_events
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('pos_queue_items', 'queue_item_id');
