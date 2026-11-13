// Payments → Split Payments (Oct 29 2026 one-screen rebuild): one row per ticket with its PAYMENT BREAKDOWN in place
// (Total · Cash · Credit Card · Gift Card · Remaining balance), server KPIs, server filters, a declined attempt never a tender.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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
    expect((await screen.findAllByText(/could not be reached/i)).length).toBeGreaterThan(0);   // each card says so (summary and list)
    expect(screen.queryByText('$0.00')).toBeNull();
  });
  it('Split Payments 17: a failed REFRESH keeps the last figures for the same query, labelled read-only with their time; Export and Finish at checkout pause; Retry that succeeds clears it', async () => {
    api.detail.mockResolvedValue({ ticket: t120, financials: { subtotalCents: 12000, discountCents: 0, taxCents: 0, tipCents: 0, surchargeCents: 0, totalCents: 12000, paidCents: 7000, refundedCents: 0, balanceCents: 5000 },
      tenders: [], reversalRows: [], refunds: [], lines: [], tipAllocations: [], audit: [], permissions: { refund: true, customer: true } });
    mount(); await screen.findAllByTestId('ticket-row');
    expect(screen.queryByTestId('readonly-banner')).toBeNull();
    expect(screen.getByTestId('export')).not.toBeDisabled();
    api.summary.mockRejectedValue({ status: 503 }); api.list.mockRejectedValue({ status: 503 });
    fireEvent.click(screen.getByTestId('refresh'));
    const banner = await screen.findByTestId('readonly-banner');
    expect(banner).toHaveTextContent('Read-only'); expect(banner).toHaveTextContent(/were read at/); expect(banner).toHaveTextContent('paused');
    expect(screen.getAllByTestId('ticket-row').length).toBe(2);                     // last-known rows, not a blank
    expect(screen.getByTestId('kpi-total')).toHaveTextContent('$250.00');            // last-known KPIs, never a fresh-looking 0
    expect(screen.getByTestId('export')).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1]);
    expect(await screen.findByTestId('open-checkout')).toBeDisabled();
    { const cl = screen.getAllByRole('button', { name: 'Close' }); fireEvent.click(cl[cl.length - 1]); }
    api.summary.mockResolvedValue(summary); api.list.mockResolvedValue(pageOf([t150, t120]));
    fireEvent.click(screen.getByTestId('readonly-retry'));
    await waitFor(() => expect(screen.queryByTestId('readonly-banner')).toBeNull());
    expect(screen.getByTestId('export')).not.toBeDisabled();
  });
  it('Split Payments 17: a failure for a DIFFERENT query is an error (old rows would not answer it), still read-only', async () => {
    mount(); await screen.findAllByTestId('ticket-row');
    api.list.mockRejectedValue({ status: 503 });
    fireEvent.change(screen.getByTestId('status'), { target: { value: 'partially_paid' } });
    expect(await screen.findByTestId('readonly-banner')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId('ticket-row').length).toBe(0));
    expect(screen.getAllByText(/could not be reached/i).length).toBeGreaterThan(0);
  });
  it('Split Payments 05: the detail shows the server\'s cross-module check per module with its own state; nothing to press', async () => {
    api.detail.mockResolvedValue({ ticket: t150, financials: { subtotalCents: 13000, discountCents: 0, taxCents: 0, tipCents: 2000, surchargeCents: 0, totalCents: 15000, paidCents: 15000, refundedCents: 0, balanceCents: 0 },
      tenders: [], reversalRows: [], refunds: [], lines: [], tipAllocations: [], audit: [], permissions: { refund: true, customer: true },
      crossModule: { giftCards: { tenderCents: 4000, ledgerCents: 0, state: 'differs' }, tips: { ticketTipCents: 2000, allocatedCents: 0, state: 'unallocated' },
        cash: [{ paymentId: 'p9', amountCents: 5000, businessDate: '2026-10-28', closeout: 'counted' }], checkout: { ticketPaid: true, dueCents: 0, state: 'aligned' }, note: 'read_only_no_money_moved' } });
    mount(); await screen.findAllByTestId('ticket-row');
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]);
    const xm = await screen.findByTestId('sp-xm');
    expect(screen.getByTestId('sp-xm-gift')).toHaveTextContent('Differs'); expect(screen.getByTestId('sp-xm-gift')).toHaveTextContent('Gift-card tenders $40.00 · gift-card ledger redemptions $0.00');
    expect(screen.getByTestId('sp-xm-tips')).toHaveTextContent('Not split yet'); expect(screen.getByTestId('sp-xm-tips')).toHaveTextContent('$20.00');
    expect(screen.getByTestId('sp-xm-cash')).toHaveTextContent('Drawer counted'); expect(screen.getByTestId('sp-xm-cash')).toHaveTextContent('Cash $50.00 on 2026-10-28');
    expect(screen.getByTestId('sp-xm-checkout')).toHaveTextContent('Aligned');
    expect(xm.querySelectorAll('button')).toHaveLength(0);
  });
  it('pending payment banner: shows only when card attempts are still waiting; says they are not counted as paid', async () => {
    mount(); await screen.findAllByTestId('ticket-row');
    expect(screen.queryByTestId('pending-banner')).toBeNull();
    cleanup();
    api.summary.mockResolvedValue({ ...summary, kpis: { ...summary.kpis, pendingAttemptTickets: 2 } });
    mount();
    expect(await screen.findByTestId('pending-banner')).toHaveTextContent(/2 ticket\(s\).*not counted as paid/);
  });
  it('Split Payments 13: the detail lists each duplicate-event finding per tender with no erase action; a clean ticket says so', async () => {
    const base = { ticket: t120, financials: { subtotalCents: 12000, discountCents: 0, taxCents: 0, tipCents: 0, surchargeCents: 0, totalCents: 12000, paidCents: 7000, refundedCents: 0, balanceCents: 5000 },
      tenders: [{ id: 'p1', method: 'card', channel: null, amountCents: 7000, tipCents: 0, surchargeCents: 0, state: 'confirmed', rawStatus: 'approved', processorRef: 'RR9', card: null, giftCard: null, refundedCents: 0, refundableCents: 7000, refunds: 0, at: '2026-10-29T10:30:00Z' }],
      reversalRows: [], refunds: [], lines: [], tipAllocations: [], audit: [], permissions: { refund: false, customer: false } };
    api.detail.mockResolvedValue({ ...base, duplicateEvents: { checkedTenders: 1, findings: [{ paymentId: 'p1', kind: 'repeated_callbacks', count: 2, ref: 'RR9' }, { paymentId: 'p1', kind: 'duplicate_drawer_posting', count: 2, ref: null }] } });
    mount(); await screen.findAllByTestId('ticket-row');
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]);
    const box = await screen.findByTestId('sp-dup');
    const rows = screen.getAllByTestId('sp-dup-row');
    expect(rows[0]).toHaveTextContent('Repeated processor callback'); expect(rows[0]).toHaveTextContent('$70.00 — 2'); expect(rows[0]).toHaveTextContent('RR9');
    expect(rows[1]).toHaveTextContent('Posted twice to cash drawer');
    expect(box.querySelectorAll('button')).toHaveLength(0);
    api.detail.mockResolvedValue({ ...base, duplicateEvents: { checkedTenders: 1, findings: [] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1]);
    expect(await screen.findByTestId('sp-dup-none')).toHaveTextContent('across 1 tender(s)');
  });
});
