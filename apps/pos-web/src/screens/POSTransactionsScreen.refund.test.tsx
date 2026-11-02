// POSTransactionsScreen.refund.test.tsx — a refund is offered only inside the details overlay, only when the server says the
// role may refund and the tender still has a refundable amount, and it opens the existing guarded refund panel for the ticket.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), technicians: vi.fn(), detail: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posTransactionsApi', () => ({ posTransactionsApi: api }));
vi.mock('../components/TicketRefundPanel', () => ({ TicketRefundPanel: ({ ticketId, label }: any) => <div>Refund panel for {ticketId} ({label})</div> }));
import { POSTransactionsScreen } from './POSTransactionsScreen';
const PERIOD = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-29' };
const t = { id: 'p1', ticketId: 't1', ticketNumber: '4001', state: 'completed', rawStatus: 'approved', createdAt: '2026-10-22T13:17:00Z', paidAt: '2026-10-22T13:17:00Z', lastRefundAt: null, customer: { id: 'c1', name: 'Grace Kim', phone: null },
  technicians: null, method: 'card', channel: null, card: null, giftCardLast4: null, grossCents: 6000, tipCents: 0, refundedCents: 0, refundPendingCents: 0, netCents: 6000, counted: true, processor: null, processorRef: null, settlementId: null };
const detail = (refund: boolean) => ({ tender: { ...t, surchargeCents: 0, refundableCents: 6000 }, refunds: [], ticket: { id: 't1', ticketNumber: '4001', financials: {}, lines: [], tenders: [], tipAllocations: [], audit: [] }, settlement: null, permissions: { refund, sendReceipt: false, customer: false }, definitions: {} });
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.summary.mockResolvedValue({ kpis: { transactions: 1, grossCents: 6000, tipsCents: 0, netCents: 6000 }, context: { tickets: 1, refundedCents: 0, failed: 0, pending: 0 }, definitions: {}, period: PERIOD });
  api.list.mockResolvedValue({ items: [t], total: 1, page: 1, pageSize: 10, pageCount: 1, period: PERIOD }); api.technicians.mockResolvedValue({ technicians: [] });
});
describe('Transactions → Refund', () => {
  it('no refund action without the server permission', async () => {
    api.detail.mockResolvedValue(detail(false));
    render(<MemoryRouter><POSTransactionsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('view'));
    await screen.findByTestId('tender-facts');
    expect(screen.queryByTestId('detail-refund')).toBeNull();
  });
  it('a permitted role opens the refund panel for that ticket from the overlay', async () => {
    api.detail.mockResolvedValue(detail(true));
    render(<MemoryRouter><POSTransactionsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('view'));
    fireEvent.click(await screen.findByTestId('detail-refund'));
    expect(await screen.findByText('Refund panel for t1 (Grace Kim)')).toBeInTheDocument();
  });
});
