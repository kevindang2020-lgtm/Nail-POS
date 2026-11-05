import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { feeMock, listExcMock, resolveMock, sumMock, dailyMock } = vi.hoisted(() => ({ feeMock: vi.fn(), listExcMock: vi.fn(), resolveMock: vi.fn(), sumMock: vi.fn(), dailyMock: vi.fn() }));
vi.mock('../api/posDepositReconApi', () => ({ posDepositReconApi: { feeReconciliation: feeMock, listExceptions: listExcMock, resolveException: resolveMock, reportSummary: sumMock, reportDaily: dailyMock, dailyExportUrl: () => '/x' } }));
import { FeesPanel, ExceptionsPanel, ReportsPanel } from './POSDepositReconPanels';
beforeEach(() => { feeMock.mockReset(); listExcMock.mockReset(); resolveMock.mockReset(); sumMock.mockReset(); dailyMock.mockReset(); });

describe('FeesPanel', () => {
  it('shows fee KPIs + rows, marks unverified', async () => {
    feeMock.mockResolvedValue({ kpis: { matched: 1, feeDifferences: 1, unverified: 1, feeDifferenceCents: 100 }, rows: [{ settlementId: 's1', processorType: 'fiserv', settledAt: '2026-07-01T00:00:00Z', actualFeeCents: 3000, expectedFeeCents: 2900, differenceCents: 100, status: 'fee_difference', unverifiedReason: null }, { settlementId: 's2', processorType: 'fiserv', settledAt: null, actualFeeCents: 500, expectedFeeCents: null, differenceCents: null, status: 'unverified', unverifiedReason: 'no txn count' }] });
    render(<FeesPanel />);
    expect(await screen.findByText('Processing Fees by Settlement')).toBeInTheDocument();
    expect(screen.getAllByText('Difference').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unverified').length).toBeGreaterThan(0);
  });
});

describe('ExceptionsPanel', () => {
  it('lists cases and resolves with a note', async () => {
    listExcMock.mockResolvedValue({ kpis: { open: 1, inReview: 0, escalated: 0, resolved: 0, critical: 1, amountAtRiskCents: 200000 }, items: [{ id: 'e1', title: 'Missing deposit', kind: 'missing_deposit', severity: 'critical', amountCents: 200000, status: 'open' }] });
    resolveMock.mockResolvedValue({});
    const promptSpy = vi.spyOn(window, 'prompt');
    render(<ExceptionsPanel />);
    expect(await screen.findByText('Missing deposit')).toBeInTheDocument();
    // Inline editor (no native dialog): open → type the required note → confirm.
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.change(screen.getByLabelText('Resolution note (required)'), { target: { value: 'Bank confirmed late deposit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(resolveMock).toHaveBeenCalledWith('e1', 'Bank confirmed late deposit'));
    expect(promptSpy).not.toHaveBeenCalled();
  });
});

describe('ReportsPanel', () => {
  it('shows summary + daily rows', async () => {
    sumMock.mockResolvedValue({ settlements: 9, expectedCents: 164900, missingDeposits: 2, openExceptions: 1 });
    dailyMock.mockResolvedValue({ rows: [{ date: '2026-07-01', settlementCount: 2, expectedCents: 9700, actualCents: 9700, differenceCents: 0, missing: 0 }], totals: {} });
    render(<ReportsPanel />);
    expect(await screen.findByText('Daily Reconciliation')).toBeInTheDocument();
    expect(screen.getByText('2026-07-01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });
});
