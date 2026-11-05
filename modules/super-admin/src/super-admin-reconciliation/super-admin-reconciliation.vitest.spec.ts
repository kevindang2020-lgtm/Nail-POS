import { describe, it, expect } from 'vitest';
import { InMemorySuperAdminReconRepository } from './super-admin-reconciliation.repository';
import { SuperAdminReconService } from './super-admin-reconciliation.service';

describe('super-admin reconciliation oversight', () => {
  it('returns platform aggregates + an explicit no-financial-detail note', async () => {
    const svc = new SuperAdminReconService(new InMemorySuperAdminReconRepository({ tenantsWithBankAccounts: 12, bankAccounts: 15, bankDeposits: 340, feeSchedules: 9, exceptionsByStatus: { open: 4, resolved: 20 }, criticalOpen: 2, periods: 6, periodsClosed: 3, aiExplainRuns: 88, aiErrors: 1 }));
    const o = await svc.overview();
    expect(o.tenantsWithBankAccounts).toBe(12);
    expect(o.bankDeposits).toBe(340);
    expect(o.criticalOpen).toBe(2);
    expect(o.exceptionsByStatus.open).toBe(4);
    expect(o.note).toMatch(/not exposed/i);
    // no per-tenant financial fields leak into the aggregate shape
    expect(Object.keys(o)).not.toContain('deposits');
    expect(Object.keys(o)).not.toContain('settlements');
  });
  it('defaults to zeros with no data', async () => {
    const o = await new SuperAdminReconService(new InMemorySuperAdminReconRepository()).overview();
    expect(o.bankAccounts).toBe(0); expect(o.criticalOpen).toBe(0);
  });
});
