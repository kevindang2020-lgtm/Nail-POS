// Invoices extras (Nov 11 2026): readable status explanation, balance after a payment, duplicate warning
import { describe, it, expect, vi } from 'vitest';
vi.mock('../api/posInvoicesApi', () => ({ posInvoicesApi: {} }));
import { explainStatus } from './POSInvoicesScreen';

const base = { totalCents: 10000, paidCents: 0, balanceCents: 10000, creditedCents: 0, dueDate: '2026-11-30' };
describe('explainStatus — why this status, from recorded amounts only', () => {
  it('names the amounts and the due date for each status', () => {
    expect(explainStatus({ ...base, displayStatus: 'draft' })).toMatch(/not issued yet/);
    expect(explainStatus({ ...base, displayStatus: 'sent' })).toMatch(/\$100\.00 due by Nov 30, 2026/);
    expect(explainStatus({ ...base, displayStatus: 'overdue' })).toMatch(/Past its due date \(Nov 30, 2026\) with \$100\.00 still unpaid/);
    expect(explainStatus({ ...base, displayStatus: 'partially_paid', paidCents: 4000, balanceCents: 6000 })).toBe('$40.00 paid of $100.00 — $60.00 still due.');
    expect(explainStatus({ ...base, displayStatus: 'paid', paidCents: 8000, balanceCents: 0, creditedCents: 2000 })).toBe('Settled: $80.00 paid and $20.00 credited.');
    expect(explainStatus({ ...base, displayStatus: 'sent', dueDate: null })).toBe('Issued, no payment recorded yet — $100.00 due.');
  });
});
