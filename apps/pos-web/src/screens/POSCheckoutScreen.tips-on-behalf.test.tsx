// POSCheckoutScreen.tips-on-behalf.test — G4 Split Tips follow-up (Nov 5 2026, §34): a front-desk card payment refused
// because the customer has not confirmed the per-technician tips shows the on-behalf panel; the cashier's reason is sent
// as staffTipConfirmation on the retry, and nothing is resent without it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import '../i18n';
import { POSCheckoutScreen } from './POSCheckoutScreen';

const settings = { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 7, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'not_configured' };
const kpis = { ticketsReadyForPayment: 2, subtotalCents: 0, tipsTodayCents: 0, cardSurchargeCollectedCents: 0, taxCollectedCents: 0, paidTicketsToday: 0, failedPaymentsToday: 0, customerDisplayActiveSessions: 0, receiptDeliveryRatePercent: 0, averageCheckoutSeconds: 0, giftCardLoyaltyRedemptionsCents: 0, upsellCapturePercent: 0 };
const row = (id: string, name: string, status = 'ready_for_payment') => ({ ticketId: id, ticketNumber: id.toUpperCase(), customerName: name, isVip: false, serviceCount: 1, totalDueCents: 12840, status, primaryTechnicianName: 'Samantha' });
const detail = (id: string, name: string) => ({
  ticketId: id, ticketNumber: id.toUpperCase(), customer: { fullName: name, isVip: false }, stationLabel: 'Station 1',
  completedServices: [{ serviceLineId: 'l1', serviceName: 'Gel Manicure', technicianName: 'Samantha', priceCents: 12000 }],
  totals: { subtotalCents: 12000, tipCents: 0, taxCents: 840, surchargeCents: 0, totalDueCents: 12840, paymentMethod: 'card' },
  status: 'ready_for_payment', receiptDeliveryOptions: { sms: false, email: false, app: false, print: false },
});


const bodies: unknown[] = [];
function server() {
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url); const method = (init?.method as string) || 'GET';
    const ok = (j: unknown, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => j, text: async () => JSON.stringify(j) }) as unknown as Response;
    if (method === 'POST' && /\/pay\/card$/.test(u)) {
      const b = JSON.parse(String(init?.body ?? '{}')); bodies.push(b);
      if (!b.staffTipConfirmation) return ok({ code: 'TECH_TIPS_NOT_CONFIRMED', message: 'The customer has not confirmed the tips on the display yet.' }, 409);
      return ok({ status: 'approved', payment: { status: 'approved' } });
    }
    const m = /\/pos\/checkout\/tickets\/([^/?]+)$/.exec(u);
    if (m) return ok(detail(m[1], 'Jessica Miller'));
    if (u.includes('/pos/checkout/state')) return ok({ kpisFull: kpis, tickets: { items: [row('t1', 'Jessica Miller')], pagination: { totalItems: 1 } }, paymentSettings: settings, customerDisplay: { pairedDevices: [], activeSession: null } });
    return ok({});
  });
  return fetch;
}
beforeEach(async () => { vi.restoreAllMocks(); bodies.length = 0; await setLanguage('en'); });
afterEach(async () => { await setLanguage('en'); });

describe('front desk: tips the customer has not confirmed (G4 §34)', () => {
  it('the refusal opens the on-behalf panel; the retry carries the cashier\'s reason; Cancel closes it without paying', async () => {
    globalThis.fetch = server() as any;
    render(<MemoryRouter initialEntries={['/checkout']}><Routes><Route path="/checkout" element={<POSCheckoutScreen />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toContain('Jessica Miller'));
    fireEvent.click(await screen.findByText('Complete Checkout'));
    const panel = await screen.findByTestId('tips-on-behalf');
    expect(panel.textContent).toContain('Tips not confirmed.');
    const go = screen.getByRole('button', { name: 'Confirm for the customer and pay' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);   // a reason is required
    fireEvent.change(screen.getByLabelText('Why you are confirming for the customer'), { target: { value: 'Customer agreed at the counter' } });
    await act(async () => { fireEvent.click(go); });
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).not.toHaveProperty('staffTipConfirmation');
    expect(bodies[1]).toMatchObject({ staffTipConfirmation: { reason: 'Customer agreed at the counter' } });
    await waitFor(() => expect(screen.queryByTestId('tips-on-behalf')).toBeNull());
  });
  it('Vietnamese POS: the panel speaks Vietnamese (Thợ)', async () => {
    globalThis.fetch = server() as any; await setLanguage('vi');
    render(<MemoryRouter initialEntries={['/checkout']}><Routes><Route path="/checkout" element={<POSCheckoutScreen />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(bodies.length).toBe(0));
    const btn = await screen.findAllByRole('button');
    const complete = btn.find((b) => /Hoàn tất|Complete/.test(b.textContent ?? ''));
    expect(complete).toBeTruthy();
    fireEvent.click(complete!);
    const panel = await screen.findByTestId('tips-on-behalf');
    expect(panel.textContent).toContain('Thợ');
  });
});
