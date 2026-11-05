// scheduler-lock.ts — single-owner guard for in-process schedulers (Phase 5 multi-region readiness / Part 18).
//
// The env-gated schedulers (billing export, customer import, tenant warnings, overview snapshot, etc.) each run an
// in-process setInterval. On ONE API instance that's fine. The moment two or more instances run with the same
// scheduler flag enabled, every instance's timer fires independently and the same scheduled work would run N times —
// duplicate reminders, duplicate exports, duplicate billing. This guard makes a tick single-owner across instances:
// it wraps the tick in a short transaction and takes a TRANSACTION-SCOPED advisory try-lock keyed by the scheduler's
// name. Only the instance that wins the lock runs the body; the others skip this tick and try again next interval.
//
// Why transaction-scoped (pg_try_advisory_xact_lock) and not session-level: the app runs behind PgBouncer transaction
// pooling, where session-level advisory locks are unsafe (the connection is handed to another client after commit).
// The xact-scoped lock auto-releases at commit/rollback, so it's pool-safe and can never leak. This mirrors the
// existing pg_advisory_xact_lock usage in booking/checkout/wallet.
//
// Behavior is opt-in and fail-open: if no db handle is provided (dev/tests/single-node), the tick just runs as before.
// A lock-acquisition error never blocks the tick from being skipped safely — correctness (no double-run) is preserved
// by only running when the lock is definitively held.

import { sql, type Kysely } from 'kysely';

/** Minimal db surface: anything that can run a Kysely transaction. */
export type LockableDb = Pick<Kysely<any>, 'transaction'>;

/**
 * Run `body` at most once across all instances for this `schedulerName` tick. Acquires a transaction-scoped advisory
 * try-lock; if another instance holds it, this call resolves to `{ ran: false }` without running the body. With no db
 * (single-node/dev/tests) the body runs unguarded.
 */
export async function runAsSingleOwner<T>(
  db: LockableDb | undefined,
  schedulerName: string,
  body: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  if (!db) {
    // No coordination available (single node / dev / test): run as before.
    return { ran: true, result: await body() };
  }
  return db.transaction().execute(async (trx) => {
    // pg_try_advisory_xact_lock returns immediately: true if acquired, false if another tx (another instance) holds it.
    const row = await sql<{ got: boolean }>`select pg_try_advisory_xact_lock(hashtextextended(${'scheduler:' + schedulerName}, 0)) as got`.execute(trx);
    const got = row.rows[0]?.got === true;
    if (!got) return { ran: false } as const;      // another instance owns this tick — skip cleanly
    const result = await body();                    // we own the tick; run it, lock auto-releases at commit
    return { ran: true, result } as const;
  });
}
