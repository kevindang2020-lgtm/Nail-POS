// loyalty-reconcile.scheduler.ts — the daily `loyalty.reconcile` job (BUILD_PLAN Phase 10): points_balance must equal
// sum(delta) of the customer's loyalty ledger; a profile that drifted is repaired from the ledger and its salon alerted
// (reconcileLoyaltyBalances). ON by default — a check that only runs when someone remembers to enable it is not a
// check — except under tests; LOYALTY_RECONCILE_CRON_ENABLED=0 turns it off. Runs once at boot (after 60 s), then daily.
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { reconcileLoyaltyBalances, type LoyaltyReconcileResult } from './loyalty-ledger.service';

export const LOYALTY_RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000;

export function loyaltyReconcileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.LOYALTY_RECONCILE_CRON_ENABLED ?? '').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  return env.NODE_ENV !== 'test' && !env.VITEST;
}

@Injectable()
export class LoyaltyReconcileScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('LoyaltyReconcile');
  private timer: ReturnType<typeof setInterval> | null = null;
  private boot: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  constructor(private readonly db: Kysely<any> | null) {}

  onModuleInit(): void {
    if (!this.db || !runsBackgroundJob('reconciliation')) return;   // Constitution 13 Phase 8: this process may not run 'reconciliation' jobs
    if (!loyaltyReconcileEnabled()) return;
    this.boot = setTimeout(() => { void runTick({ jobType: 'loyalty.reconcile', jobClass: 'reconciliation', everyMs: LOYALTY_RECONCILE_EVERY_MS }, () => this.tick()).catch(() => undefined); }, 60_000); this.boot.unref?.();
    this.timer = setInterval(() => { void runTick({ jobType: 'loyalty.reconcile', jobClass: 'reconciliation', everyMs: LOYALTY_RECONCILE_EVERY_MS }, () => this.tick()).catch(() => undefined); }, LOYALTY_RECONCILE_EVERY_MS); this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); if (this.boot) clearTimeout(this.boot); this.timer = null; this.boot = null; }

  /** One pass; public for ops and tests. Non-overlapping. */
  async tick(): Promise<LoyaltyReconcileResult> {
    if (!this.db || this.running) return { checked: 0, repaired: 0, alerts: 0 };
    this.running = true;
    try {
      const r = await reconcileLoyaltyBalances(this.db);
      if (r.repaired > 0) this.log.warn(`loyalty.reconcile repaired ${r.repaired} profile balance(s) from the ledger`);
      return r;
    } finally { this.running = false; }
  }
}
