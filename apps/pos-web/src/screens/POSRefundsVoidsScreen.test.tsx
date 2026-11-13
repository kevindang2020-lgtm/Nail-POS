// Payments & Money → Refunds & Voids (Oct 29 2026 one-screen rebuild): five server KPIs, one row per reversal, server filters,
// Find Original Payment with each tender's refundable amount and eligibility, a refund of ONE tender through Checkout.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), facets: vi.fn(), find: vi.fn(), detail: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posRefundsVoidsApi', () => ({ posRefundsVoidsApi: api }));
const co = vi.hoisted(() => ({ refund: vi.fn(), void: vi.fn() }));
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: co }));
const rt = vi.hoisted(() => ({ subs: [] as Array<{ screen: unknown; cb: () => void; opts: unknown }> }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: (screen: unknown, cb: () => void, opts: unknown) => { rt.subs.push({ screen, cb, opts }); } }));
import { POSRefundsVoidsScreen } from './POSRefundsVoidsScreen';

const PERIOD = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-29' };
const summary = { period: PERIOD, basis: 'requested', permissions: { refund: true, void: true, export: true, customer: true },
  kpis: { refunds: 3, refundedCents: 8000, partialRefunds: 2, voids: 1, voidedCents: 4500, totalReversed: 4, totalReversedCents: 12500, pending: 1, pendingCents: 2000, needsReview: 2, needsReviewCents: 7500, unknown: 1, failed: 1, cancelled: 0, listed: 7, byMethod: {} } };
const rev = { id: 'r1aaaaaa-0000-4000-8000-000000000001', kind: 'refund', type: 'partial_refund', state: 'pending', rawStatus: 'reserved', requestedAt: '2026-10-29T13:00:00Z', completedAt: null, paymentId: 'p1', reversalPaymentId: null, ticketId: 't1', ticketNumber: '6001',
  customer: { id: 'c1', name: 'John Smith', phone: '(856) 555-1234' }, originalCents: 10000, reversedCents: 2000, method: 'card', processor: 'cardpointe', providerRef: null, originalRef: 'RR6001', card: 'VISA ••4242', giftCardLast4: null, reason: 'Goodwill', actor: 'Mai', reviewReason: null, lastError: null, settlementId: null, branch: null, register: null, originalAt: null };
const tender = { id: 'p1', ticketId: 't1', ticketNumber: '6001', method: 'card', amountCents: 10000, tipCents: 0, status: 'approved', captured: true, processor: 'cardpointe', processorRef: 'RR6001', card: 'VISA ••4242', giftCardLast4: null, at: '2026-10-26T12:00:00Z',
  refundedCents: 3000, pendingCents: 2000, refundableCents: 5000, settlementId: 's1', customer: { id: 'c1', name: 'John Smith', phone: '(856) 555-1234' }, eligibility: { refund: true, refundWhy: null, void: false, voidWhy: 'already_refunded' } };
const mount = () => render(<MemoryRouter><POSRefundsVoidsScreen /></MemoryRouter>);
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); Object.values(co).forEach((f) => f.mockReset());
  api.summary.mockResolvedValue(summary); api.list.mockResolvedValue({ items: [rev], page: 1, pageSize: 10, total: 1, pageCount: 1, period: PERIOD }); api.facets.mockResolvedValue({ processors: ['cardpointe'], registers: [] }); });

describe('POSRefundsVoidsScreen', () => {
  it('shows the five server KPIs and one row per reversal; filters go to the server', async () => {
    mount();
    expect(await screen.findByTestId('kpi-refunds')).toHaveTextContent('$80.00'); expect(screen.getByTestId('kpi-total')).toHaveTextContent('$125.00'); expect(screen.getByTestId('kpi-review')).toHaveTextContent('2');
    expect(screen.getByTestId('reversal-row')).toHaveTextContent('Partial refund'); expect(screen.getByTestId('reversal-row')).toHaveTextContent('Pending');
    fireEvent.change(screen.getByTestId('type'), { target: { value: 'void' } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'void', preset: 'month', dateField: 'requested', page: 1 })));
  });
  it('Find Original Payment refunds ONE tender, capped at what it can still return, through Checkout with a key', async () => {
    api.find.mockResolvedValue({ query: '6001', period: PERIOD, items: [tender] }); co.refund.mockResolvedValue({ status: 'refunded', refundId: 'x' });
    mount(); await screen.findByTestId('reversal-row');
    fireEvent.click(screen.getByTestId('find-payment')); fireEvent.change(screen.getByTestId('find-query'), { target: { value: '#6001' } });
    fireEvent.click(await screen.findByTestId('find-refund'));
    expect(screen.getByTestId('refund-amount')).toHaveValue('50.00'); expect(screen.queryByTestId('find-void')).toBeNull();
    fireEvent.change(screen.getByTestId('refund-amount'), { target: { value: '60' } }); expect(screen.getByTestId('review-refund')).toBeDisabled();
    fireEvent.change(screen.getByTestId('refund-amount'), { target: { value: '10' } }); fireEvent.change(screen.getByTestId('refund-reason'), { target: { value: 'Chipped' } });
    fireEvent.click(screen.getByTestId('review-refund')); fireEvent.click(screen.getByTestId('confirm-refund'));
    await waitFor(() => expect(co.refund).toHaveBeenCalledWith('p1', { reason: 'Chipped', amountCents: 1000 }, expect.any(String)));
    expect(await screen.findByTestId('note')).toHaveTextContent('Refund of $10.00 completed.');
  });
  it('REFUNDS 05: the review step previews the customer refund receipt (proposed, not sent); nothing goes out before Confirm', async () => {
    api.find.mockResolvedValue({ query: '6001', period: PERIOD, items: [tender] }); co.refund.mockResolvedValue({ status: 'approval_pending' });
    mount(); await screen.findByTestId('reversal-row');
    fireEvent.click(screen.getByTestId('find-payment')); fireEvent.change(screen.getByTestId('find-query'), { target: { value: '#6001' } });
    fireEvent.click(await screen.findByTestId('find-refund'));
    expect(screen.queryByTestId('refund-receipt-preview')).toBeNull();
    fireEvent.change(screen.getByTestId('refund-amount'), { target: { value: '12.50' } }); fireEvent.change(screen.getByTestId('refund-reason'), { target: { value: 'Chipped' } });
    fireEvent.click(screen.getByTestId('review-refund'));
    const p = screen.getByTestId('refund-receipt-preview');
    expect(p).toHaveTextContent('Proposed · not sent'); expect(p).toHaveTextContent('#6001'); expect(p).toHaveTextContent('John Smith');
    expect(p).toHaveTextContent('VISA ••4242 · $100.00'); expect(p).toHaveTextContent('Partial refund of this payment');
    expect(screen.getByTestId('rcpt-amount')).toHaveTextContent('−$12.50');
    expect(p).toHaveTextContent('The original card (Card)');
    expect(screen.getByTestId('rcpt-left')).toHaveTextContent('$37.50');                       // 50.00 refundable − 12.50
    expect(screen.getByTestId('rcpt-note')).toHaveTextContent('Nothing is sent, printed or saved until you confirm');
    expect(screen.getByTestId('refund-actor')).toHaveTextContent(/Acting: .* · Salon: /);   // extras PAYMENTS 14: actor + salon on the review
    expect(co.refund).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-refund'));
    await waitFor(() => expect(co.refund).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('note')).not.toHaveTextContent('completed');               // the final answer is the server's
  });
  it('a lost processor answer is said plainly and never retried', async () => {
    api.find.mockResolvedValue({ query: '6001', period: PERIOD, items: [tender] }); co.refund.mockRejectedValue(Object.assign(new Error('lost'), { status: 409, body: { code: 'REFUND_STATUS_UNKNOWN' } }));
    mount(); await screen.findByTestId('reversal-row');
    fireEvent.click(screen.getByTestId('find-payment')); fireEvent.change(screen.getByTestId('find-query'), { target: { value: '#6001' } });
    fireEvent.click(await screen.findByTestId('find-refund')); fireEvent.change(screen.getByTestId('refund-reason'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('review-refund')); fireEvent.click(screen.getByTestId('confirm-refund'));
    expect(await screen.findByTestId('note')).toHaveTextContent(/answer was lost/); expect(co.refund).toHaveBeenCalledTimes(1);
  });
  it('a read failure is an error state, never a verified $0.00', async () => {
    api.summary.mockRejectedValue({ status: 503 }); api.list.mockRejectedValue({ status: 503 });
    mount(); expect((await screen.findAllByText(/could not be reached/i)).length).toBeGreaterThan(0); expect(screen.queryByTestId('kpi-refunds')).toBeNull();
  });
  it('REFUNDS 06: the Escalation Inbox lists the server groups and opens the existing detail; it never calls a Checkout action', async () => {
    api.summary.mockResolvedValue({ ...summary, escalations: { total: 2, stalePendingHours: 24, groups: [
      { key: 'provider_timeout', count: 1, cents: 2500, oldestAt: '2026-10-20T21:00:00Z', items: [{ id: 'r4', kind: 'refund', ticketNumber: '3004', reversedCents: 2500, requestedAt: '2026-10-20T21:00:00Z', reviewReason: 'processor_status_unavailable' }] },
      { key: 'stale_pending', count: 1, cents: 2000, oldestAt: null, items: [{ id: 'r1b', kind: 'refund', ticketNumber: '3001', reversedCents: 2000, requestedAt: null, reviewReason: null }] },
      { key: 'broken_link', count: 0, cents: 0, oldestAt: null, items: [] }] } });
    api.detail.mockResolvedValue(null);
    mount();
    fireEvent.click(await screen.findByTestId('rv-escalations'));
    expect(screen.getByTestId('rv-escalations')).toHaveTextContent('Escalations · 2');
    expect(screen.getByTestId('rv-esc-provider_timeout')).toHaveTextContent('Processor answer lost · 1 · $25.00');
    expect(screen.getByTestId('rv-esc-provider_timeout')).toHaveTextContent('Processor status unavailable');
    expect(screen.getByTestId('rv-esc-stale_pending')).toHaveTextContent('Pending over 24 hours');
    expect(screen.getByTestId('rv-esc-broken_link')).toHaveTextContent('· 0');
    fireEvent.click(screen.getAllByTestId('rv-esc-item')[0]);
    await waitFor(() => expect(api.detail).toHaveBeenCalledWith('refund', 'r4'));
    expect(screen.queryByTestId('rv-esc-dialog')).toBeNull();
    expect(co.refund).not.toHaveBeenCalled(); expect(co.void).not.toHaveBeenCalled();
  });
  it('Extras REFUNDS & VOIDS 10: the detail shows the server root-cause summary — cause, evidence with its records, next step; the processor error text is never echoed; nothing is retried', async () => {
    const stuck = { ...rev, state: 'needs_review', rawStatus: 'processing', reviewReason: 'processor_status_unavailable', lastError: 'GATEWAY 504 raw text' };
    api.detail.mockResolvedValue({ reversal: stuck, original: tender, tenders: [], refunds: [], giftLedger: [], settlement: null, financials: null, tipAllocations: [], loyalty: [], audit: [], permissions: { refund: true, void: true, customer: true },
      rootCause: { exception: true, cause: 'provider_timeout', nextStep: 'verify_with_processor', readOnly: true, basis: 'x', evidence: [
        { code: 'raw_status', value: 'processing', sourceType: 'payment_refund', sourceId: stuck.id },
        { code: 'review_reason', value: 'processor_status_unavailable', sourceType: 'payment_refund', sourceId: stuck.id },
        { code: 'last_error', value: 'GATEWAY 504 raw text', sourceType: 'payment_refund', sourceId: stuck.id },
        { code: 'provider_ref_missing', value: null, sourceType: 'payment_refund', sourceId: stuck.id },
        { code: 'ticket_link', value: '6001', sourceType: 'ticket', sourceId: 't1' },
        { code: 'waiting_hours', value: 30, sourceType: 'payment_refund', sourceId: stuck.id }] } });
    mount(); fireEvent.click(within(await screen.findByTestId('reversal-row')).getByRole('button'));
    const rc = await screen.findByTestId('rv-root-cause');
    expect(rc).toHaveTextContent('Root cause from the ledger: Processor answer lost');
    expect(screen.getAllByTestId('rv-rc-ev').map((e) => e.textContent)).toEqual(['Recorded status: processing', 'Review reason: Processor status unavailable', 'The processor returned an error', 'No processor refund reference', 'Ticket: #6001', 'Waiting for: 30 h']);
    expect(screen.getByTestId('rv-rc-next')).toHaveTextContent('Confirm the result with the processor');
    expect(rc).not.toHaveTextContent('GATEWAY 504');
    expect(co.refund).not.toHaveBeenCalled(); expect(co.void).not.toHaveBeenCalled();
  });
  it('Extras REFUNDS & VOIDS 10: a healthy reversal shows no root-cause panel', async () => {
    api.detail.mockResolvedValue({ reversal: { ...rev, state: 'completed', rawStatus: 'refunded' }, original: tender, tenders: [], refunds: [], giftLedger: [], settlement: null, financials: null, tipAllocations: [], loyalty: [], audit: [], permissions: {},
      rootCause: { exception: false, cause: null, nextStep: null, readOnly: true, basis: 'x', evidence: [{ code: 'raw_status', value: 'refunded', sourceType: 'payment_refund', sourceId: rev.id }] } });
    mount(); fireEvent.click(within(await screen.findByTestId('reversal-row')).getByRole('button'));
    await screen.findByTestId('reversal-facts');
    expect(screen.queryByTestId('rv-root-cause')).toBeNull();
  });
  it('Extras REFUNDS & VOIDS 08: listens on the existing "reports" refresh routing (events only, no timer); a confirmed reversal elsewhere reloads the ledger and the KPIs in place', async () => {
    rt.subs.length = 0;
    mount();
    expect(await screen.findByTestId('reversal-row')).toBeInTheDocument();
    const sub = rt.subs[rt.subs.length - 1];
    expect(sub.screen).toBe('reports'); expect(sub.opts).toEqual({ intervalMs: 0, hiddenMs: 0 });
    const l = api.list.mock.calls.length, s0 = api.summary.mock.calls.length;
    api.summary.mockResolvedValue({ ...summary, kpis: { ...summary.kpis, refundedCents: 9500 } });
    sub.cb();
    await waitFor(() => expect(screen.getByTestId('kpi-refunds')).toHaveTextContent('$95.00'));
    expect(api.list.mock.calls.length).toBe(l + 1); expect(api.summary.mock.calls.length).toBe(s0 + 1);
    expect(screen.getByTestId('reversal-row')).toBeInTheDocument();   // the rows stayed on screen while it reloaded
  });
});
