// Payments & Money → Transactions (Oct 29 2026 one-screen rebuild): the four KPIs come from the server over every matching
// tender (never summed from the visible page), filters and the period go to the server, the list pages on the server.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), technicians: vi.fn(), detail: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posTransactionsApi', () => ({ posTransactionsApi: api }));
import { POSTransactionsScreen } from './POSTransactionsScreen';
const PERIOD = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-29' };
const tender = (o: Record<string, unknown>) => ({ id: 'p1aaaaaa-0000-4000-8000-000000000001', ticketId: 't1', ticketNumber: '4001', state: 'completed', rawStatus: 'approved', createdAt: '2026-10-22T13:17:00Z', paidAt: '2026-10-22T13:17:00Z', lastRefundAt: null,
  customer: { id: 'c1', name: 'John Smith', phone: '(•••) •••-1234' }, technicians: 'Anna Nguyen', method: 'card', channel: null, card: 'VISA ••4242', giftCardLast4: null, grossCents: 6316, tipCents: 400, refundedCents: 0, refundPendingCents: 0, netCents: 6316, counted: true, processor: 'cardpointe', processorRef: 'RR4001', settlementId: null, ...o });
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.summary.mockResolvedValue({ kpis: { transactions: 3, grossCents: 16815, tipsCents: 960, netCents: 16815 }, context: { tickets: 3, refundedCents: 0, refundPendingCents: 0, voided: 0, pending: 0, failed: 1, cashCents: 0, cardCents: 16815, giftCardCents: 0 }, definitions: {}, period: PERIOD, dateBasis: 'paid', scope: 'location' });
  api.list.mockResolvedValue({ items: [tender({}), tender({ id: 'p3', ticketNumber: '4003', rawStatus: 'partial', grossCents: 5172 })], total: 4, page: 1, pageSize: 10, pageCount: 1, period: PERIOD });
  api.technicians.mockResolvedValue({ technicians: [{ id: 't1', name: 'Anna Nguyen' }] });
});
describe('POSTransactionsScreen', () => {
  it('shows the server KPIs — 3 · $168.15 · $9.60 · $168.15 — and one row per tender', async () => {
    render(<MemoryRouter><POSTransactionsScreen /></MemoryRouter>);
    expect(await screen.findByTestId('kpi-gross')).toHaveTextContent('$168.15');
    expect(screen.getByTestId('kpi-tips')).toHaveTextContent('$9.60'); expect(screen.getByTestId('kpi-net')).toHaveTextContent('$168.15'); expect(screen.getByTestId('kpi-transactions')).toHaveTextContent('3');
    expect(await screen.findAllByTestId('tx-row')).toHaveLength(2);
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ preset: 'month', dateField: 'paid', sort: 'created_desc', page: 1 }));
  });
  it('search, status and the period go to the server and reset to page 1', async () => {
    render(<MemoryRouter><POSTransactionsScreen /></MemoryRouter>); await screen.findAllByTestId('tx-row');
    fireEvent.change(screen.getByTestId('search'), { target: { value: '(856) 555-1234' } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '(856) 555-1234', page: 1 })));
    fireEvent.change(screen.getByTestId('status'), { target: { value: 'failed' } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' })));
    fireEvent.click(screen.getByTestId('preset-today'));
    await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'today' })));
  });
  it('shows a permission message on 403', async () => {
    api.list.mockRejectedValue({ status: 403 }); api.summary.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSTransactionsScreen /></MemoryRouter>);
    expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument();
  });
});
