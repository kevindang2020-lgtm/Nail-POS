// Fiserv master build §7.1 / §8B (Nov 4 2026): the front-desk Card button charges on the Clover Compact. It used to post
// /pay/card with no terminal and no token, so it never reached the terminal.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';   // the English catalog (keys render raw without it)
import { POSCheckoutScreen } from './POSCheckoutScreen';

const paymentSettings = { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 7, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'connected' };
const state = {
  kpisFull: { ticketsReadyForPayment: 1, subtotalCents: 0, tipsTodayCents: 0, cardSurchargeCollectedCents: 0, taxCollectedCents: 0, paidTicketsToday: 0, failedPaymentsToday: 0, customerDisplayActiveSessions: 0, receiptDeliveryRatePercent: 0, averageCheckoutSeconds: 0, giftCardLoyaltyRedemptionsCents: 0, upsellCapturePercent: 0 },
  tickets: { items: [{ ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', serviceCount: 1, totalDueCents: 5350, status: 'ready_checkout', primaryTechnicianName: 'Sam' }], pagination: { totalItems: 1 } },
  paymentSettings, customerDisplay: { pairedDevices: [], activeSession: null },
};
const detail = { ticketId: 't1', ticketNumber: 'A1', customerId: 'c1', customerName: 'Jessica Miller', customerPhone: '', stationCode: 'S1', services: [{ name: 'Gel Manicure', priceCents: 5000 }], qualityApproved: true,
  status: 'ready_checkout', completedServices: [{ serviceName: 'Gel Manicure', technicianName: 'Sam', priceCents: 5000 }], discounts: [], tenders: [], paidCents: 0, balanceCents: 5350,
  totals: { subtotalCents: 5000, tipCents: 0, taxCents: 350, surchargeCents: 0, totalDueCents: 5350, paymentMethod: 'card' } };

function router(payAnswer: unknown, terminals: unknown = [{ id: 'term_1', label: 'Front Compact', stationId: null, disabled: false, lastSeenAt: null, hsnConfigured: true }]) {
  const calls: { url: string; body: any }[] = [];
  const fetch = vi.fn(async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : null; calls.push({ url: String(url), body });
    const u = String(url);
    const json = u.includes('/unsettled-tenders') ? []
      : u.includes('/pos/checkout/terminals') ? terminals
      : u.includes('/pay/terminal') ? payAnswer
      : /\/pos\/checkout\/tickets\/t1(\?|$)/.test(u) ? detail
      : u.includes('/pay/card') ? { configured: false, disabledReason: 'A card token is required to charge a card.' }
      : state;
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json), headers: { get: () => null } } as any;
  });
  return { fetch, calls };
}

async function openTicketAndPay() {
  render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
  fireEvent.click((await screen.findAllByText('Jessica Miller'))[0]);
  await screen.findByTestId('terminal-pay');
  await screen.findByRole('option', { name: 'Front Compact' });
  fireEvent.click(screen.getByText(COMPLETE).closest('button')!);
}

const COMPLETE = 'Complete Checkout';
beforeEach(() => { vi.restoreAllMocks(); });

describe('POS Card → Clover Compact', () => {
  it('Take Payment by card calls /pay/terminal with an attempt key — never /pay/card with an empty token', async () => {
    const r = router({ status: 'approved', paymentId: 'p1', retref: 'R1', amountCents: 5350, next: 'done' });
    globalThis.fetch = r.fetch as any;
    await openTicketAndPay();
    await waitFor(() => expect(r.calls.some((c) => c.url.includes('/tickets/t1/pay/terminal'))).toBe(true));
    const pay = r.calls.find((c) => c.url.includes('/pay/terminal'))!;
    expect(pay.body.attemptKey).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(r.calls.some((c) => /\/pay\/card(\?|$)/.test(c.url))).toBe(false);
    expect(await screen.findByText(/APPROVED — \$53\.50/)).toBeInTheDocument();
  });

  it('an UNKNOWN answer is shown as "verify", never as a decline, and paying again is blocked until Verify', async () => {
    const r = router({ status: 'unknown', message: 'the terminal did not answer', next: 'verify' });
    globalThis.fetch = r.fetch as any;
    await openTicketAndPay();
    expect(await screen.findByText(/UNKNOWN — VERIFY/)).toBeInTheDocument();
    expect(screen.queryByText(/DECLINED/)).toBeNull();
    await waitFor(() => expect(screen.getByText(COMPLETE).closest('button')).toBeDisabled());
    expect(r.calls.filter((c) => c.url.includes('/pay/terminal')).length).toBe(1);
  });

  it('a decline says DECLINED and allows another card', async () => {
    const r = router({ status: 'declined', message: 'Insufficient funds', next: 'retry' });
    globalThis.fetch = r.fetch as any;
    await openTicketAndPay();
    expect(await screen.findByText(/DECLINED — Insufficient funds/)).toBeInTheDocument();
  });

  it('no terminal paired at this location → says so and charges nothing', async () => {
    const r = router({ status: 'approved' }, []);
    globalThis.fetch = r.fetch as any;
    render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByText('Jessica Miller'))[0]);
    expect((await screen.findAllByText(/No terminal is paired at this location/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(COMPLETE).closest('button')!);
    expect(r.calls.some((c) => c.url.includes('/pay/terminal'))).toBe(false);
  });
});
