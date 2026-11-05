// scheduler-runs.ts — the lease every background scheduler takes before a tick (migration 518; BUILD_PLAN Phase 2).
//
// A process may run a tick of scheduler `name` only when:
//   • nobody holds the lease, or the lease lapsed (its holder died mid-tick), AND
//   • the previous tick STARTED at least `minGapMs` ago (by default 80% of the scheduler's interval).
// The second rule is what makes it one tick per interval across the fleet: without it, process A runs at 10:00:00,
// releases, and process B — whose timer is on another phase — runs again at 10:00:07.
//
// The claim is ONE statement (INSERT … ON CONFLICT DO UPDATE … WHERE …), so two processes racing for the same tick
// cannot both win. The holder renews the lease while it works (long ticks) and clears it at the end. No transaction or
// connection is held for the duration of the tick — unlike the transaction-scoped advisory lock this replaces, which
// sat idle-in-transaction for the whole tick (and is cut by idle_in_transaction_session_timeout).
import { sql, type Kysely } from 'kysely';

export interface TickOutcome { ran: boolean }
export type TickCoordinator = (name: string, everyMs: number, body: () => Promise<unknown>) => Promise<TickOutcome>;

export interface LeaseOptions {
  /** The lease is valid this long without renewal (renewed every third of it). Default 5 minutes. */
  leaseMs?: number;
  /** Fraction of the interval that must pass between tick STARTS (0.8 tolerates timer jitter). */
  minGapFraction?: number;
  /** Logs a failure to talk to the database (the tick is then skipped — never run unguarded). */
  log?: (msg: string) => void;
}

const ms = (n: number) => `${Math.max(0, Math.floor(n))} milliseconds`;

/** Try to claim the tick. Returns true when this process now holds the lease. */
export async function claimTick(db: Kysely<any>, name: string, owner: string, everyMs: number, opts: LeaseOptions = {}): Promise<boolean> {
  const leaseMs = opts.leaseMs ?? 5 * 60_000;
  const minGap = Math.floor(Math.max(0, everyMs) * (opts.minGapFraction ?? 0.8));
  const r = await sql<{ lease_owner: string }>`
    INSERT INTO scheduler_runs (name, lease_owner, lease_until, last_started_at, runs, every_ms, updated_at)
    VALUES (${name}, ${owner}, now() + ${ms(leaseMs)}::interval, now(), 1, ${Math.max(1, Math.floor(everyMs))}, now())
    ON CONFLICT (name) DO UPDATE SET
      lease_owner = excluded.lease_owner, lease_until = excluded.lease_until,
      last_started_at = now(), runs = scheduler_runs.runs + 1, every_ms = excluded.every_ms, updated_at = now()
    WHERE (scheduler_runs.lease_until IS NULL OR scheduler_runs.lease_until < now())
      AND (scheduler_runs.last_started_at IS NULL OR scheduler_runs.last_started_at <= now() - ${ms(minGap)}::interval)
    RETURNING lease_owner`.execute(db);
  return r.rows.length === 1 && r.rows[0].lease_owner === owner;
}

export async function renewTick(db: Kysely<any>, name: string, owner: string, leaseMs = 5 * 60_000): Promise<boolean> {
  const r = await sql`UPDATE scheduler_runs SET lease_until = now() + ${ms(leaseMs)}::interval, updated_at = now()
                      WHERE name = ${name} AND lease_owner = ${owner} RETURNING name`.execute(db);
  return r.rows.length === 1;
}

export async function finishTick(db: Kysely<any>, name: string, owner: string, ok: boolean, error?: string): Promise<void> {
  await sql`UPDATE scheduler_runs SET lease_owner = NULL, lease_until = NULL, last_finished_at = now(),
              last_outcome = ${ok ? 'ok' : 'failed'}, last_error = ${ok ? null : String(error ?? '').slice(0, 500)},
              failures = failures + ${ok ? 0 : 1}, updated_at = now()
            WHERE name = ${name} AND lease_owner = ${owner}`.execute(db);
}

async function noteSkip(db: Kysely<any>, name: string): Promise<void> {
  await sql`UPDATE scheduler_runs SET skipped = skipped + 1 WHERE name = ${name}`.execute(db).catch(() => undefined);
}

/** The coordinator the API and the worker install at start-up (observability's setTickCoordinator). */
export function leaseTickCoordinator(db: Kysely<any>, owner: string, opts: LeaseOptions = {}): TickCoordinator {
  const leaseMs = opts.leaseMs ?? 5 * 60_000;
  const log = opts.log ?? ((m: string) => console.error(m));
  return async (name, everyMs, body) => {
    let mine = false;
    try { mine = await claimTick(db, name, owner, everyMs, opts); }
    catch (e: any) { log(`[scheduler] ${name}: could not reach the lease table — tick skipped (${String(e?.message ?? e).slice(0, 160)})`); return { ran: false }; }
    if (!mine) { await noteSkip(db, name); return { ran: false }; }
    const renew = setInterval(() => { void renewTick(db, name, owner, leaseMs).catch(() => undefined); }, Math.max(50, Math.floor(leaseMs / 3)));
    if (typeof (renew as any).unref === 'function') (renew as any).unref();
    try {
      await body();
      await finishTick(db, name, owner, true).catch(() => undefined);
      return { ran: true };
    } catch (e: any) {
      await finishTick(db, name, owner, false, e?.message ?? String(e)).catch(() => undefined);
      throw e;
    } finally {
      clearInterval(renew);
    }
  };
}
