import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { stateMock, listBankMock, createBankMock, listDepMock, createDepMock, linkMock } = vi.hoisted(() => ({
  stateMock: vi.fn(), listBankMock: vi.fn(), createBankMock: vi.fn(), listDepMock: vi.fn(), createDepMock: vi.fn(), linkMock: vi.fn(),
}));
vi.mock('../api/posDepositReconApi', () => ({ posDepositReconApi: { state: stateMock, listBankAccounts: listBankMock, createBankAccount: createBankMock, listDeposits: listDepMock, createDeposit: createDepMock, linkDeposit: linkMock } }));
import { POSDepositReconScreen } from './POSDepositReconScreen';

const kpis = { settlementCount: 2, expectedCents: 15000, actualMatchedCents: 10000, matched: 1, matchedWithTolerance: 0, unmatchedSettlements: 0, missingDeposits: 1, unmatchedDeposits: 0, differenceCents: 0 };
const rows = [
  { settlementId: 's1', processorType: 'fiserv', settledAt: '2026-07-05T00:00:00Z', grossCents: 10300, feeCents: 300, expectedNetCents: 10000, depositId: 'd1', actualCents: 10000, differenceCents: 0, status: 'matched', matchType: 'reference', confidence: 1, dateDiffDays: 0 },
  { settlementId: 's2', processorType: 'fiserv', settledAt: '2026-07-01T00:00:00Z', grossCents: 5150, feeCents: 150, expectedNetCents: 5000, depositId: null, actualCents: null, differenceCents: 0, status: 'missing_deposit', matchType: 'none', confidence: 0, dateDiffDays: null },
];
beforeEach(() => {
  stateMock.mockReset(); listBankMock.mockReset(); createBankMock.mockReset();
  stateMock.mockResolvedValue({ kpis, rows, unmatchedDeposits: [] });
  listBankMock.mockResolvedValue([{ id: 'b1', nickname: 'Main Checking', bankName: 'TD', accountType: 'checking', accountLast4: '2345', currency: 'USD', status: 'active' }]);
  createBankMock.mockResolvedValue({ id: 'b2' });
});

describe('POSDepositReconScreen', () => {
  it('renders KPIs and the settlement→deposit matching rows', async () => {
    render(<POSDepositReconScreen />);
    expect(await screen.findByText('AI Deposit Reconciliation')).toBeInTheDocument();
    expect(screen.getByText('$150.00')).toBeInTheDocument();   // expected 15000 KPI
    expect(screen.getAllByText('Matched').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Missing deposit')).toBeInTheDocument();
    expect(screen.getAllByText(/••2345/).length).toBeGreaterThanOrEqual(1);     // masked bank account
  });
  it('adds a bank account through the real client', async () => {
    render(<POSDepositReconScreen />);
    await screen.findByText('AI Deposit Reconciliation');
    fireEvent.change(screen.getByPlaceholderText(/Nickname/), { target: { value: 'Savings' } });
    fireEvent.change(screen.getByPlaceholderText('Last 4'), { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(createBankMock).toHaveBeenCalled());
    expect(createBankMock.mock.calls[0][0]).toMatchObject({ nickname: 'Savings', accountLast4: '9999' });
  });
});
