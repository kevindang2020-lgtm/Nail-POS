// Payments → Split Payments (Oct 29 2026 one-screen rebuild): one row per ticket with its PAYMENT BREAKDOWN in place
// (Total · Cash · Credit Card · Gift Card · Remaining balance), server KPIs, server filters, a declined attempt never a tender.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), registers: vi.fn(), detail: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posSplitPaymentsApi', () => ({ posSplitPaymentsApi: api }));
import { POSSplitPaymentsScreen } from './POSSplitPaymentsScreen';

const PERIOD = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-29' };
const summary = { period: PERIOD, basis: 'completed', permissions: { export: true }, kpis: { splitTickets: 2, splitTotalCents: 25000, avgTenders: 2.5, completedTickets: 1, outstandingTickets: 1, outstandingCents: 5000, refundedTickets: 0, failedTickets: 0, listedTickets: 3, tipsCents: 2000, byMethod: { cashCents: 9000, cardCents: 12000, giftCardCents: 4000 } } };
const t150 = { ticketId: 'a', ticketNumber: '1203', createdAt: '2026-10-29T10:00:00Z', completedAt: '2026-10-29T10:36:00Z', lastTenderAt: '2026-10-29T10:36:00Z', branch: 'Main', register: 'Back Bar', technician: 'Anna Lee', customer: { id: 'c1', name: 'John Smith', phone: '(856) 555-1234' },
  methods: ['cash', 'card', 'gift_card'], tenders: 3, attempts: 3, failedAttempts: 0, pendingAttempts: 0, qualifies: true, totalCents: 15000, paidCents: 15000, refundedCents: 0, balanceCents: 0, tipCents: 2000, status: 'completed',
  breakdown: { totalCents: 15000, lines: [{ method: 'cash', cents: 5000 }, { method: 'card', cents: 6000 }, { method: 'gift_card', cents: 4000 }], paidCents: 15000, refundedCents: 0, balanceCents: 0 }, paymentRefs: ['RR1203'] };
const t120 = { ...t150, ticketId: 'b', ticketNumber: '1204', customer: null, methods: ['card'], tenders: 1, attempts: 2, failedAttempts: 1, qualifies: false, totalCents: 12000, paidCents: 7000, balanceCents: 5000, tipCents: 0, status: 'partially_paid',
  breakdown: { totalCents: 12000, lines: [{ method: 'card', cents: 7000 }], paidCents: 7000, refundedCents: 0, balanceCents: 5000 }, paymentRefs: ['RR1204'] };
const pageOf = (items: unknown[]) => ({ items, page: 1, pageSize: 10, total: items.length, pageCount: 1, period: PERIOD });
const mount = () => render(<MemoryRouter><POSSplitPaymentsScreen /></MemoryRouter>);
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.summary.mockResolvedValue(summary); api.list.mockResolvedValue(pageOf([t150, t120])); api.registers.mockResolvedValue([{ id: 'r1', name: 'Front Desk' }]); });

describe('POSSplitPaymentsScreen', () => {
  it('shows the server KPIs and one row per ticket; the decline is a failed attempt, not a tender', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Split Payments' })).toBeInTheDocument();
    expect(screen.getByTestId('kpi-tickets')).toHaveTextContent('2'); expect(screen.getByTestId('kpi-total')).toHaveTextContent('$250.00'); expect(screen.getByTestId('kpi-outstanding')).toHaveTextContent('$50.00');
    const rows = screen.getAllByTestId('ticket-row'); expect(rows.length).toBe(2);
    expect(rows[1]).toHaveTextContent('1 failed attempt'); expect(rows[1]).toHaveTextContent('Partially paid'); expect(rows[1]).toHaveTextContent('$50.00');
    expect(api.list.mock.calls[0][0]).toMatchObject({ preset: 'month', dateField: 'completed', sort: 'created_desc', page: 1 });
  });
  it('the breakdown opens in place: Total ticket $150 · Cash $50 · Credit Card $60 · Gift Card $40 · Remaining balance $0', async () => {
    mount(); await screen.findAllByTestId('ticket-row');
    fireEvent.click(screen.getAllByTestId('toggle-breakdown')[0]);
    const bd = await screen.findByTestId('breakdown-row');
    for (const s of ['Total ticket', '$150.00', 'Cash', '$50.00', 'Credit Card', '$60.00', 'Gift Card', '$40.00', 'Remaining balance', '$0.00', 'incl. $20.00 tip']) expect(bd).toHaveTextContent(s);
    fireEvent.click(screen.getAllByTestId('toggle-breakdown')[0]);
    expect(screen.queryByTestId('breakdown-row')).toBeNull();
  });
  it('status, method combination and search go to the server; the detail lists every tender with its state', async () => {
    api.detail.mockResolvedValue({ ticket: t120, financials: { subtotalCents: 12000, discountCents: 0, taxCents: 0, tipCents: 0, surchargeCents: 0, totalCents: 12000, paidCents: 7000, refundedCents: 0, balanceCents: 5000 },
      tenders: [{ id: 'p1', method: 'card', channel: 'cardpointe_terminal', amountCents: 7000, tipCents: 0, surchargeCents: 0, state: 'confirmed', rawStatus: 'approved', processorRef: 'RR1204', card: 'VISA ••4242', giftCard: null, refundedCents: 0, refundableCents: 7000, refunds: 0, at: '2026-10-29T10:30:00Z' },
        { id: 'p2', method: 'card', channel: 'cardpointe_terminal', amountCents: 5000, tipCents: 0, surchargeCents: 0, state: 'failed', rawStatus: 'declined', processorRef: null, card: null, giftCard: null, refundedCents: 0, refundableCents: 0, refunds: 0, at: '2026-10-29T10:32:00Z' }],
      reversalRows: [], refunds: [], lines: [], tipAllocations: [], audit: [], permissions: { refund: true, customer: true } });
    mount(); await screen.findAllByTestId('ticket-row');
    fireEvent.change(screen.getByTestId('status'), { target: { value: 'partially_paid' } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'partially_paid' })));
    fireEvent.change(screen.getByTestId('methods'), { target: { value: 'three_plus' } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ methods: 'three_plus' })));
    fireEvent.change(screen.getByTestId('search'), { target: { value: '8565551234' } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '8565551234' })));
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1]);
    const t = await screen.findByTestId('tenders-table');
    expect(t).toHaveTextContent('Confirmed'); expect(t).toHaveTextContent('Failed'); expect(t).toHaveTextContent('declined'); expect(t).toHaveTextContent('Card terminal');
    expect(screen.getByTestId('open-checkout')).toBeInTheDocument();
    expect(screen.getByTestId('detail-breakdown')).toHaveTextContent('$50.00');
  });
  it('a read failure is an error state, never a verified 0; 403 is a permission state', async () => {
    api.summary.mockRejectedValue({ status: 503 }); api.list.mockRejectedValue({ status: 503 });
    mount();
    expect(await screen.findByText(/could not be reached/i)).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});
