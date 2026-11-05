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
import { CheckoutService } from './checkout.service';
import { PaymentAttemptSweep, strandedMinutes, type CardReconcileStatus, type SweepReport } from './payment-attempt-sweep';
import { KyselyPaymentAttemptSweepStore } from './payment-attempt-sweep.kysely';

export const SWEEP_EVERY_MS = 5 * 60_000;

export function paymentAttemptSweepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.PAYMENT_ATTEMPT_SWEEP ?? '').trim().toLowerCase() !== 'off';
}

@Injectable()
export class PaymentAttemptSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PaymentAttemptSweep');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly sweep: PaymentAttemptSweep | null;

  constructor(private readonly checkout: CheckoutService, @Optional() @Inject(DATABASE) private readonly db?: AppDatabase) {
    this.sweep = db ? new PaymentAttemptSweep(new KyselyPaymentAttemptSweepStore(db as any), {
      inquire: (t, b, order) => this.checkout.inquireProcessor(t, b, order),
      reconcileCard: async (t, b, ticket): Promise<CardReconcileStatus> => (await this.checkout.reconcileStrandedCard(t, b, ticket)).status,
    }, { log: (m) => this.log.warn(m) }) : null;
  }

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs
    if (!this.sweep || !paymentAttemptSweepEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'payments.stranded_attempts', jobClass: 'critical', everyMs: SWEEP_EVERY_MS }, () => this.tick()).catch(() => undefined); }, SWEEP_EVERY_MS);
    this.timer.unref?.();
    this.log.log(`Stranded payment-attempt sweep armed (every 5 min; stranded after ${strandedMinutes()} min).`);
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Public for ops / tests. Non-overlapping within the process. */
  async tick(): Promise<SweepReport | null> {
    if (!this.sweep || this.running) return null;
    this.running = true;
    try {
      // Single owner across workers (packages/database scheduler-lock); the store's conditional writes are the second line.
      const owned = await runAsSingleOwner(this.db as any, 'payments.stranded_attempts', () => this.sweep!.run());
      if (!owned.ran) return null;
      const r = owned.result;
      if (r.cardsResolved || r.cardsUnverified || r.splitsSettled || r.splitsReleased || r.splitsNeedReview || r.errors) this.log.log(`stranded attempts: ${JSON.stringify(r)}`);
      return r;
    } catch (e: any) {
      this.log.warn(`sweep failed: ${e?.message ?? e}`);
      return null;
    } finally { this.running = false; }
  }
}
