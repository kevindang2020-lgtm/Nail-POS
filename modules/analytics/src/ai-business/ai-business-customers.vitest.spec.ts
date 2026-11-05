// ai-business-customers.vitest.spec.ts — slice 6: customer growth + retention (§15, §31).
import { ForbiddenError, type ReportsContext, type ReportFilters, type CustomerInsights } from '@aipowersalon/reports';
import { describe, it, expect } from 'vitest';
import { AiBusinessCustomersService, type CustomerSource } from './ai-business-customers.service';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

const ci = (o: Partial<CustomerInsights>): CustomerInsights => ({ newCustomers: 0, newCustomersTrendPercent: 0, returningCustomers: 0, returningCustomersTrendPercent: 0, retentionRatePercent: 0, retentionRateTrendPercent: 0, ...o });

class FakeCustomerSource implements CustomerSource {
  lastCtx: ReportsContext | null = null;
  constructor(private data: CustomerInsights, private deny = false) {}
  async getCustomers(ctx: ReportsContext, _f?: ReportFilters) { this.lastCtx = ctx; if (this.deny) throw new ForbiddenError('Missing pos.reports.customer_view'); return this.data; }
}
const CTX = (o: Partial<AiBusinessContext> = {}): AiBusinessContext => ({ tenantId: 'tA', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.use', 'pos.reports.view', 'pos.reports.customer_view'], ...o });

describe('getCustomerGrowth', () => {
  const src = new FakeCustomerSource(ci({ newCustomers: 40, newCustomersTrendPercent: 12, returningCustomers: 160, returningCustomersTrendPercent: 5, retentionRatePercent: 68, retentionRateTrendPercent: -2 }));
  const svc = new AiBusinessCustomersService(src);

  it('passes new/returning/retention with their trends', async () => {
    const r = await svc.getCustomerGrowth(CTX(), 'month');
    expect(r.newCustomers).toBe(40);
    expect(r.newCustomersTrendPercent).toBe(12);
    expect(r.returningCustomers).toBe(160);
    expect(r.retentionRatePercent).toBe(68);
    expect(r.retentionRateTrendPercent).toBe(-2);
  });

  it('derives active customers as new + returning and labels it', async () => {
    const r = await svc.getCustomerGrowth(CTX(), 'month');
    expect(r.activeCustomers).toBe(200);
    expect(r.modeledFields).toContain('activeCustomers(derived)');
    expect(r.notes.some((n) => /Cohort.*not modeled/i.test(n))).toBe(true);
  });

  it('does not fabricate lost/inactive customer counts', async () => {
    const r = await svc.getCustomerGrowth(CTX(), 'month');
    expect(r).not.toHaveProperty('lostCustomers');
    expect(r).not.toHaveProperty('inactiveCustomers');
    expect(JSON.stringify(r.modeledFields)).not.toMatch(/lost|inactive|cohort/i);
  });

  it('flags limited data under the active-customer floor', async () => {
    const small = new AiBusinessCustomersService(new FakeCustomerSource(ci({ newCustomers: 1, returningCustomers: 2, retentionRatePercent: 100 })));
    const r = await small.getCustomerGrowth(CTX(), 'today');
    expect(r.limitedData).toBe(true);
    expect(r.notes.some((n) => /caution/i.test(n))).toBe(true);
  });

  it('rejects an invalid preset', async () => {
    try { await svc.getCustomerGrowth(CTX(), 'forever'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INVALID_DATE_RANGE); }
  });

  it('maps the customer-view permission denial to INSUFFICIENT_PERMISSION', async () => {
    const denied = new AiBusinessCustomersService(new FakeCustomerSource(ci({}), true));
    try { await denied.getCustomerGrowth(CTX({ permissions: ['ai.use', 'pos.reports.view'] }), 'month'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INSUFFICIENT_PERMISSION); }
  });

  it('builds the ReportsContext from the trusted tenant id', async () => {
    await svc.getCustomerGrowth(CTX({ tenantId: 'tQ' }), 'week');
    expect(src.lastCtx?.tenantId).toBe('tQ');
  });
});
