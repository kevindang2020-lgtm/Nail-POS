-- 579_technician_workforce_state.sql — ONE authoritative operational state per technician (Technician Profile
-- package, their 462; mandate §10–§11, §147). `technician_statuses` (012) has no unique index: some writers append a
-- row per change, others update, and the readers pick an unordered "latest". Nothing derives the queue flag from the
-- clock, the break or the employment status, so a suspended or clocked-out technician could still be assignable.
--
-- This migration:
--   1. creates `technician_workforce_state` — exactly one row per technician (UNIQUE technician_id), holding the
--      six separated statuses the Technician Profile page shows, guarded by `version` for compare-and-set updates;
--   2. backfills it from `technicians` (employment) + the OPEN punch in `technician_shifts` (clock/shift) + the
--      latest `technician_statuses` row (break / serving);
--   3. de-duplicates `technician_statuses` down to the latest row per technician. The table stays as a COMPATIBILITY
--      ROW written by the workforce-status service (update-then-insert, tenant-scoped — NO unique index is added here,
--      because modules/queue/src/tech still appends rows until it is switched to the workforce-status service) until
--      its remaining readers (overview, dashboard, owner, pos-team, checkout, service-done, check-in, queue,
--      tech-queue, serving, tech-appointments, tech) are switched to `technician_workforce_state`.
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS technician_workforce_state (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  technician_id      UUID NOT NULL,
  employment_status  TEXT NOT NULL DEFAULT 'active',        -- mirror of technicians lifecycle (active|inactive|suspended|archived)
  clock_status       TEXT NOT NULL DEFAULT 'CLOCKED_OUT',   -- CLOCKED_OUT | CLOCKED_IN | ON_BREAK
  shift_status       TEXT NOT NULL DEFAULT 'OFF_SHIFT',     -- OFF_SHIFT | ON_SHIFT
  queue_status       TEXT NOT NULL DEFAULT 'OFF_SHIFT',     -- AVAILABLE | ASSIGNED | SERVING | BREAK | UNAVAILABLE | OFF_SHIFT (DERIVED)
  service_state      TEXT NOT NULL DEFAULT 'IDLE',          -- IDLE | SERVING | PAUSED
  manual_unavailable BOOLEAN NOT NULL DEFAULT false,        -- manager "not taking customers" flag → queue UNAVAILABLE
  current_ticket_id  UUID,
  open_shift_id      UUID,                                   -- technician_shifts.id of the open punch (NULL when clocked out)
  break_started_at   TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  version            INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT technician_workforce_state_technician_unique UNIQUE (technician_id),
  CONSTRAINT technician_workforce_state_clock_check   CHECK (clock_status IN ('CLOCKED_OUT','CLOCKED_IN','ON_BREAK')),
  CONSTRAINT technician_workforce_state_shift_check   CHECK (shift_status IN ('OFF_SHIFT','ON_SHIFT')),
  CONSTRAINT technician_workforce_state_queue_check   CHECK (queue_status IN ('AVAILABLE','ASSIGNED','SERVING','BREAK','UNAVAILABLE','OFF_SHIFT')),
  CONSTRAINT technician_workforce_state_service_check CHECK (service_state IN ('IDLE','SERVING','PAUSED'))
);
CREATE INDEX IF NOT EXISTS idx_technician_workforce_state_tenant_branch_queue
  ON technician_workforce_state (tenant_id, branch_id, queue_status);

-- 2. Backfill: one row per technician. Facts: employment from technicians; the OPEN punch (end_time IS NULL, status
--    active) → CLOCKED_IN/ON_SHIFT; the latest technician_statuses row → on_break / in_service refinement.
--    queue_status is the pure derivation (same precedence as deriveWorkforceState in workforce-status-core.ts).
INSERT INTO technician_workforce_state (tenant_id, branch_id, technician_id, employment_status, clock_status, shift_status, queue_status, service_state, open_shift_id, break_started_at)
SELECT
  t.id_tenant, t.id_branch, t.id_tech, t.employment,
  CASE WHEN t.open_shift IS NULL THEN 'CLOCKED_OUT' WHEN t.legacy IN ('on_break','break','lunch') THEN 'ON_BREAK' ELSE 'CLOCKED_IN' END,
  CASE WHEN t.open_shift IS NULL THEN 'OFF_SHIFT' ELSE 'ON_SHIFT' END,
  CASE
    WHEN t.employment <> 'active' THEN 'UNAVAILABLE'
    WHEN t.open_shift IS NULL THEN 'OFF_SHIFT'
    WHEN t.legacy IN ('in_service','busy','serving') THEN 'SERVING'
    WHEN t.legacy IN ('on_break','break','lunch') THEN 'BREAK'
    ELSE 'AVAILABLE'
  END,
  CASE WHEN t.open_shift IS NOT NULL AND t.legacy IN ('in_service','busy','serving') THEN 'SERVING' ELSE 'IDLE' END,
  t.open_shift,
  CASE WHEN t.open_shift IS NOT NULL AND t.legacy IN ('on_break','break','lunch') THEN t.legacy_at ELSE NULL END
FROM (
  SELECT tech.tenant_id AS id_tenant, tech.branch_id AS id_branch, tech.id AS id_tech,
         CASE WHEN tech.status IN ('active','inactive','suspended','archived') THEN tech.status
              WHEN tech.archived_at IS NOT NULL THEN 'archived'
              WHEN tech.is_active THEN 'active' ELSE 'inactive' END AS employment,
         (SELECT s.id FROM technician_shifts s WHERE s.technician_id = tech.id AND s.end_time IS NULL AND s.status = 'active' ORDER BY s.start_time DESC NULLS LAST LIMIT 1) AS open_shift,
         (SELECT st.status FROM technician_statuses st WHERE st.technician_id = tech.id ORDER BY st.changed_at DESC LIMIT 1) AS legacy,
         (SELECT st.changed_at FROM technician_statuses st WHERE st.technician_id = tech.id ORDER BY st.changed_at DESC LIMIT 1) AS legacy_at
  FROM technicians tech
) t
ON CONFLICT (technician_id) DO NOTHING;

-- 3. technician_statuses → one row per technician (keep the latest). Readers order by changed_at DESC either way.
DELETE FROM technician_statuses s
USING technician_statuses newer
WHERE newer.technician_id = s.technician_id
  AND (newer.changed_at > s.changed_at OR (newer.changed_at = s.changed_at AND newer.id > s.id));
