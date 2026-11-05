// PaymentsMoneyScreen (owner, read-only): gross/net/tips/refunds summary + method mix, with a Transactions / Refunds
// sub-tab over recent rows. Verifies the summary KPIs, method breakdown, the transaction list, the sub-tab switch to
// refunds, and empty states.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerPaymentsApi: { overview: vi.fn() } }));

import { ownerPaymentsApi } from '../api/ownerApi';
import { PaymentsMoneyScreen } from './PaymentsMoneyScreen';

const overview = (over: any = {}) => ({
  range: { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
  summary: { grossCents: 4820000, tipsCents: 612000, refundsCents: 84000, netCents: 4736000, transactionCount: 612, refundCount: 7, byMethod: [{ method: 'card', amountCents: 4100000, count: 540 }, { method: 'cash', amountCents: 720000, count: 72 }] },
  transactions: [{ id: 'pay1', amountCents: 8800, tipCents: 1500, method: 'card', status: 'captured', ticketRef: '#a1b2c3d4', processorRef: '•••4242', at: '2026-06-27T14:00:00.000Z' }],
  refunds: [{ id: 'r1', amountCents: 4200, reason: 'Service redo', status: 'completed', paymentRef: '#a1b2c3d4', at: '2026-06-26T11:00:00.000Z' }],
  generatedAt: '2026-06-27T15:00:00.000Z',
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); (ownerPaymentsApi.overview as any).mockResolvedValue(overview()); });

const card = (label: string) => screen.getByText(label).closest('.owner-kpi') as HTMLElement;

describe('PaymentsMoneyScreen', () => {
  it('renders the money summary and method breakdown', async () => {
    render(<PaymentsMoneyScreen />);
    await waitFor(() => expect(screen.getByText('Gross')).toBeInTheDocument());
    expect(card('Gross')).toHaveTextContent('$48,200.00');
    expect(card('Net')).toHaveTextContent('$47,360.00');
    expect(card('Refunds')).toHaveTextContent('$840.00');
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
  });

  it('shows the transaction list with a masked gateway reference', async () => {
    render(<PaymentsMoneyScreen />);
    await waitFor(() => expect(screen.getByText('$88.00')).toBeInTheDocument());
    expect(screen.getByText(/•••4242/)).toBeInTheDocument();
    expect(screen.getByText('Captured')).toBeInTheDocument();
  });

  it('switches to the refunds sub-tab and lists refunds', async () => {
    render(<PaymentsMoneyScreen />);
    await waitFor(() => expect(screen.getByText('$88.00')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Refunds & Voids'));
    await waitFor(() => expect(screen.getByText('−$42.00')).toBeInTheDocument());
    expect(screen.getByText(/Service redo/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no transactions', async () => {
    (ownerPaymentsApi.overview as any).mockResolvedValue(overview({ transactions: [] }));
    render(<PaymentsMoneyScreen />);
    await waitFor(() => expect(screen.getByText('No transactions in this period.')).toBeInTheDocument());
  });
});
