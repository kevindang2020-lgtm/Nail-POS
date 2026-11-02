// compensation-payroll.vitest.spec.ts — §20 canonical payroll line from snapshot + guarantee + adjustments; §6 example
// flows into a line; reconciliation. Orchestrator reads via a fake snapshot port (no DB).
import { describe, it, expect } from 'vitest';
import { buildPayrollLine, payrollLineFromSnapshot, type PayrollSnapshotPort } from './compensation-payroll';
import { DEFAULT_INCLUSIONS, type GuaranteePolicy } from './compensation-guarantee';

describe('payroll line from compensation (§20)', () => {
  it('buildPayrollLine: commission + retail + topup + tips + adjustment = payable (reconciles)', () => {
    const line = buildPayrollLine({ techServiceEarningsCents: 14000, cardTipCents: 6000, cashTipCents: 0, retailCommissionCents: 1000, tickets: 5 }, 4000, 500);
    expect(line.serviceCommissionCents).toBe(14000);
    expect(line.retailCommissionCents).toBe(1000);
    expect(line.tipsCents).toBe(6000);
    expect(line.guaranteeTopUpCents).toBe(4000);
    expect(line.adjustmentCents).toBe(500);
    expect(line.payableCents).toBe(25500); // 14000+1000+4000+6000+500
    expect(line.reconciles).toBe(true);
  });

  it('§6 daily example as a payroll line: $140 commission + $40 top-up + $60 tips → $240 payable', () => {
    const line = buildPayrollLine({ techServiceEarningsCents: 14000, cardTipCents: 6000, cashTipCents: 0, retailCommissionCents: 0, tickets: 8 }, 4000, 0);
    expect(line.payableCents).toBe(24000);
  });

  it('orchestrator derives a line from the snapshot with a guarantee policy', async () => {
    const port: PayrollSnapshotPort = { sumByTechnicianPeriod: async () => ({ techServiceEarningsCents: 87000, cardTipCents: 32500, cashTipCents: 0, retailCommissionCents: 0, tickets: 40 }) };
    const policy: GuaranteePolicy = { period: 'week', guaranteedCents: 100000, proration: 'none', type: 'nonrecoverable', include: DEFAULT_INCLUSIONS };
    const line = await payrollLineFromSnapshot(port, { tenantId: 't1', technicianId: 'tech1', fromIso: '2026-06-20', toIso: '2026-06-26', guarantee: { policy, facts: { clockedIn: true } } });
    // weekly $1000 vs $870 earned → $130 top-up; tips $325 separate; payable = 870+130+325 = 1325
    expect(line.guaranteeTopUpCents).toBe(13000);
    expect(line.payableCents).toBe(132500);
    expect(line.tickets).toBe(40);
  });

  it('orchestrator without a guarantee: payable = commission + tips (+0 top-up)', async () => {
    const port: PayrollSnapshotPort = { sumByTechnicianPeriod: async () => ({ techServiceEarningsCents: 50000, cardTipCents: 8000, cashTipCents: 2000, retailCommissionCents: 1500, tickets: 20 }) };
    const line = await payrollLineFromSnapshot(port, { tenantId: 't1', technicianId: 'tech1', fromIso: '2026-06-20', toIso: '2026-06-26' });
    expect(line.guaranteeTopUpCents).toBe(0);
    expect(line.payableCents).toBe(61500); // 50000 + 1500 + 0 + 10000
  });
});
