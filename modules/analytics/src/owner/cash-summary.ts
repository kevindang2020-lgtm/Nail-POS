import type { CashPoolSummary, DailyCashSummary } from '@aipowersalon/api-contracts/tenant';
export type { CashPoolSummary, DailyCashSummary };   // owned by packages/api-contracts (Constitution 13 §13)

export function combineCashSummary(date: string, drawer: { branches?: any[] }, tech: any): DailyCashSummary {
  const br = drawer?.branches || [];
  const register: CashPoolSummary = {
    expectedCents: br.reduce((a, b) => a + (b.expectedCashCents || 0), 0),
    countedCents: br.reduce((a, b) => a + (b.countedCents || 0), 0),
    varianceCents: br.reduce((a, b) => a + (b.varianceCents || 0), 0),
    unitCount: br.length,
    reconciledCount: br.filter((b: any) => b.status === 'reconciled').length,
    discrepancyCount: br.filter((b: any) => b.status === 'discrepancy').length,
    awaitingCount: br.filter((b: any) => b.countedCents == null).length,
  };
  const techs = tech?.technicians || [];
  const techCash: CashPoolSummary = {
    expectedCents: tech?.totalExpectedCents || 0,
    countedCents: tech?.totalCountedCents || 0,
    varianceCents: techs.reduce((a: number, t: any) => a + (t.varianceCents || 0), 0),
    unitCount: techs.length,
    reconciledCount: techs.filter((t: any) => t.status === 'reconciled').length,
    discrepancyCount: techs.filter((t: any) => t.status === 'discrepancy').length,
    awaitingCount: techs.filter((t: any) => t.status === 'open' || t.status === 'submitted').length,
  };
  return {
    businessDate: date,
    register, techCash,
    total: {
      expectedCents: register.expectedCents + techCash.expectedCents,
      countedCents: register.countedCents + techCash.countedCents,
      varianceCents: register.varianceCents + techCash.varianceCents,
    },
  };
}
