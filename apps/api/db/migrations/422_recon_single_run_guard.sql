-- 422_recon_single_run_guard.sql — a SECOND, database-enforced guard against concurrent reconciliation runs.
--
-- WHY, when there is already an advisory lock: `pg_try_advisory_lock` is SESSION-scoped. It is correct, but it
-- depends on the session behaving — and in a deployed topology a session is not always what you think it is:
-- a transaction-pooling connection pooler (PgBouncer in transaction mode) can hand the next statement to a
-- DIFFERENT backend, and a lock taken on one backend is invisible to the next. That failure mode is silent: two
-- instances both believe they hold the lock and both start reconciling.
--
-- So the invariant is ALSO expressed where it cannot be bypassed: at most one RUNNING platform-wide run exists.
-- The insert of a second one fails, and the caller reports a skip instead of double-processing.
-- Scoped runs (one tenant / one customer) are deliberately NOT covered — a support engineer re-syncing one
-- customer must not be blocked by an unrelated nightly pass.
CREATE UNIQUE INDEX IF NOT EXISTS ux_recon_single_running_all
  ON customer_recon_runs ((true)) WHERE status = 'RUNNING' AND scope = 'all';
