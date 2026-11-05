-- 187_integration_reliability.sql — the reliability layer that guards every outbound provider call.
--   • integration_circuit_breakers — one breaker per connection: closed → open (after N consecutive failures) →
--     half_open (after a cooldown, allows one probe) → closed (probe succeeds) or back to open (probe fails). An open
--     breaker fast-fails calls without hitting the provider and drives the connection to 'degraded'.
--   • integration_rate_limits — fixed-window counters per scope (provider / tenant / connection). A call is rejected
--     with a Retry-After when any applicable scope is over its window limit; a provider Retry-After can pin a scope.

CREATE TABLE IF NOT EXISTS integration_circuit_breakers (
  connection_id        UUID PRIMARY KEY,
  state                TEXT NOT NULL DEFAULT 'closed',   -- closed|open|half_open
  failure_count        INT NOT NULL DEFAULT 0,
  success_count        INT NOT NULL DEFAULT 0,
  failure_threshold    INT NOT NULL DEFAULT 5,
  cooldown_seconds     INT NOT NULL DEFAULT 60,
  opened_at            TIMESTAMPTZ,
  half_opened_at       TIMESTAMPTZ,
  last_failure_at      TIMESTAMPTZ,
  last_state_change_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_rate_limits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type        TEXT NOT NULL,                        -- provider|tenant|connection
  scope_key         TEXT NOT NULL,
  window_seconds    INT NOT NULL DEFAULT 60,
  limit_per_window  INT NOT NULL DEFAULT 1000,
  window_start      TIMESTAMPTZ NOT NULL DEFAULT now(),
  count             INT NOT NULL DEFAULT 0,
  retry_after_until TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_int_rate_limit_scope ON integration_rate_limits (scope_type, scope_key);
