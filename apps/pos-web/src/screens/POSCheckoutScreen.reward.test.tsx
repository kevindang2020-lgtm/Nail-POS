// POSCheckoutScreen.reward.test.tsx — Decision 15 loyalty step on the checkout screen: staff type a customer's reward
// code; the server applies it (shown with its amount, removable while unpaid) or refuses it with a reason shown as-is.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSCheckoutScreen } from './POSCheckoutScreen';

const settings = { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 7, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'sandbox' };
const state = { kpisFull: { ticketsReadyForPayment: 1, subtotalCents: 0, tipsTodayCents: 0, cardSurchargeCollectedCents: 0, taxCollectedCents: 0, paidTicketsToday: 0, failedPaymentsToday: 0, customerDisplayActiveSessions: 0, receiptDeliveryRatePercent: 0, averageCheckoutSeconds: 0, giftCardLoyaltyRedemptionsCents: 0, upsellCapturePercent: 0 },
  tickets: { items: [{ ticketId: 't1', ticketNumber: 'A1', customerName: 'Grace Kim', isVip: false, serviceCount: 1, totalDueCents: 6000, status: 'ready', primaryTechnicianName: 'Mia' }], pagination: { totalItems: 1 } },
  paymentSettings: settings, customerDisplay: { pairedDevices: [], activeSession: null } };
const detail = (applied: any[] = []) => {
  const off = applied.reduce((n, a) => n + a.appliedCents, 0);
  return { ticketId: 't1', ticketNumber: 'A1', status: 'ready', customer: { fullName: 'Grace Kim', isVip: false },
    completedServices: [{ serviceLineId: 'l1', serviceName: 'Gel', technicianName: 'Mia', priceCents: 6000, qty: 1 }], promotion: null, commission: null,
    totals: { subtotalCents: 6000, discountCents: off, taxCents: 0, tipCents: 0, surchargeCents: 0, totalCents: 6000 - off, totalDueCents: 6000 - off, paidCents: 0, paymentMethod: 'card' },
    receiptDeliveryOptions: { sms: false, email: false, app: false, print: false }, discountSnapshot: { applied } };
};
let calls: { url: string; method: string; body?: any }[]; let rewardResponse: any;
beforeEach(() => {
  calls = []; rewardResponse = { ok: true, body: detail([{ id: 'loyalty-rd1', category: 'loyalty', description: 'Reward: $10 off', appliedCents: 1000 }]) };
  globalThis.fetch = vi.fn(async (u: any, init?: any) => {
    const url = String(u); const method = init?.method || 'GET'; calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
    const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } } as any);
    if (url.includes('/reward-code/remove')) return json(200, detail());
    if (url.includes('/reward-code')) return rewardResponse.ok ? json(200, rewardResponse.body) : json(400, { message: rewardResponse.message });
    if (/\/tickets\/t1$/.test(url)) return json(200, calls.some((c) => c.url.includes('/reward-code') && !c.url.includes('remove')) && rewardResponse.ok && !calls.some((c) => c.url.includes('remove')) ? rewardResponse.body : detail());
    return json(200, state);
  }) as any;
});

const openTicket = async () => {
  render(<MemoryRouter><POSCheckoutScreen /></MemoryRouter>);
  fireEvent.click((await screen.findAllByText('Grace Kim'))[0]);
  return screen.findByLabelText('Reward code');
};

describe('Checkout — reward code', () => {
  it('applies a code: sent to the server, then shown with its amount and a remove button', async () => {
    const input = await openTicket();
    fireEvent.change(input, { target: { value: 'rdmabc12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Reward' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/tickets/t1/reward-code'))?.body).toEqual({ code: 'RDMABC12345' }));
    expect(await screen.findByText(/\$10 off −\$10\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove reward' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/reward-code/remove') && c.method === 'POST')).toBe(true));
  });
  it("shows the server's reason when a code is refused", async () => {
    rewardResponse = { ok: false, message: 'That reward code belongs to a different customer.' };
    const input = await openTicket();
    fireEvent.change(input, { target: { value: 'RDMOTHER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Reward' }));
    expect(await screen.findByText('That reward code belongs to a different customer.')).toBeInTheDocument();
  });
});
