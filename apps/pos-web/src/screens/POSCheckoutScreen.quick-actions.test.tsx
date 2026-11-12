// wave 4 UI sweep: with no ticket selected, the Checkout quick actions (Take Payment, Apply Discount, Split Ticket,
// Send Receipt, View Signature, View Summary) did nothing at all — no message, no request.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSCheckoutScreen } from './POSCheckoutScreen';

const checkoutState = {
  kpisFull: { ticketsReadyForPayment: 0, subtotalCents: 0, tipsTodayCents: 0, cardSurchargeCollectedCents: 0, taxCollectedCents: 0, paidTicketsToday: 0, failedPaymentsToday: 0, customerDisplayActiveSessions: 0, receiptDeliveryRatePercent: 0, averageCheckoutSeconds: 0, giftCardLoyaltyRedemptionsCents: 0, upsellCapturePercent: 0 },
  tickets: { items: [], pagination: { totalItems: 0 } },
  paymentSettings: { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 7, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'sandbox' },
  customerDisplay: { pairedDevices: [], activeSession: null },
};
const mockFetch = (state: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('Checkout quick actions without a selected ticket', () => {
  it('a ticket quick action with no ticket selected says so (wave 4: Take Payment, Apply Discount … did nothing)', async () => {
    globalThis.fetch = mockFetch(checkoutState) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('No guests ready for checkout.');
    for (const l of ['Take Payment', 'Apply Discount', 'Send Receipt']) {
      const b = screen.getAllByText(l).map((x) => x.closest('button')).find(Boolean)!;
      fireEvent.click(b);
      // the per-button reason lines (extras #07) carry the same words — the tap must ALSO raise the note itself
      expect(screen.getAllByText('Select a ticket first.').some((el) => el.getAttribute('data-testid') !== 'qa-why')).toBe(true);
    }
  });
});

// CheckOut extras #07: a quick action that cannot run says WHY (visible line + tooltip), is never hidden, never approves.
import '../i18n';
const tkState = (fiservStatus: string, status = 'ready_checkout') => ({ ...checkoutState,
  kpisFull: { ...checkoutState.kpisFull, ticketsReadyForPayment: 1 },
  tickets: { items: [{ ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', serviceCount: 1, totalDueCents: 5350, status, primaryTechnicianName: 'Sam' }], pagination: { totalItems: 1 } },
  paymentSettings: { ...checkoutState.paymentSettings, fiservStatus } });
const tkDetail = (status = 'ready_checkout') => ({ ticketId: 't1', ticketNumber: 'A1', customer: { fullName: 'Jessica Miller', isVip: false }, status, completedServices: [], discounts: [], tenders: [], paidCents: 0, balanceCents: 5350,
  totals: { subtotalCents: 5000, tipCents: 0, taxCents: 350, surchargeCents: 0, totalDueCents: 5350, paymentMethod: 'card' } });
const routed = (state: unknown, det: unknown) => vi.fn(async (url: string) => { const u = String(url);
  const json = u.includes('/unsettled-tenders') || u.includes('/terminals') ? [] : /\/pos\/checkout\/tickets\/t1(\?|$)/.test(u) ? det : state;
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json), headers: { get: () => null } } as any; });
const qaBtn = (label: string) => screen.getAllByText(label).map((x) => x.closest('button')).find((b) => b?.className === 'dqa')!;

describe('Checkout quick-action explanations (extras #07)', () => {
  it('with no ticket every ticket action shows the reason, stays visible and is marked aria-disabled; New Checkout has none', async () => {
    globalThis.fetch = mockFetch(checkoutState) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    await screen.findByText('No guests ready for checkout.');
    for (const l of ['Take Payment', 'Apply Discount', 'Send Receipt', 'View Summary']) {
      const b = qaBtn(l);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toContain('Select a ticket first.');
      expect(b.textContent).toContain('Select a ticket first.');
    }
    const nc = qaBtn('New Checkout');
    expect(nc.getAttribute('aria-disabled')).toBeNull();
  });
  it('a card merchant that is not configured is named on Take Payment only; ticket actions lose their reason once the ticket loads', async () => {
    globalThis.fetch = routed(tkState('not_configured'), tkDetail()) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByText('Jessica Miller'))[0]);
    await waitFor(() => expect(qaBtn('Take Payment').getAttribute('data-why')).toBe('Card merchant not configured'));
    expect(qaBtn('Send Receipt').getAttribute('aria-disabled')).toBeNull();
    expect(qaBtn('Apply Discount').getAttribute('aria-disabled')).toBeNull();
  });
  it('a paid ticket says "Already paid" on Take Payment / Apply Discount / Split Payment but still allows Send Receipt', async () => {
    globalThis.fetch = routed(tkState('connected', 'paid'), tkDetail('paid')) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByText('Jessica Miller'))[0]);
    await waitFor(() => expect(qaBtn('Take Payment').getAttribute('data-why')).toBe('Already paid'));
    expect(qaBtn('Apply Discount').getAttribute('data-why')).toBe('Already paid');
    expect(qaBtn('Split Payment').getAttribute('data-why')).toBe('Already paid');
    expect(qaBtn('Send Receipt').getAttribute('aria-disabled')).toBeNull();
  });
  it('a connected merchant with a loaded unpaid ticket shows no reason on Take Payment', async () => {
    globalThis.fetch = routed(tkState('connected'), tkDetail()) as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByText('Jessica Miller'))[0]);
    await waitFor(() => expect(qaBtn('Send Receipt').getAttribute('aria-disabled')).toBeNull());
    await waitFor(() => expect(qaBtn('Take Payment').getAttribute('aria-disabled')).toBeNull());
  });
});
