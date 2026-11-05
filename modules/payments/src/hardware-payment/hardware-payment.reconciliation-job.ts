// hardware-payment.reconciliation-job.ts — §8 HardwarePaymentMonthlyReconciliationJob. Runs all ACTIVE plans for a
// billing month using the imported card volume, reconciling each (which applies credit, computes the shortfall, and
// auto-charges via the gated path). Records a hardware_reconciliation_runs row. Idempotent per (plan, month) because
// reconcile() upserts the invoice. Trigger monthly via the Super-Admin run-monthly endpoint or an external scheduler.
import { Injectable, Inject, Optional } from '@nestjs/common';
import { HardwarePaymentService, HW_REPO } from './hardware-payment.service';
import type { HardwarePaymentDataPort, ReconciliationRun } from './hardware-payment.repository';
import { InMemoryHardwarePaymentRepository } from './hardware-payment.repository';

export interface MonthlyRunSummary {
  billingMonth: string; plansProcessed: number; invoicesCreated: number; shortfallsChargedCents: number;
  skippedNoVolume: number; failures: number; run: ReconciliationRun | null;
  results: Array<{ tenantId: string; planId: string; status: string; shortfallCents: number; autoChargedCents: number }>;
}

@Injectable()
export class HardwarePaymentReconciliationJob {
  constructor(
    private readonly svc: HardwarePaymentService,
    @Optional() @Inject(HW_REPO) private readonly repo: HardwarePaymentDataPort = new InMemoryHardwarePaymentRepository(),
  ) {}

  async runMonthly(billingMonth: string): Promise<MonthlyRunSummary> {
    if (!/^\d{4}-\d{2}$/.test(billingMonth)) throw new Error('billingMonth must be YYYY-MM');
    const plans = await this.repo.listActivePlans();
    let invoicesCreated = 0, shortfallsChargedCents = 0, skippedNoVolume = 0, failures = 0;
    const results: MonthlyRunSummary['results'] = [];
    for (const plan of plans) {
      const volume = await this.repo.getCardVolume(plan.tenantId, billingMonth);
      if (volume == null) { skippedNoVolume++; continue; }      // no finalized residual yet → skip (re-runnable later)
      try {
        const out = await this.svc.reconcile(plan.tenantId, plan.id, billingMonth, volume);
        invoicesCreated++;
        shortfallsChargedCents += out.autoChargedCents;
        results.push({ tenantId: plan.tenantId, planId: plan.id, status: out.invoice.status, shortfallCents: out.shortfallCents, autoChargedCents: out.autoChargedCents });
      } catch (e) {
        failures++;
        results.push({ tenantId: plan.tenantId, planId: plan.id, status: 'error', shortfallCents: 0, autoChargedCents: 0 });
      }
    }
    const status = failures === 0 ? 'completed' : (invoicesCreated > 0 ? 'partial' : 'failed');
    const run = await this.repo.addReconciliationRun({ tenantId: null, billingMonth, status, plansProcessed: invoicesCreated, invoicesCreated, shortfallsChargedCents, failures, notes: `active=${plans.length} skippedNoVolume=${skippedNoVolume}` });
    return { billingMonth, plansProcessed: plans.length, invoicesCreated, shortfallsChargedCents, skippedNoVolume, failures, run, results };
  }
}

/** The billing month that just closed (UTC), as 'YYYY-MM'. On 2026-07-01 → '2026-06'; on 2026-01-01 → '2025-12'. */
export function previousBillingMonth(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}
export const hardwareCronEnabled = (): boolean => process.env.HARDWARE_PAYMENT_CRON_ENABLED === '1' || process.env.HARDWARE_PAYMENT_CRON_ENABLED === 'true';

/** The monthly tick body — gated on HARDWARE_PAYMENT_CRON_ENABLED, reconciles the month that just closed, never throws. */
export async function runMonthlyTick(job: HardwarePaymentReconciliationJob, log?: { log: (m: string) => void; error: (m: string) => void }): Promise<void> {
  if (!hardwareCronEnabled()) return;
  const month = previousBillingMonth();
  try {
    const s = await job.runMonthly(month);
    log?.log(`Monthly reconciliation ${month}: plans=${s.plansProcessed} invoices=${s.invoicesCreated} charged=${s.shortfallsChargedCents}c skippedNoVolume=${s.skippedNoVolume} failures=${s.failures}`);
  } catch (e: any) {
    log?.error(`Monthly reconciliation ${month} failed: ${e?.message ?? e}`);
  }
}
