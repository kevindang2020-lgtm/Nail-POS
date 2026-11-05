-- 518_scheduler_runs.sql — Phase 2 of BUILD_PLAN_2026-10-06 (Constitution 4 §25 / §167): one owner per scheduled tick.
--
-- Thirty-one background schedulers run an in-process setInterval in every process that is allowed to run their job
-- class. With PROCESS_ROLE=all and two API replicas — or the API plus a worker — every tick ran once PER PROCESS:
-- reminders, billing cycles, exports, sweeps twice. (Two schedulers used a transaction-scoped advisory lock, which stops
-- two ticks OVERLAPPING but not two ticks a few seconds apart, and holds a connection idle-in-transaction for the
-- whole tick.)
--
-- One row per scheduler. A process may start a tick only when nobody holds the lease (or it lapsed — the holder died)
-- AND the last tick started at least the scheduler's minimum gap ago. The holder renews the lease while it works and
-- clears it when done. No connection is held for the duration of the tick.
CREATE TABLE IF NOT EXISTS scheduler_runs (
  name              text PRIMARY KEY,
  lease_owner       text,
  lease_until       timestamptz,
  last_started_at   timestamptz,
  last_finished_at  timestamptz,
  last_outcome      text CHECK (last_outcome IS NULL OR last_outcome IN ('ok', 'failed')),
  last_error        text,
  runs              bigint NOT NULL DEFAULT 0,
  failures          bigint NOT NULL DEFAULT 0,
  skipped           bigint NOT NULL DEFAULT 0,
  every_ms          bigint CHECK (every_ms IS NULL OR every_ms > 0),   -- the scheduler's declared interval (last claim)
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduler_runs_lease_pair CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);
COMMENT ON TABLE scheduler_runs IS 'Platform-global: one row per background scheduler — lease + last tick (migration 518).';
