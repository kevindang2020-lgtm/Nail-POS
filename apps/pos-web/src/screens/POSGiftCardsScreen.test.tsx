// Customers → Gift Cards (Oct 29 2026 one-screen rebuild): the KPIs are the server's (over every card), the list shows only
// MASKED identifiers, search/status/sort go to the server, the detail shows the ledger ($100 card · $65 service · $35 left),
// Issue is payment-first with one idempotency key (a double tap never makes two cards) and Void needs a reason.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const gc = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), detail: vi.fn(), ledger: vi.fn(), exportCsv: vi.fn(), issue: vi.fn(), reload: vi.fn(), voidCard: vi.fn(), liability: vi.fn() }));
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
  it('status tab and search go to the server, with chips and Clear All', async () => {
    mount(); await screen.findByText('•••• 4821');
    fireEvent.click(screen.getByTestId('tab-redeemed'));
    await waitFor(() => expect(gc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'redeemed' })));
    fireEvent.change(screen.getByTestId('search'), { target: { value: '8565551234' } });
    await waitFor(() => expect(gc.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '8565551234', status: 'redeemed' })));
    fireEvent.click(screen.getByTestId('clear-all'));
    await waitFor(() => expect(gc.list.mock.calls.slice(-1)[0]![0].status).toBeUndefined());
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
});
