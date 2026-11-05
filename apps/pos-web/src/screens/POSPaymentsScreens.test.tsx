import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const txMock = vi.fn(), tipsMock = vi.fn();
vi.mock('../api/posReportsApi', () => ({
  posReportsApi: {
    state: vi.fn(), sales: vi.fn(), services: vi.fn(), technicians: vi.fn(), payments: vi.fn(),
    customers: vi.fn(), booking: vi.fn(), tax: vi.fn(), exportReport: vi.fn(),
    transactions: (...a: any[]) => txMock(...a),
    tips: (...a: any[]) => tipsMock(...a),
  },
}));
import { POSTransactionsScreen } from './POSTransactionsScreen';
import { POSTipsScreen } from './POSTipsScreen';
beforeEach(() => { txMock.mockReset(); tipsMock.mockReset(); });

describe('POSTransactionsScreen', () => {
  it('renders the transaction ledger + refetches on period change', async () => {
    txMock.mockResolvedValue([{ id: 't1', at: '2026-07-01T14:30:00Z', customer: 'Emma W', technician: 'Anna', service: 'Gel', paymentMethod: 'card', grossCents: 6500, tipCents: 1000, taxCents: 400, netCents: 7500, status: 'paid' }]);
    render(<POSTransactionsScreen />);
    expect(await screen.findByRole('heading', { name: 'Transactions' })).toBeInTheDocument();
    expect(screen.getByText('Emma W')).toBeInTheDocument();
    expect(screen.getAllByText('$75.00').length).toBeGreaterThan(0);
    expect(txMock).toHaveBeenCalledWith({ period: 'month' });
    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    await waitFor(() => expect(txMock).toHaveBeenCalledWith({ period: 'today' }));
  });
  it('shows 403 message', async () => { txMock.mockRejectedValue({ status: 403 }); render(<POSTransactionsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
describe('POSTipsScreen', () => {
  it('renders tip totals + by-technician', async () => {
    tipsMock.mockResolvedValue({ totalCents: 25000, cardTipsCents: 20000, cashTipsCents: 5000, tipPercentAvg: 18.5, noTipCount: 3, managerApprovalCount: 0, byTechnician: [{ technicianId: 'x1', name: 'Anna Tech', tipsCents: 15000 }] });
    render(<POSTipsScreen />);
    expect(await screen.findByRole('heading', { name: 'Tips' })).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toBeInTheDocument();
    expect(screen.getByText('Anna Tech')).toBeInTheDocument();
    expect(screen.getByText('18.5%')).toBeInTheDocument();
  });
});
