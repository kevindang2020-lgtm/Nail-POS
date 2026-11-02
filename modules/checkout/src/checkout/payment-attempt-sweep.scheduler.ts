// payment-attempt-sweep.scheduler.ts — BUILD_PLAN Phase 11 (Constitution 4 §116): every five minutes, resolve card
// attempts stranded in 'processing' from the processor's own answer (payment-attempt-sweep.ts has the rules; it never
// charges, voids or refunds). A 'critical' job: a stranded attempt is a half-paid ticket the cashier cannot retry.
//
// ON by default wherever there is a database (it only ever asks the processor and writes what it said);
// PAYMENT_ATTEMPT_SWEEP=off stops it. One owner per tick across workers (runAsSingleOwner), and every write is
// conditional anyway (see the store), so two sweepers can never both resolve an attempt.
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { DATABASE, runAsSingleOwner, type AppDatabase } from '@aipowersalon/database';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WalletTopupService, type TopUpSweepReport } from '@aipowersalon/payments';
import { SkipLineCheckoutService } from '../skip-line-checkout/skip-line-checkout.service';
import { CheckoutService } from './checkout.service';
import { PaymentAttemptSweep, strandedMinutes, type CardReconcileStatus, type SweepReport } from './payment-attempt-sweep';
import { KyselyPaymentAttemptSweepStore } from './payment-attempt-sweep.kysely';

export const SWEEP_EVERY_MS = 5 * 60_000;
/** §68 (Oct 27 2026): the tick, every 5 minutes. PAYMENT_ATTEMPT_SWEEP_EVERY_MS shortens it OUTSIDE production only (the
 *  pilot day proves the recovery flows end to end without waiting five minutes); never below 1 s, ignored in production. */
export function sweepEveryMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PAYMENT_ATTEMPT_SWEEP_EVERY_MS);
  if (env.NODE_ENV === 'production' || !Number.isFinite(n) || n <= 0) return SWEEP_EVERY_MS;
  return Math.max(1000, Math.floor(n));
}

export function paymentAttemptSweepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.PAYMENT_ATTEMPT_SWEEP ?? '').trim().toLowerCase() !== 'off';
}

@Injectable()
export class PaymentAttemptSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PaymentAttemptSweep');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly sweep: PaymentAttemptSweep | null;

  constructor(private readonly checkout: CheckoutService, @Optional() @Inject(DATABASE) private readonly db?: AppDatabase, @Optional() private readonly modules?: ModuleRef) {
    this.sweep = db ? new PaymentAttemptSweep(new KyselyPaymentAttemptSweepStore(db as any), {
      inquire: (t, b, order) => this.checkout.inquireProcessor(t, b, order),
      reconcileCard: async (t, b, ticket): Promise<CardReconcileStatus> => (await this.checkout.reconcileStrandedCard(t, b, ticket)).status,
      settleRefund: (t, b, refundId, outcome, note) => this.checkout.settleUnknownRefundFromSweep(t, b, refundId, outcome, note),
    }, { log: (m) => this.log.warn(m) }) : null;
  }

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs
    if (!this.sweep || !paymentAttemptSweepEnabled()) return;
    const every = sweepEveryMs();
    this.timer = setInterval(() => { void runTick({ jobType: 'payments.stranded_attempts', jobClass: 'critical', everyMs: every }, () => this.tick()).catch(() => undefined); }, every);
    this.timer.unref?.();
    this.log.log(`Stranded payment-attempt sweep armed (every ${Math.round(every / 1000)} s; stranded after ${strandedMinutes()} min).`);
  }

  /** A service from another module (wallet top-ups live in payments, app charges in skip-line), found at tick time; absent → that population is skipped. */
  private find<T>(token: new (...a: any[]) => T): T | null {
    try { return this.modules?.get(token, { strict: false }) ?? null; }
    catch (e: any) { this.log.debug(`${token.name} is not loaded in this process (${String(e?.message ?? e).slice(0, 120)}) — its stranded population is skipped`); return null; }
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Public for ops / tests. Non-overlapping within the process. */
  async tick(): Promise<SweepReport | null> {
    if (!this.sweep || this.running) return null;
    this.running = true;
    try {
      // Single owner across workers (packages/database scheduler-lock); the store's conditional writes are the second line.
      // B-79 / B-80 (Oct 23 2026): the same owner, the same tick also settles wallet top-ups and Skip-the-Line app charges
      // whose processor answer was lost — one sweep, one schedule, one owner (no second scheduler).
      const owned = await runAsSingleOwner(this.db as any, 'payments.stranded_attempts', async () => {
        const base = await this.sweep!.run();
        const topUps = await this.find(WalletTopupService)?.sweepStranded().catch((e: any) => { this.log.warn(`top-up sweep failed: ${e?.message ?? e}`); return null; }) ?? null;
        const appCharges = await this.find(SkipLineCheckoutService)?.sweepStranded().catch((e: any) => { this.log.warn(`app-charge sweep failed: ${e?.message ?? e}`); return null; }) ?? null;
        return { ...base, topUps, appCharges } as SweepReport & { topUps: TopUpSweepReport | null; appCharges: Awaited<ReturnType<SkipLineCheckoutService['sweepStranded']>> | null };
      });
      if (!owned.ran) return null;
      const r = owned.result;
      const t = r.topUps, a = r.appCharges;
      if ((t && (t.approved || t.declined || t.released || t.review || t.errors)) || (a && (a.approved || a.declined || a.released || a.review || a.errors))) this.log.log(`stranded top-ups ${JSON.stringify(t)} · app charges ${JSON.stringify(a)}`);
      if (r.cardsResolved || r.cardsUnverified || r.splitsSettled || r.splitsReleased || r.splitsNeedReview || r.refundsSettled || r.refundsReleased || r.refundsNeedReview || r.errors) this.log.log(`stranded attempts: ${JSON.stringify(r)}`);
      return r;
    } catch (e: any) {
      this.log.warn(`sweep failed: ${e?.message ?? e}`);
      return null;
    } finally { this.running = false; }
  }
}
