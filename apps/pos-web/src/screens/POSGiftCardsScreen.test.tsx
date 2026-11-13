// Customers → Gift Cards (Oct 29 2026 one-screen rebuild): the KPIs are the server's (over every card), the list shows only
// MASKED identifiers, search/status/sort go to the server, the detail shows the ledger ($100 card · $65 service · $35 left),
// Issue is payment-first with one idempotency key (a double tap never makes two cards) and Void needs a reason.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const gc = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), detail: vi.fn(), ledger: vi.fn(), exportCsv: vi.fn(), issue: vi.fn(), reload: vi.fn(), voidCard: vi.fn(), adjust: vi.fn(), liability: vi.fn() }));
const co = vi.hoisted(() => ({ giftCardLookup: vi.fn() }));
const cust = vi.hoisted(() => ({ quickSearch: vi.fn() }));
const settings = vi.hoisted(() => ({ getCategory: vi.fn() }));
vi.mock('../api/posGiftCardsApi', () => ({ posGiftCardsApi: gc }));
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: co }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: cust }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: settings }));
vi.mock('./access/accessUi', () => ({ useStepUp: () => ({ run: (fn: () => Promise<unknown>) => fn(), prompt: null }), isStepUpCancelled: () => false }));
import { POSGiftCardsScreen } from './POSGiftCardsScreen';

const PERIOD = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-29' };
const card = (o: Record<string, unknown> = {}) => ({ id: 'g1', card: '•••• 4821', reference: 'GC-****-AB12', status: 'partially_redeemed', spendable: true, originalCents: 10000, balanceCents: 3500, issuedAt: '2026-10-20T15:00:00Z',
  createdAt: '2026-10-20T15:00:00Z', lastActivityAt: '2026-10-25T15:00:00Z', lastRedeemedAt: '2026-10-25T15:00:00Z', expiresAt: null, purchaser: { id: 'c1', name: 'Anna Lee', phone: '(•••) •••-1234', email: null },
  recipient: { name: 'Mai Tran', phone: null, email: null, customerId: null }, delivery: 'digital', hasPin: false, branch: 'Main', saleTicketId: 't0', ...o });
const summary = { period: PERIOD, permissions: { issue: true, balance: true, void: true, export: true },
  kpis: { outstandingLiabilityCents: 3500, activeCards: 1, totalCards: 3, pendingPaymentCards: 0, redeemedCards: 1, closedCards: 1, totalIssuedCents: 20000, issuedCards: 2, reloadedCents: 0, redeemedValueCents: 6500, redemptions: 1, refundedBackCents: 0 } };
const pageOf = (items: unknown[]) => ({ items, page: 1, pageSize: 10, total: items.length, pageCount: 1, period: PERIOD });
const mount = () => render(<MemoryRouter><POSGiftCardsScreen /></MemoryRouter>);

beforeEach(() => {
  for (const g of [gc, co, cust, settings]) Object.values(g).forEach((f) => f.mockReset());
  gc.summary.mockResolvedValue(summary); gc.list.mockResolvedValue(pageOf([card()])); gc.liability.mockRejectedValue({ status: 403 });
});

describe('POSGiftCardsScreen', () => {
  it('shows the server KPIs and only masked card identifiers', async () => {
    mount();
    expect(await screen.findByText('•••• 4821')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-liability')).toHaveTextContent('$35.00');
    expect(screen.getByTestId('kpi-redeemed')).toHaveTextContent('$65.00');
    expect(screen.getByTestId('kpi-total')).toHaveTextContent('3');
    expect(screen.getByText('Mai Tran')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b\d{16}\b/);
    expect(gc.list.mock.calls[0][0]).toMatchObject({ preset: 'all', dateField: 'issued', sort: 'issued_desc', page: 1 });
  });
  it('trust & freshness: the KPIs name their data source next to the as-of time, and Issued drills into the ledger', async () => {
    mount();
    expect(await screen.findByTestId('giftcards-source')).toHaveTextContent(/transaction ledger/);
    expect(screen.getByTestId('giftcards-fresh')).toBeInTheDocument();
    const k = screen.getByTestId('kpi-issued'); fireEvent.click(k.querySelector('button') ?? k);
    await waitFor(() => expect(gc.liability).toHaveBeenCalled());
  });
  it('GIFT CARDS · 03 ledger check: all cards reconcile → a quiet line; a drifted card is named (masked) and opens its detail', async () => {
    gc.summary.mockResolvedValue({ ...summary, integrity: { checkedCards: 3, unreconciledCards: 0, capped: false, sample: [] } });
    const v = mount();
    expect(await screen.findByTestId('gc-integrity')).toHaveTextContent(/all 3 paid cards match/);
    v.unmount();
    gc.summary.mockResolvedValue({ ...summary, integrity: { checkedCards: 3, unreconciledCards: 1, capped: false, sample: [{ cardId: 'g9', card: '•••• 7777', balanceCents: 4200, ledgerBalanceCents: 3500 }] } });
    gc.detail.mockResolvedValue({ card: card({ id: 'g9', card: '•••• 7777' }), permissions: { void: false, reload: false },
      totals: { originalCents: 3500, reloadedCents: 0, redeemedCents: 0, refundedBackCents: 0, adjustedCents: 0, transferredCents: 0, pendingReloadCents: 0, balanceCents: 4200, transactions: 1, ledgerBalanceCents: 3500, reconciled: false } });
    gc.ledger.mockResolvedValue(pageOf([]));
    mount();
    const note = await screen.findByTestId('gc-integrity');
    expect(note).toHaveTextContent(/1 card\(s\) have a balance that does not match/);
    const btn = screen.getByTestId('gc-integrity-card');
    expect(btn).toHaveTextContent('•••• 7777'); expect(btn.getAttribute('title')).toMatch(/\$42\.00.*\$35\.00/);
    fireEvent.click(btn);
    await waitFor(() => expect(gc.detail).toHaveBeenCalledWith('g9'));
    expect(gc.adjust).not.toHaveBeenCalled();
  });
  it('GIFT CARDS extras 08: duplicate / double-spend alerts name each kind and card; a clean ledger shows no alert', async () => {
    gc.summary.mockResolvedValue({ ...summary, duplicates: { total: 0, capped: false, counts: { repeatedPayment: 0, overlappingRedemption: 0, multipleActivation: 0, activatedWhilePending: 0 }, sample: [] } });
    const v = mount();
    await screen.findByTestId('kpis');
    await waitFor(() => expect(gc.summary).toHaveBeenCalled());
    expect(screen.queryByTestId('gc-duplicates')).toBeNull();
    v.unmount();
    gc.summary.mockResolvedValue({ ...summary, duplicates: { total: 2, capped: false, counts: { repeatedPayment: 1, overlappingRedemption: 0, multipleActivation: 1, activatedWhilePending: 0 },
      sample: [{ kind: 'repeatedPayment', cardId: 'g7', card: '•••• 2222', ledgerIds: ['t1', 't2'], amountCents: 6000, at: null }, { kind: 'multipleActivation', cardId: 'g8', card: '•••• 4444', ledgerIds: ['t3', 't4'], amountCents: 20000, at: null }] } });
    gc.detail.mockResolvedValue({ card: card({ id: 'g7', card: '•••• 2222' }), permissions: { void: false, reload: false },
      totals: { originalCents: 10000, reloadedCents: 0, redeemedCents: 6000, refundedBackCents: 0, adjustedCents: 0, transferredCents: 0, pendingReloadCents: 0, balanceCents: 4000, transactions: 3, ledgerBalanceCents: 4000, reconciled: true } });
    gc.ledger.mockResolvedValue(pageOf([]));
    mount();
    const note = await screen.findByTestId('gc-duplicates');
    expect(note).toHaveTextContent('2 possible duplicate or double-spend alert(s)');
    expect(note).toHaveTextContent('1 payment used for more than one redemption · 1 card activated more than once');
    expect(note).not.toHaveTextContent(/within 60 seconds|awaiting payment/);   // zero-count kinds are not listed
    const btns = screen.getAllByTestId('gc-duplicate-card');
    expect(btns.map((b) => b.textContent)).toEqual(['•••• 2222', '•••• 4444']);
    expect(btns[0].getAttribute('title')).toMatch(/\$60\.00 across 2 ledger rows/);
    fireEvent.click(btns[0]);
    await waitFor(() => expect(gc.detail).toHaveBeenCalledWith('g7'));
    expect(gc.adjust).not.toHaveBeenCalled();
  });
  it('closeout check (extras 12): the server comparison for the period — match line, unpartnered rows, liability parts; read-only', async () => {
    const none = { count: 0, capped: false, sample: [] };
    const clean = { redemptions: { ledgerCents: 700, ledgerRows: 1, tenderCents: 700, tenders: 1, differenceCents: 0, withoutTender: none, withoutLedger: none },
      issuance: { ledgerCents: 0, ledgerRows: 0, withoutPaidSale: none },
      liability: { issuedCents: 0, reloadedCents: 0, redeemedCents: 700, refundedBackCents: 0, otherAdjustmentsCents: 0, expiredCents: 0, netChangeCents: -700 }, basis: 'all_time' };
    gc.summary.mockResolvedValue({ ...summary, closeout: clean });
    const v = mount();
    expect(await screen.findByTestId('gc-closeout')).toHaveTextContent('Closeout check (all time): gift-card redemptions $7.00 on the ledger vs $7.00 gift-card tenders taken. They match.');
    v.unmount();
    gc.summary.mockResolvedValue({ ...summary, period: { ...PERIOD, preset: 'today', from: '2026-10-29', to: '2026-10-29' }, closeout: {
      redemptions: { ledgerCents: 7000, ledgerRows: 4, tenderCents: 6000, tenders: 4, differenceCents: -1000,
        withoutTender: { count: 1, capped: false, sample: [{ ledgerId: 'l1', cardId: 'g7', card: '•••• 1111', amountCents: 2500, at: '2026-10-29T16:00:00Z' }] },
        withoutLedger: { count: 1, capped: false, sample: [{ paymentId: 'p4abcdef-0000', amountCents: 1500, at: '2026-10-29T20:00:00Z' }] } },
      issuance: { ledgerCents: 25000, ledgerRows: 3, withoutPaidSale: none },
      liability: { issuedCents: 25000, reloadedCents: 2000, redeemedCents: 7000, refundedBackCents: 1000, otherAdjustmentsCents: -500, expiredCents: 4500, netChangeCents: 16000 }, basis: 'period' } });
    gc.detail.mockResolvedValue({ card: card({ id: 'g7', card: '•••• 1111' }), permissions: { void: false, reload: false },
      totals: { originalCents: 10000, reloadedCents: 0, redeemedCents: 5500, refundedBackCents: 0, adjustedCents: 0, transferredCents: 0, pendingReloadCents: 0, balanceCents: 4500, transactions: 3, ledgerBalanceCents: 4500, reconciled: true } });
    gc.ledger.mockResolvedValue(pageOf([]));
    mount();
    const line = await screen.findByTestId('gc-closeout');
    expect(line).toHaveTextContent('Difference −$10.00 · 2 rows to look at.');
    fireEvent.click(screen.getByTestId('gc-closeout-open'));
    const dlg = await screen.findByTestId('dlg-gc-closeout');
    expect(screen.getByTestId('gc-co-diff')).toHaveTextContent('−$10.00');
    expect(screen.getByTestId('gc-co-no-ledger')).toHaveTextContent('Payment p4abcdef · $15.00');
    expect(screen.getByTestId('gc-co-net')).toHaveTextContent('$160.00');
    expect(dlg).toHaveTextContent('Activations with no paid sale ticket: 0');
    fireEvent.click(screen.getByRole('button', { name: '•••• 1111' }));
    await waitFor(() => expect(gc.detail).toHaveBeenCalledWith('g7'));
    expect(gc.adjust).not.toHaveBeenCalled(); expect(gc.voidCard).not.toHaveBeenCalled();
  });
  it('status tab and search go to the server, with chips and Clear All', async () => {
    mount(); await screen.findByText('•••• 4821');
    fireEvent.click(screen.getByTestId('tab-redeemed'));
    await waitFor(() => expect(gc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'redeemed' })));
    fireEvent.change(screen.getByTestId('search'), { target: { value: '8565551234' } });
    await waitFor(() => expect(gc.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '8565551234', status: 'redeemed' })));
    fireEvent.click(screen.getByTestId('clear-all'));
    await waitFor(() => expect(gc.list.mock.calls.slice(-1)[0]![0].status).toBeUndefined());
  });
  it('Gift Cards guide (Nov 4 2026): Pending payment and Frozen are their own tabs', async () => {
    mount(); await screen.findByText('•••• 4821');
    fireEvent.click(screen.getByTestId('tab-pending'));
    await waitFor(() => expect(gc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'pending' })));
    fireEvent.click(screen.getByTestId('tab-frozen'));
    await waitFor(() => expect(gc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'frozen' })));
  });
  it('the detail shows the ledger of a partial redemption ($100 · −$65 · $35 left) and Void needs a reason', async () => {
    gc.detail.mockResolvedValue({ card: card(), permissions: { void: true, reload: true },
      totals: { originalCents: 10000, reloadedCents: 0, redeemedCents: 6500, refundedBackCents: 0, adjustedCents: 0, transferredCents: 0, pendingReloadCents: 0, balanceCents: 3500, transactions: 2, ledgerBalanceCents: 3500, reconciled: true } });
    gc.ledger.mockResolvedValue({ ...pageOf([
      { id: 'l2', type: 'redeem', rawType: 'redeem', amountCents: -6500, balanceBeforeCents: 10000, balanceAfterCents: 3500, at: '2026-10-25T15:00:00Z', actor: 'Kim', ticketNumber: '1043', status: 'completed', reason: null },
      { id: 'l1', type: 'activate', rawType: 'activate', amountCents: 10000, balanceBeforeCents: 0, balanceAfterCents: 10000, at: '2026-10-20T15:00:00Z', actor: 'Kim', ticketNumber: '1040', status: 'completed', reason: null }]) });
    gc.voidCard.mockResolvedValue({});
    mount();
    fireEvent.click(await screen.findByText('•••• 4821'));
    const ledger = await screen.findByTestId('ledger-table');
    expect(ledger).toHaveTextContent('−$65.00'); expect(ledger).toHaveTextContent('$35.00'); expect(ledger).toHaveTextContent('+$100.00');
    fireEvent.click(screen.getByTestId('void'));
    expect(screen.getByTestId('void-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('void-reason'), { target: { value: 'sold in error' } });
    fireEvent.click(screen.getByTestId('void-submit'));
    await waitFor(() => expect(gc.voidCard).toHaveBeenCalledWith('g1', 'sold in error'));
  });
  it('Gift Cards guide (Nov 4 2026): Adjust balance takes off or adds signed cents with a reason', async () => {
    gc.detail.mockResolvedValue({ card: card(), permissions: { void: true, reload: true },
      totals: { originalCents: 10000, reloadedCents: 0, redeemedCents: 6500, refundedBackCents: 0, adjustedCents: 0, transferredCents: 0, pendingReloadCents: 0, balanceCents: 3500, transactions: 2, ledgerBalanceCents: 3500, reconciled: true } });
    gc.ledger.mockResolvedValue(pageOf([]));
    gc.adjust.mockResolvedValue({ cardId: 'g1', amountCents: -1000, beforeCents: 3500, afterCents: 2500, status: 'partially_redeemed' });
    mount();
    fireEvent.click(await screen.findByText('•••• 4821'));
    fireEvent.click(await screen.findByTestId('adjust'));
    fireEvent.change(screen.getByTestId('adjust-amount'), { target: { value: '40.00' } });
    expect(screen.getByTestId('adjust-preview').textContent).toMatch(/cannot take a card below zero/);   // $40 off a $35 card
    fireEvent.change(screen.getByTestId('adjust-amount'), { target: { value: '10.00' } });
    expect(screen.getByTestId('adjust-preview').textContent).toMatch(/Balance now \$35\.00 · change −\$10\.00 · balance after \$25\.00/);
    expect(screen.getByTestId('adjust-preview').textContent).toMatch(/Not linked to a ticket/);
    expect(screen.getByTestId('adjust-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('adjust-reason'), { target: { value: 'charged twice' } });
    fireEvent.click(screen.getByTestId('adjust-submit'));
    await waitFor(() => expect(gc.adjust).toHaveBeenCalledWith('g1', { amountCents: -1000, reason: 'charged twice' }));
    expect(await screen.findByText(/balance now \$25\.00/)).toBeInTheDocument();
  });
  it('Issue needs a purchaser, sends cents with one idempotency key, and shows the digital number once', async () => {
    settings.getCategory.mockResolvedValue({ enabled: true, posSalesEnabled: true, presetAmountsCents: [5000, 10000], customAmountEnabled: true, minAmountCents: 1000, maxAmountCents: 50000 });
    cust.quickSearch.mockResolvedValue({ items: [{ customerId: 'c1', fullName: 'Anna Lee', phone: '(856) 555-1234' }] });
    gc.issue.mockResolvedValue({ ticketId: 't9', ticketNumber: '1050', cardId: 'g9', reference: 'GC-****-ZZ99', cardNumberMasked: '•••• 7777', cardNumberOnce: '1234567812347777', amountCents: 10000, status: 'pending_payment', existing: false });
    mount(); await screen.findByText('•••• 4821');
    fireEvent.click(screen.getByTestId('issue'));
    fireEvent.change(await screen.findByTestId('issue-amount'), { target: { value: '100' } });
    expect(screen.getByTestId('issue-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('customer-search'), { target: { value: 'Anna' } });
    // "Anna Lee" is also the purchaser in the cards table behind the dialog — pick the search hit (the last match, inside the dialog)
    await waitFor(() => expect(screen.getAllByText('Anna Lee').length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByText('Anna Lee').slice(-1)[0]);
    // Gift Cards · 05 Safe Issuance Preview: the review restates exactly what will be written, before anything is
    expect(gc.issue).not.toHaveBeenCalled();
    expect(screen.getByTestId('issue-review-amount')).toHaveTextContent('$100.00');
    expect(screen.getByTestId('issue-review-funding')).toHaveTextContent(/Paid by Anna Lee at Checkout/);
    expect(screen.getByTestId('issue-review-card')).toHaveTextContent(/Digital/);
    expect(screen.getByTestId('issue-review-recipient')).toHaveTextContent(/Anna Lee \(not sent as a gift\)/);
    expect(screen.getByTestId('issue-review-where')).toHaveTextContent(/All of this salon's locations/);
    expect(screen.getByTestId('issue-review-impact')).toHaveTextContent(/refund at Checkout or a void with a reason/);
    fireEvent.click(screen.getByTestId('delivery-physical'));
    expect(screen.queryByTestId('issue-review')).toBeNull();   // a physical sale needs its 16-digit number first — no review of an incomplete form
    fireEvent.change(screen.getByTestId('issue-number'), { target: { value: '1234 5678 1234 9876' } });
    expect(screen.getByTestId('issue-review-card')).toHaveTextContent(/ending 9876/);
    fireEvent.click(screen.getByTestId('is-gift'));
    fireEvent.change(screen.getByTestId('recipient-name'), { target: { value: 'Mai Tran' } });
    expect(screen.getByTestId('issue-review-recipient')).toHaveTextContent('Mai Tran');
    fireEvent.click(screen.getByTestId('is-gift'));
    fireEvent.click(screen.getByTestId('delivery-digital'));
    fireEvent.click(screen.getByTestId('issue-submit')); fireEvent.click(screen.getByTestId('issue-submit'));
    await waitFor(() => expect(gc.issue).toHaveBeenCalledTimes(1));
    expect(gc.issue.mock.calls[0][0]).toMatchObject({ customerId: 'c1', amountCents: 10000, delivery: 'digital' });
    expect(typeof gc.issue.mock.calls[0][0].idempotencyKey).toBe('string');
    expect(await screen.findByTestId('card-number-once')).toHaveTextContent('1234 5678 1234 7777');
  });
  it('Check Balance answers from the protected lookup, masked', async () => {
    co.giftCardLookup.mockResolvedValue({ found: true, cardId: 'g1', cardNumberMasked: '•••• 4821', balanceCents: 3500, status: 'partially_redeemed' });
    mount(); await screen.findByText('•••• 4821');
    fireEvent.click(screen.getByTestId('check-balance'));
    fireEvent.change(await screen.findByTestId('balance-input'), { target: { value: '1234567812344821' } });
    fireEvent.click(screen.getByTestId('balance-submit'));
    expect(await screen.findByTestId('balance-result')).toHaveTextContent('$35.00');
    expect(co.giftCardLookup).toHaveBeenCalledWith('1234567812344821');
  });
  it('GIFT CARDS extras 13: the detail lists digital sends masked with status, failure reason and opt-out; none → no section', async () => {
    const totals = { originalCents: 10000, reloadedCents: 0, redeemedCents: 6500, refundedBackCents: 0, adjustedCents: 0, transferredCents: 0, pendingReloadCents: 0, balanceCents: 3500, transactions: 2, ledgerBalanceCents: 3500, reconciled: true };
    gc.ledger.mockResolvedValue(pageOf([]));
    gc.detail.mockResolvedValue({ card: card(), permissions: { void: false, reload: false }, totals, deliveries: { items: [], sent: 0, failed: 0, pending: 0, optedOut: 0 } });
    const v = mount();
    fireEvent.click((await screen.findAllByText('•••• 4821'))[0]);
    await screen.findByTestId('detail-balance');
    expect(screen.queryByTestId('gc-deliveries')).toBeNull();
    v.unmount();
    gc.detail.mockResolvedValue({ card: card(), permissions: { void: false, reload: false }, totals, deliveries: { sent: 1, failed: 1, pending: 0, optedOut: 1, items: [
      { id: 'd2', channel: 'email', status: 'sent', to: 'a•••@example.com', failure: null, optedOut: false, at: '2026-10-21T15:00:00Z' },
      { id: 'd1', channel: 'sms', status: 'failed', to: '(•••) •••-0123', failure: 'opted_out', optedOut: true, at: '2026-10-20T15:00:00Z' }] } });
    mount();
    fireEvent.click((await screen.findAllByText('•••• 4821'))[0]);
    const sec = await screen.findByTestId('gc-deliveries');
    expect(sec).toHaveTextContent('1 sent · 1 failed · 0 pending');
    expect(screen.getByTestId('gc-deliveries-optout')).toHaveTextContent(/1 destination\(s\) are on the opt-out list/);
    const rows = screen.getAllByTestId('gc-delivery-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Email.*a•••@example\.com.*Sent.*Yes/);
    expect(rows[1]).toHaveTextContent(/Text.*\(•••\) •••-0123.*Failed.*Recipient opted out.*Opted out/);
    expect(gc.reload).not.toHaveBeenCalled(); expect(gc.adjust).not.toHaveBeenCalled();
  });
  it('extras GIFT CARDS 05 / 11 (round 10): the detail says when the balance was checked against the ledger and why the card can or cannot pay', async () => {
    gc.detail.mockResolvedValue({ card: card({ status: 'void', spendable: false }), permissions: { void: true, reload: true },
      totals: { originalCents: 10000, reloadedCents: 0, redeemedCents: 6500, refundedBackCents: 0, adjustedCents: 0, transferredCents: 0, pendingReloadCents: 0, balanceCents: 3500, transactions: 2, ledgerBalanceCents: 3500, reconciled: true },
      verification: { checkedAt: '2026-10-29T15:00:00Z', lastMovementAt: '2026-10-25T15:00:00Z', source: 'live_ledger' },
      eligibility: { reason: 'void', canSpend: false, spendableCents: 0, pinRequired: true, locations: 'issuing_branch_only', branch: 'Main', expiresAt: null } });
    gc.ledger.mockResolvedValue(pageOf([]));
    mount();
    fireEvent.click(await screen.findByText('•••• 4821'));
    expect(await screen.findByTestId('detail-verified')).toHaveTextContent('Balance checked against the card ledger');
    const e = screen.getByTestId('detail-eligibility');
    expect(e).toHaveTextContent('Cannot pay: the card was voided.'); expect(e).toHaveTextContent('Redeemable only at Main'); expect(e).toHaveTextContent('the PIN is required');
  });
  it('extras GIFT CARDS 07 (round 10): guided issuance — the steps light up as each is done and the form says exactly what is still needed', async () => {
    settings.getCategory.mockResolvedValue({ enabled: true, posSalesEnabled: true, presetAmountsCents: [5000], customAmountEnabled: true, minAmountCents: 1000, maxAmountCents: 50000 });
    cust.quickSearch.mockResolvedValue({ items: [{ customerId: 'c1', fullName: 'Bo Walk', phone: '(856) 555-0000' }] });
    mount(); await screen.findByText('•••• 4821');
    fireEvent.click(screen.getByTestId('issue'));
    expect(await screen.findByTestId('issue-missing')).toHaveTextContent('Still needed: purchaser · a valid amount');
    expect(screen.getByTestId('issue-step-purchaser')).toHaveAttribute('data-done', 'false');
    fireEvent.change(screen.getByTestId('issue-amount'), { target: { value: '50' } });
    expect(screen.getByTestId('issue-step-amount')).toHaveAttribute('data-done', 'true');
    expect(screen.getByTestId('issue-missing')).toHaveTextContent('Still needed: purchaser');
    fireEvent.change(screen.getByTestId('customer-search'), { target: { value: 'Bo' } });
    fireEvent.click(await screen.findByText('Bo Walk'));
    expect(screen.queryByTestId('issue-missing')).toBeNull();
    expect(screen.getByTestId('issue-step-review')).toHaveAttribute('data-done', 'true');
    expect(screen.getByTestId('issue-step-pay')).toHaveAttribute('data-done', 'false');   // paying happens at Checkout, never here
    expect(screen.getByTestId('issue-submit')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('delivery-physical'));
    expect(screen.getByTestId('issue-missing')).toHaveTextContent('the 16-digit card number');
  });
});
