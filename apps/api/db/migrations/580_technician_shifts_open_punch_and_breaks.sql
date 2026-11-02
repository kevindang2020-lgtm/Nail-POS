-- 580_technician_shifts_open_punch_and_breaks.sql — the time clock (Technician Profile package, their 463; mandate
-- §23, §106, §147, §165).
--
-- (a) `uq_technician_shifts_day` (381) made ONE row per technician per day the rule, so a split shift (clock out for
--     lunch, clock back in) raised a unique violation → 500. The real invariant is "one OPEN punch per technician":
--     a partial unique index on (tenant_id, technician_id) WHERE the punch is still open. Two concurrent clock-ins
--     then produce exactly one row — the loser gets a unique violation that the service turns into "return the
--     existing open shift" (idempotent), never a 500.
-- (b) `technician_breaks` — breaks become part of the clock. One row per break (start/end instants, who started
--     and ended it), with the same "one OPEN break per technician" partial unique. The workforce-state row is
--     updated in the same service call, so a technician on break disappears from AVAILABLE immediately.
-- Additive + idempotent. The old day-unique is dropped (it is the bug); the index on (tenant, branch, date) from
-- 012 remains for the day reads.

DROP INDEX IF EXISTS uq_technician_shifts_day;
CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_shifts_open_punch
  ON technician_shifts (tenant_id, technician_id)
  WHERE end_time IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_technician_shifts_tenant_tech_date
  ON technician_shifts (tenant_id, technician_id, shift_date);

CREATE TABLE IF NOT EXISTS technician_breaks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,
  technician_id  UUID NOT NULL,
  shift_id       UUID,                               -- the open punch this break belongs to (NULL if none)
  kind           TEXT NOT NULL DEFAULT 'break',      -- break | lunch
  reason         TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ,
  started_by     TEXT,                               -- user id, 'kiosk:<device>' or 'tech:<technician>'
  ended_by       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_breaks_open
  ON technician_breaks (tenant_id, technician_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_technician_breaks_tenant_tech_started
  ON technician_breaks (tenant_id, technician_id, started_at);
