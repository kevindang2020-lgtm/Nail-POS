// mobile-attempt-recovery.scheduler.ts — mandate §78: the durable recovery worker for Tap to Pay attempts whose result
// was lost, next to the Phase 11 stranded-attempt sweep (same discipline: critical job class, one owner per tick across
// workers, every write conditional; it never charges, voids or refunds — the provider's answer decides). Every two
// minutes: expire unused intents (§132) and verify unresolved attempts (unknown / timed_out / authorization_pending /
// authorized / confirmation_pending / reconciliation_required). An attempt the provider cannot answer for long enough
// goes to a human: 'reconciliation_required' + the owner / platform alert the sweep uses (owner_alerts + alerts).
// MOBILE_ATTEMPT_RECOVERY=off stops it.
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { DATABASE, runAsSingleOwner, type AppDatabase } from '@aipowersalon/database';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { MobileCheckoutService } from './mobile-checkout.service';
import { MobileAttemptRecoveryWorker, type MobileRecoveryReport, type MobileRecoveryAlerts } from './mobile-attempt-recovery';
import type { MobilePaymentAttemptPort } from './mobile-payment-attempt.repository';

export const RECOVERY_EVERY_MS = 2 * 60_000;

export function mobileAttemptRecoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MOBILE_ATTEMPT_RECOVERY ?? '').trim().toLowerCase() !== 'off';
}

/** The same two alert rows the stranded sweep raises (owner_alerts + platform alerts), deduped per attempt. */
export class KyselyMobileRecoveryAlerts implements MobileRecoveryAlerts {
  constructor(private readonly db: any) {}
  async raise(a: { tenantId: string; branchId: string | null; ticketId: string; idempotencyKey: string; amountCents: number; detail: string }): Promise<void> {
    const body = `A Tap to Pay payment of $${(a.amountCents / 100).toFixed(2)} needs review: ${a.detail}`;
    const meta = { kind: 'mobile_attempt', idempotencyKey: a.idempotencyKey, ticketId: a.ticketId, amountCents: a.amountCents };
    await sql`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata)
      values (${a.tenantId}, ${a.branchId}, 'payment_review', 'high', 'new', 'PAYMENT_NEEDS_REVIEW', ${body}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db).catch(() => undefined);
    await sql`insert into alerts (tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
      select ${a.tenantId}, (select coalesce(display_name, legal_name) from tenants where id = ${a.tenantId}), ${'Tap to Pay payment needs review'}, ${body}, 'payment', 'high', 'unread', 'payments', ${a.idempotencyKey}, ${'mobile_payment_review:' + a.idempotencyKey}
      on conflict (dedupe_key) do nothing`.execute(this.db).catch(() => undefined);
  }
}

@Injectable()
export class MobileAttemptRecoveryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MobileAttemptRecovery');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly worker: MobileAttemptRecoveryWorker | null;

  constructor(private readonly svc: MobileCheckoutService, @Inject('MobilePaymentAttemptPort') attempts: MobilePaymentAttemptPort, @Optional() @Inject(DATABASE) private readonly db?: AppDatabase) {
    this.worker = db ? new MobileAttemptRecoveryWorker(attempts, svc, new KyselyMobileRecoveryAlerts(db), { log: (m) => this.log.warn(m) }) : null;
  }

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs
    if (!this.worker || !mobileAttemptRecoveryEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'payments.mobile_attempt_recovery', jobClass: 'critical', everyMs: RECOVERY_EVERY_MS }, () => this.tick()).catch(() => undefined); }, RECOVERY_EVERY_MS);
    this.timer.unref?.();
    this.log.log('Tap to Pay unresolved-attempt recovery armed (every 2 min).');
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Public for ops / tests. Non-overlapping within the process; one owner across workers. */
  async tick(): Promise<MobileRecoveryReport | null> {
    if (!this.worker || this.running) return null;
    this.running = true;
    try {
      const owned = await runAsSingleOwner(this.db as any, 'payments.mobile_attempt_recovery', () => this.worker!.run());
      if (!owned.ran) return null;
      const r = owned.result;
      if (r.confirmed || r.declined || r.released || r.review || r.expired || r.errors) this.log.log(`mobile attempt recovery: ${JSON.stringify(r)}`);
      return r;
    } catch (e: any) {
      this.log.warn(`recovery tick failed: ${e?.message ?? e}`);
      return null;
    } finally { this.running = false; }
  }
}
