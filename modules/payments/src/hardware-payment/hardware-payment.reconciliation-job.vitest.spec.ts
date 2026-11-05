import { describe, it, expect } from 'vitest';
import { HardwarePaymentService } from './hardware-payment.service';
import { InMemoryHardwarePaymentRepository } from './hardware-payment.repository';
import { HardwarePaymentReconciliationJob } from './hardware-payment.reconciliation-job';
import { FiservResidualImportService } from './hardware-payment.residual-import';

function harness(chargeOk = true) {
  const repo = new InMemoryHardwarePaymentRepository();
  const charge = { charge: async () => (chargeOk ? { ok: true, retref: 'R', respstat: 'A', respText: 'ok' } : { ok: false, respstat: 'C', respText: 'no' }) };
  const svc = new HardwarePaymentService(repo, charge as any);
  const job = new HardwarePaymentReconciliationJob(svc, repo);
  const residual = new FiservResidualImportService(repo);
  return { repo, svc, job, residual };
}
const active = (svc: HardwarePaymentService, t: string, monthly: number) => svc.createPlan(t, { status: 'active', monthlyPaymentCents: monthly, totalHardwareCostCents: 300000 });

describe('Monthly reconciliation job (build doc §8) + residual import (§12)', () => {
  it('reconciles every active plan that has an imported volume, and records a run', async () => {
    const { svc, job, residual } = harness();
    await active(svc, 'tA', 25_000);
    await active(svc, 'tB', 25_000);
    await residual.importVolume('tA', '2026-06', 5_000_000);
    await residual.importVolume('tB', '2026-06', 5_000_000);
    const sum = await job.runMonthly('2026-06');
    expect(sum.plansProcessed).toBe(2);
    expect(sum.invoicesCreated).toBe(2);
    expect(sum.skippedNoVolume).toBe(0);
    expect(sum.failures).toBe(0);
    expect(sum.run?.status).toBe('completed');
    expect(sum.results.every((r) => r.shortfallCents === 15_250)).toBe(true);
  });

  it('skips active plans with no imported volume (re-runnable later)', async () => {
    const { svc, job, residual } = harness();
    await active(svc, 'tA', 25_000);
    await active(svc, 'tB', 25_000);
    await residual.importVolume('tA', '2026-06', 5_000_000);   // only tA has volume
    const sum = await job.runMonthly('2026-06');
    expect(sum.invoicesCreated).toBe(1);
    expect(sum.skippedNoVolume).toBe(1);
  });

  it('does not process paused plans', async () => {
    const { svc, job, residual } = harness();
    const p = await active(svc, 'tA', 25_000);
    await svc.pausePlan('tA', p.id);
    await residual.importVolume('tA', '2026-06', 5_000_000);
    const sum = await job.runMonthly('2026-06');
    expect(sum.plansProcessed).toBe(0);
    expect(sum.invoicesCreated).toBe(0);
  });

  it('auto-charges shortfalls during the run when consent + method exist, and tallies the total', async () => {
    const { svc, job, residual } = harness(true);
    const p = await active(svc, 'tA', 25_000);
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok', last4: '1' });
    await svc.recordAutopayConsent('tA', p.id, { userId: 'o' });
    await residual.importVolume('tA', '2026-06', 5_000_000);
    const sum = await job.runMonthly('2026-06');
    expect(sum.shortfallsChargedCents).toBe(15_250);
    expect(sum.results[0].status).toBe('paid');
  });

  it('residual import is idempotent (re-import updates the month)', async () => {
    const { residual } = harness();
    await residual.importVolume('tA', '2026-06', 4_000_000);
    await residual.importVolume('tA', '2026-06', 5_000_000);
    expect(await residual.getVolume('tA', '2026-06')).toBe(5_000_000);
  });

  it('rejects a malformed billing month', async () => {
    const { job } = harness();
    await expect(job.runMonthly('June 2026')).rejects.toThrow(/YYYY-MM/);
  });

  it('aggregates monthly report totals across tenants/months (build doc §16)', async () => {
    const { svc, residual, job } = harness();
    await active(svc, 'tA', 25_000);
    await active(svc, 'tB', 25_000);
    await residual.importVolume('tA', '2026-06', 5_000_000);
    await residual.importVolume('tB', '2026-06', 5_000_000);
    await job.runMonthly('2026-06');                 // two invoices in 2026-06
    await residual.importVolume('tA', '2026-07', 5_000_000);
    await job.runMonthly('2026-07');                 // one invoice in 2026-07
    const rep = await svc.reportMonthlyTotals();
    expect(rep[0].billingMonth).toBe('2026-07');
    expect(rep[1].billingMonth).toBe('2026-06');
    const june = rep[1];
    expect(june.invoiceCount).toBe(2);
    expect(june.cardVolumeCents).toBe(10_000_000);
    expect(june.shortfallCents).toBe(30_500);        // 15250 x2
    expect(june.hardwareCreditCents).toBe(19_500);   // 9750 x2
    expect(june.collectionRatePct).toBe(0);          // no saved card → nothing collected
  });
});
