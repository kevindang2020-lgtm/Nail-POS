// Membership Overview 16 · 15 drill-down: the source rows carry payment amounts. A role that may open the page but not see
// the salon's financials (e.g. a technician with membership view) gets the rows with every amount hidden (null), never 0.
import { describe, it, expect } from 'vitest';
import { SystemChecksController } from './system-checks.controller';

const ROWS = { domain: 'memberships', key: 'payment_without_ledger', checkedAt: '2026-11-12T00:00:00Z', branchId: null, limit: 25, available: true, truncated: false,
  rows: [{ membershipId: 'm1', memberNumber: '7', customerName: 'Ava', source: 'payment', sourceId: 'p1', ticketId: null, ticketNumber: null, amountCents: 4500, at: null, detail: null }] };
const ctl = () => new SystemChecksController({ rows: async () => structuredClone(ROWS) } as any);
const req = (permissions: string[]) => ({ ctx: { tenantId: '00000000-0000-4000-8000-000000000001', branchId: null, role: 'X', permissions } });

describe('membership check rows — money only for financial viewers', () => {
  it('a financial viewer sees the amounts', async () => {
    const r: any = await ctl().membershipCheckRows(req(['pos.memberships.view', 'pos.reports.financial_view']), 'payment_without_ledger');
    expect(r.rows[0].amountCents).toBe(4500);
    expect(r.moneyHidden).toBeUndefined();
  });
  it('a viewer without financials gets amounts hidden (null), flagged — never 0', async () => {
    const r: any = await ctl().membershipCheckRows(req(['pos.memberships.view']), 'payment_without_ledger');
    expect(r.rows[0].amountCents).toBeNull();
    expect(r.moneyHidden).toBe(true);
    expect(r.rows[0].customerName).toBe('Ava');
  });
});
