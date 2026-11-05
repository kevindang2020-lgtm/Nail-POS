import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posAccountInvoicesApi', () => ({ posAccountInvoicesApi: { state: stateMock } }));
import { POSAccountInvoicesScreen } from './POSAccountInvoicesScreen';
beforeEach(() => stateMock.mockReset());

const state = {
  tenantId: 't1', currency: 'USD', plan: 'pro', planStatus: 'active', outstandingCents: 9900,
  invoices: [
    { invoiceNumber: 'BILL-1002', totalCents: 9900, amountDueCents: 9900, status: 'open', invoiceDate: '2026-07-01', dueDate: '2026-07-15', retryStatus: null },
    { invoiceNumber: 'BILL-1001', totalCents: 9900, amountDueCents: 0, status: 'paid', invoiceDate: '2026-06-01', dueDate: '2026-06-15', retryStatus: null },
  ],
  credits: [{ amountCents: 5000, remainingCents: 2000, reason: 'goodwill', status: 'active' }],
};

describe('POSAccountInvoicesScreen', () => {
  it('shows amount due, plan, credit, and invoice rows', async () => {
    stateMock.mockResolvedValue(state);
    render(<POSAccountInvoicesScreen />);
    expect(await screen.findByRole('heading', { name: 'Billing Invoices' })).toBeInTheDocument();
    expect(screen.getByText('BILL-1002')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('$20.00')).toBeInTheDocument();   // available credit (remaining)
  });
  it('shows an empty state with no invoices', async () => {
    stateMock.mockResolvedValue({ ...state, invoices: [], outstandingCents: 0, credits: [] });
    render(<POSAccountInvoicesScreen />);
    expect(await screen.findByText('No invoices yet.')).toBeInTheDocument();
  });
});
