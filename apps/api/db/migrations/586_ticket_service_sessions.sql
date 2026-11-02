-- 586_ticket_service_sessions.sql — durable Serving state (merge of the other chat's 468, Oct 12 2026; workforce audit P1 #19).
--
-- Serving kept status / delay / helper / notes / the send-to-Service-Done idempotency key in an in-process Map on the API
-- node (KyselyServingRepository's Overlay): a restart or a second replica forgot every paused timer and every delay, and
-- "one active service per technician" could not be enforced at all. From here on a Serving session is a ROW:
--
--   ticket_service_sessions — one row per (ticket, technician) service session; STARTED → PAUSED ⇄ STARTED → COMPLETED.
--   A technician may hold ONE live (STARTED/PAUSED) primary session at a time — partial unique index — a helper row
--   (is_helper = true) is a team session and sits outside that rule.
--   idempotency_key is the Service Done completion key: the three Done entry points (tech app complete, Serving
--   mark-done, Serving send-to-Service-Done) converge on it, so a retry is a no-op rather than a second completion.
--
-- Pause clock (156: serving_paused_at / accumulated_paused_ms), notes (025), helper (025) and the Service Done lock (168)
-- were already columns on tickets; delay status / reason were not — added here. EXPAND-ONLY: a new table + two nullable /
-- defaulted columns; the delay CHECK is added NOT VALID and validated separately (a scan without the write lock).
-- Writers: modules/queue serving.kysely.repository.ts + service-done/service-done-transition.ts (the ONE Service Done).
CREATE TABLE IF NOT EXISTS ticket_service_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  branch_id             UUID,
  ticket_id             UUID NOT NULL,
  technician_id         UUID NOT NULL,
  is_helper             BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL DEFAULT 'STARTED',
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_at             TIMESTAMPTZ,
  accumulated_paused_ms BIGINT NOT NULL DEFAULT 0,
  completed_at          TIMESTAMPTZ,
  completed_by_user_id  UUID,
  completion_source     TEXT,                 -- tech_app | serving_mark_done | serving_send | pos | helper_unassigned
  idempotency_key       TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ticket_service_session_status CHECK (status IN ('STARTED', 'PAUSED', 'COMPLETED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_service_sessions_idem
  ON ticket_service_sessions (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- ONE active (primary) session per technician.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_service_sessions_one_active_per_tech
  ON ticket_service_sessions (tenant_id, technician_id) WHERE status IN ('STARTED', 'PAUSED') AND is_helper = false;
-- ONE live session per (ticket, technician) — a second start of the same ticket resumes, never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_service_sessions_live_ticket_tech
  ON ticket_service_sessions (tenant_id, ticket_id, technician_id) WHERE status IN ('STARTED', 'PAUSED');
CREATE INDEX IF NOT EXISTS idx_ticket_service_sessions_ticket ON ticket_service_sessions (tenant_id, ticket_id);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS serving_delay_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS serving_delay_reason TEXT;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS chk_tickets_serving_delay_status;
ALTER TABLE tickets ADD CONSTRAINT chk_tickets_serving_delay_status
  CHECK (serving_delay_status IN ('none', 'warning', 'late', 'critical')) NOT VALID;
ALTER TABLE tickets VALIDATE CONSTRAINT chk_tickets_serving_delay_status;
