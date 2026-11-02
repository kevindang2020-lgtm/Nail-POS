-- 433: Constitution 8 — transactional outbox, processed-event tracking, dead letters (§17, §23, §48, §211–214).
-- Inspected first (§211): no outbox, processed_events or dead-letter table existed. Domain-specific idempotency
-- ledgers (reception_copilot_action_ledger, ai_checkout_upsell_idempotency, voice_gateway_idempotency) stay —
-- they guard BUSINESS effects (§25); processed_events guards DELIVERY duplicates (§23). Both are needed.

CREATE TABLE IF NOT EXISTS outbox_events (
  id                UUID PRIMARY KEY,                       -- = envelope.eventId (§10); the same id travels end to end
  event_type        TEXT NOT NULL,
  event_version     INTEGER NOT NULL DEFAULT 1,
  tenant_id         UUID,                                   -- NULL only for platform events (§168)
  branch_id         UUID,
  aggregate_type    TEXT NOT NULL,
  aggregate_id      TEXT NOT NULL,
  aggregate_version INTEGER,                                -- §40, only where ordering matters
  actor_id          TEXT,
  actor_type        TEXT,
  request_id        TEXT,
  correlation_id    TEXT NOT NULL,
  causation_id      TEXT,
  payload_json      JSONB NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL,
  publish_status    TEXT NOT NULL DEFAULT 'pending' CHECK (publish_status IN ('pending','claimed','published','failed')),
  published_at      TIMESTAMPTZ,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code   TEXT,                                   -- safe code only, never a raw error string (§197)
  claimed_by        TEXT,                                   -- publisher instance id, for §21 claiming
  claimed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- §212 indexes. The first is the publisher's hot path: "what is due, oldest first".
CREATE INDEX IF NOT EXISTS idx_outbox_due       ON outbox_events (publish_status, next_attempt_at) WHERE publish_status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS idx_outbox_tenant    ON outbox_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_type      ON outbox_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_corr      ON outbox_events (correlation_id);
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON outbox_events (aggregate_type, aggregate_id, occurred_at);

-- §23 delivery idempotency: (consumer, event) is processed at most once. Unique index IS the guarantee.
CREATE TABLE IF NOT EXISTS processed_events (
  consumer_name  TEXT NOT NULL,
  event_id       UUID NOT NULL,
  tenant_id      UUID,
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)                    -- §213
);
CREATE INDEX IF NOT EXISTS idx_processed_events_time ON processed_events (processed_at);   -- §213 retention cleanup

-- §48–49 per-consumer dead letters: one consumer failing never blocks another.
CREATE TABLE IF NOT EXISTS event_dead_letters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,
  consumer_name   TEXT NOT NULL,
  tenant_id       UUID,
  event_type      TEXT NOT NULL,
  correlation_id  TEXT,
  envelope_json   JSONB NOT NULL,                          -- the event as delivered, for safe replay (§45)
  attempts        INTEGER NOT NULL DEFAULT 0,
  error_class     TEXT NOT NULL CHECK (error_class IN ('TRANSIENT','PERMANENT','SECURITY','DATA_INTEGRITY')),  -- §51
  last_error_code TEXT,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','retrying','resolved','discarded')),
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,
  UNIQUE (consumer_name, event_id)                         -- one dead-letter row per (consumer, event); retries update it
);
-- §214 operational indexes
CREATE INDEX IF NOT EXISTS idx_dlq_consumer ON event_dead_letters (consumer_name, status);
CREATE INDEX IF NOT EXISTS idx_dlq_tenant   ON event_dead_letters (tenant_id, last_failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_status   ON event_dead_letters (status, last_failed_at DESC);
