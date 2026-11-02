// sync-reconciliation.ts — the Smooth Refresh spec's 20-second server reconciliation (§5, §34–§39, §83, §86, §87,
// §97–§99, §102, §103). Defense in depth ONLY: every business write is already immediate and every cache/projection is
// already invalidated from domain events (§36). This job repairs derived state that events cannot repair on their own.
//
// What it does each run (all bounded, all cheap, all idempotent):
//   1. Releases EXPIRED booking holds (§13/§35/§73) through the ONE existing sweep (BookingHoldService). The minute
//      sweeper that already existed is opt-in (BOOKING_HOLD_SWEEP_CRON_ENABLED) and no deploy configuration sets it —
//      so unless someone did by hand, an abandoned online/AI booking's hold stayed LIVE in the database's no-overlap
//      guard and kept blocking that technician's slot for new holds. This job runs by default wherever
//      'reconciliation' jobs run, so holds expire within ~20 s of their deadline.
//   1b. Closes booking phone verifications past their deadline (BUILD_PLAN Phase 4): status 'expired', their hold
//      released, a booking.phone_verification_expired fact on the outbox. Runs AFTER the locked pass — each row's
//      UPDATE is guarded by its status, so two workers can never both expire (or both announce) the same session.
//   2. Measures outbox lag (§100/§102): events still pending > 30 s mean realtime/projections are behind.
//   3. Counts ACTIVE operational scopes (§35/§98): branches with an appointment or queue change in the last 10 min —
//      the scopes that matter now; closed/idle branches are never scanned.
//
// It never scans every tenant, customer or appointment (§34). It runs in the reconciliation job class — the worker
// process in a split deploy, never an API request path (§86/§87) — and a PostgreSQL transaction-scoped advisory lock
// makes it single-flight across every worker (§38/§39/§103): a second copy that finds the lock held skips its turn.
// A run slower than its own interval is logged and counted so a backlog is visible (§102).
import { registry, log as rootLog, runTick } from '@aipowersalon/observability';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';
import { KyselyHoldRepository, KyselyVerificationStore } from '@aipowersalon/booking';
import { OutboxWriter } from '@aipowersalon/events';

const log = rootLog.withContext({ component: 'sync-reconciliation' });
export const RECONCILE_EVERY_MS = 20_000;               // spec §83 (the same number as SYNC_POLICY.serverReconciliationMs)
export const RECONCILE_JITTER_MS = 2_000;               // spec §38: workers started together do not stay in lock-step
export const HOLD_BATCH = 500;
export const OUTBOX_LAG_WARN_SEC = 30;
export const ACTIVE_WINDOW_MIN = 10;
export const ACTIVE_SCOPE_CAP = 500;                    // §99: bounded — a platform-wide burst cannot make one run unbounded
const LOCK_KEY = 'aipowersalon:sync.reconciliation';

export const reconcileDurationMs = registry.gauge('aipowersalon_sync_reconciliation_duration_ms', 'Duration of the last 20 s sync reconciliation run', []);
export const reconcileActiveBranches = registry.gauge('aipowersalon_sync_reconciliation_active_branches', 'Branches with operational changes in the last 10 minutes', []);
export const reconcileOutboxLagSec = registry.gauge('aipowersalon_sync_reconciliation_outbox_lag_seconds', 'Age of the oldest pending outbox event', []);
export const reconcileHoldsReleased = registry.counter('aipowersalon_sync_reconciliation_holds_released_total', 'Expired booking holds released by the reconciliation', []);
export const reconcileOutcomes = registry.counter('aipowersalon_sync_reconciliation_runs_total', 'Reconciliation runs by outcome', ['outcome']);

export interface ReconcileReport {
  outcome: 'ran' | 'skipped_locked' | 'skipped_inflight' | 'no_database';
  holdsReleased: number;
  verificationsExpired: number;
  outboxPendingOld: number;
  oldestPendingSec: number | null;
  activeBranches: number;
  durationMs: number;
  overran: boolean;
}

@Injectable()
export class SyncReconciliation implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  last: ReconcileReport | null = null;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('reconciliation')) return;   // Constitution 13 Phase 8: PROCESS_ROLE / WORKER_JOB_CLASSES
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    // Self-rescheduling timeout rather than setInterval: each run waits for the previous one, and the delay is
    // jittered (§38). Written inline so the scheduler coverage guard sees the runJob instrumentation.
    const arm = () => {
      const delay = RECONCILE_EVERY_MS + Math.round((Math.random() * 2 - 1) * RECONCILE_JITTER_MS);
      this.timer = setTimeout(() => { void runTick({ jobType: 'sync.reconciliation', jobClass: 'reconciliation', everyMs: RECONCILE_EVERY_MS }, () => this.runOnce()).catch(() => undefined).finally(arm); }, delay);
      this.timer.unref?.();
    };
    arm();
  }
  onModuleDestroy(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  /** One reconciliation pass. Public for tests and for an operator's manual run. */
  async runOnce(now: () => number = Date.now): Promise<ReconcileReport> {
    const t0 = now();
    const done = (r: Omit<ReconcileReport, 'durationMs' | 'overran'>): ReconcileReport => {
      const durationMs = now() - t0; const overran = durationMs > RECONCILE_EVERY_MS;
      const rep = { ...r, durationMs, overran };
      reconcileOutcomes.inc({ outcome: r.outcome });
      if (r.outcome === 'ran') {
        reconcileDurationMs.set(durationMs); reconcileActiveBranches.set(r.activeBranches);
        if (r.oldestPendingSec != null) reconcileOutboxLagSec.set(r.oldestPendingSec);
        if (r.holdsReleased) reconcileHoldsReleased.inc({}, r.holdsReleased);
        if (overran) log.warn('sync reconciliation took longer than its interval', { durationMs, intervalMs: RECONCILE_EVERY_MS });   // §102
        if (r.outboxPendingOld > 0) log.warn('outbox events pending longer than expected', { pending: r.outboxPendingOld, oldestPendingSec: r.oldestPendingSec });
        if (r.holdsReleased > 0) log.info('released expired booking holds', { released: r.holdsReleased });
      }
      this.last = rep;
      return rep;
    };
    const empty = { holdsReleased: 0, verificationsExpired: 0, outboxPendingOld: 0, oldestPendingSec: null, activeBranches: 0 };
    if (!this.db) return done({ outcome: 'no_database', ...empty });
    if (this.running) return done({ outcome: 'skipped_inflight', ...empty });   // this process: never overlaps itself
    this.running = true;
    try {
      const rep = await this.db.transaction().execute(async (trx: any) => {
        // §103: one run at a time ACROSS workers. Transaction-scoped, so a crashed worker can never leave it held,
        // and it is safe behind a transaction-pooling proxy (the lock lives and dies with this transaction).
        const got = (await sql<{ ok: boolean }>`select pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) as ok`.execute(trx)).rows[0]?.ok;
        if (!got) return done({ outcome: 'skipped_locked', ...empty });

        const holdsReleased = await new KyselyHoldRepository(trx).sweepExpired(now(), HOLD_BATCH);

        const lag = (await sql<{ n: number; oldest: number | null }>`
          select count(*) filter (where created_at < now() - make_interval(secs => ${OUTBOX_LAG_WARN_SEC}))::int as n,
                 extract(epoch from (now() - min(created_at)))::int as oldest
          from outbox_events where publish_status = 'pending'`.execute(trx)).rows[0];

        const active = (await sql<{ n: number }>`
          select count(*)::int as n from (
            select tenant_id, branch_id from pos_tech_appointments where updated_at > now() - make_interval(mins => ${ACTIVE_WINDOW_MIN})
            union
            select tenant_id, branch_id from pos_queue_items where updated_at > now() - make_interval(mins => ${ACTIVE_WINDOW_MIN})
            limit ${ACTIVE_SCOPE_CAP}
          ) s`.execute(trx)).rows[0];

        return done({ outcome: 'ran', holdsReleased, verificationsExpired: 0, outboxPendingOld: Number(lag?.n ?? 0),
                      oldestPendingSec: lag?.oldest == null ? null : Number(lag.oldest), activeBranches: Number(active?.n ?? 0) });
      });
      if (rep.outcome === 'ran') {
        rep.verificationsExpired = await new KyselyVerificationStore(this.db, new OutboxWriter()).expireStale(HOLD_BATCH).catch(() => 0);
        if (rep.verificationsExpired > 0) log.info('expired booking phone verifications', { expired: rep.verificationsExpired });
      }
      return rep;
    } finally {
      this.running = false;
    }
  }
}
