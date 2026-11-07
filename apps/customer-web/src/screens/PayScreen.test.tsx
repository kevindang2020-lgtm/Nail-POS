import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/skipLineApi', () => ({ skipLineApi: { activeBill: vi.fn(), payCashToTech: vi.fn(), startPayment: vi.fn(), confirmPayment: vi.fn(), paymentStatus: vi.fn(), verifyPayment: vi.fn() } }));
const ORIGIN = 'https://isv-uat.cardconnect.com';
vi.mock('../api/customerApi', () => ({ customerApi: { paymentMethods: vi.fn().mockResolvedValue([]), paymentTokenizer: vi.fn().mockResolvedValue({ available: true, url: 'https://isv-uat.cardconnect.com/itoke/ajax-tokenizer.html', origin: 'https://isv-uat.cardconnect.com', consentVersion: 'v' }) } }));
// Fiserv §8D: the card is entered in the hosted iFrame — the test plays the iframe posting its token.
async function enterCard(token = '9418594164541111') {
  const iframe = (await screen.findByTitle('Secure card entry')) as HTMLIFrameElement;
  act(() => { window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ message: token, expiry: '1230', errorCode: '0' }), origin: ORIGIN, source: iframe.contentWindow as any })); });
  await screen.findByText(/Card ready/);
}
import { skipLineApi } from '../api/skipLineApi';
import { PayScreen } from './PayScreen';

const bill = { ticketId: 't1', invoiceId: 't1', ticketNumber: '#000124', customerId: 'c1', customerName: 'Grace', technicianId: 'tech1', technicianName: 'Ava Nguyen', services: [{ serviceLineId: 'l1', serviceName: 'Manicure', technicianId: 'tech1', priceCents: 2500 }, { serviceLineId: 'l2', serviceName: 'Gel Polish', technicianId: 'tech1', priceCents: 1500 }], subtotalCents: 4000, discountCents: 0, taxCents: 350, tipCents: 800, totalDueCents: 5150, ticketStatus: 'ready_for_checkout', paid: false };
const resp = { bill, enabledMethods: ['card', 'apple_pay', 'google_pay', 'cash_to_technician'], settings: { allowCashToTechnician: true, featureEnabled: true } };
const renderPay = () => render(<MemoryRouter><PayScreen /></MemoryRouter>);

describe('PayScreen (Skip-the-Line Checkout)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('Fiserv §9.4: the conditional credit-card surcharge is disclosed on the bill before paying — and only when it applies', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue({ ...resp, surcharge: { applies: true, ratePercent: 2.5 } });
    renderPay();
    const note = await screen.findByTestId('surcharge-disclosure');
    expect(note.textContent).toMatch(/Credit cards only: a 2\.5% surcharge may be added/);
    expect(note.textContent).toMatch(/Debit and prepaid cards are never surcharged/);
    expect(screen.getByText('$51.50')).toBeTruthy();   // the total is NOT grossed up locally
    cleanup();
    (skipLineApi.activeBill as any).mockResolvedValue({ ...resp, surcharge: { applies: false, ratePercent: 0 } });
    renderPay();
    await screen.findByText('#000124');
    expect(screen.queryByTestId('surcharge-disclosure')).toBeNull();
  });

  it('shows the server-computed bill', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    renderPay();
    expect(await screen.findByText('#000124')).toBeTruthy();
    expect(screen.getByText('Manicure')).toBeTruthy();
    expect(screen.getByText('$51.50')).toBeTruthy();
  });

  it('card payment success shows the success screen', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    (skipLineApi.startPayment as any).mockResolvedValue({ intentId: 'i1', ticketId: 't1', method: 'card', amountCents: 5150, gateway: 'sandbox', configured: true, status: 'processing' });
    (skipLineApi.confirmPayment as any).mockResolvedValue({ paid: true, status: 'succeeded', paymentId: 'p1', amountCents: 5150, processorTransactionId: 'SBX-1' });
    renderPay();
    fireEvent.click(await screen.findByText('Pay Now'));
    fireEvent.click(await screen.findByText('Credit / Debit Card'));
    await enterCard();
    fireEvent.click(screen.getByText('Pay $51.50'));
    expect(await screen.findByText('Payment Successful!')).toBeTruthy();
    expect(skipLineApi.confirmPayment).toHaveBeenCalledWith('t1', { intentId: 'i1', method: 'card', token: '9418594164541111', expiry: '1230' });
  });

  it('never offers Apple Pay / Google Pay without a real wallet integration, and has no card-number or CVV field', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    renderPay();
    fireEvent.click(await screen.findByText('Pay Now'));
    expect(screen.queryByText('Apple Pay')).toBeNull();
    expect(screen.queryByText('Google Pay')).toBeNull();
    fireEvent.click(await screen.findByText('Credit / Debit Card'));
    await screen.findByTitle('Secure card entry');
    expect(screen.queryByPlaceholderText('1234 5678 9012 3456')).toBeNull();
    expect(document.querySelector('input[autocomplete="cc-number"], input[autocomplete="cc-csc"]')).toBeNull();
  });

  // (merged Nov 7 2026: the server answers an unknown card outcome with 409 payment_status_unknown — see the B-80 test below)
  it('offers cash to technician and enters the waiting state', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    (skipLineApi.payCashToTech as any).mockResolvedValue({ intentId: 'i2', confirmationId: 'c2', technicianId: 'tech1', technicianName: 'Ava Nguyen', amountCents: 5150, status: 'cash_pending_tech_confirmation' });
    (skipLineApi.paymentStatus as any).mockResolvedValue({ intentId: 'i2', status: 'cash_pending_tech_confirmation', amountCents: 5150, method: 'cash_to_technician' });
    renderPay();
    fireEvent.click(await screen.findByText('Pay Cash to Technician'));
    expect(await screen.findByText(/Hand .* to Ava Nguyen/)).toBeTruthy();
    fireEvent.click(screen.getByText(/pay cash now/i));
    expect(await screen.findByText(/Waiting for Ava Nguyen/)).toBeTruthy();
    expect(skipLineApi.payCashToTech).toHaveBeenCalledWith('t1');
  });

  it('declined card returns to the card step with a message', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    (skipLineApi.startPayment as any).mockResolvedValue({ intentId: 'i1', ticketId: 't1', method: 'card', amountCents: 5150, gateway: 'sandbox', configured: true, status: 'processing' });
    (skipLineApi.confirmPayment as any).mockResolvedValue({ paid: false, status: 'failed', declineReason: 'Declined (sandbox)' });
    renderPay();
    fireEvent.click(await screen.findByText('Pay Now'));
    fireEvent.click(await screen.findByText('Credit / Debit Card'));
    await enterCard();
    fireEvent.click(screen.getByText('Pay $51.50'));
    expect(await screen.findByText(/Declined/)).toBeTruthy();
  });

  // Customer-added tip (mobile ecosystem Customer pass, Jul 29 2026)
  it('a $10 tip preset flows into startPayment and into the displayed total', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    (skipLineApi.startPayment as any).mockResolvedValue({ intentId: 'i1', ticketId: 't1', method: 'card', amountCents: 6150, tipCents: 1000, gateway: 'sandbox', configured: true, status: 'processing' });
    (skipLineApi.confirmPayment as any).mockResolvedValue({ paid: true, status: 'succeeded', paymentId: 'p1', amountCents: 6150, processorTransactionId: 'SBX-2' });
    renderPay();
    fireEvent.click(await screen.findByText('$10'));
    expect(await screen.findByText('$61.50')).toBeTruthy();               // total = bill + tip
    fireEvent.click(screen.getByText('Pay Now'));
    fireEvent.click(await screen.findByText('Credit / Debit Card'));
    await enterCard();
    fireEvent.click(screen.getByText('Pay $61.50'));
    expect(await screen.findByText('Payment Successful!')).toBeTruthy();
    expect(skipLineApi.startPayment).toHaveBeenCalledWith('t1', 'card', 1000);
  });

  it('Other with no amount blocks at Pay Now and starts nothing', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    renderPay();
    fireEvent.click(await screen.findByText('Other'));
    fireEvent.click(screen.getByText('Pay Now'));
    expect(await screen.findByText(/valid tip amount/i)).toBeTruthy();
    expect(skipLineApi.startPayment).not.toHaveBeenCalled();
  });
  // merged Nov 7 2026 (our line's B-80): a 409 unknown outcome keeps the intent; "Check payment status" asks again, never charges
  it('B-80: an unconfirmed card payment replaces Pay with "Check payment status" — no second charge; an approval shows success', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    (skipLineApi.startPayment as any).mockResolvedValue({ intentId: 'i9', ticketId: 't1', method: 'card', amountCents: 5150, gateway: 'live', configured: true, status: 'processing' });
    (skipLineApi.confirmPayment as any).mockRejectedValue(Object.assign(new Error('We could not confirm your payment with the card processor. Please do not pay again — the salon will confirm it.'), { code: 'payment_status_unknown', status: 409 }));
    ((skipLineApi as any).verifyPayment as any).mockResolvedValueOnce({ intentId: 'i9', ticketId: 't1', status: 'processing', outcome: 'pending', reason: 'Still being confirmed.' })
      .mockResolvedValueOnce({ intentId: 'i9', ticketId: 't1', status: 'succeeded', outcome: 'approved', paymentId: 'p9' });
    renderPay();
    fireEvent.click(await screen.findByText('Pay Now'));
    fireEvent.click(await screen.findByText('Credit / Debit Card'));
    await enterCard();
    fireEvent.click(screen.getByText('Pay $51.50'));
    expect(await screen.findByText(/do not pay again/i)).toBeTruthy();
    expect(screen.queryByText('Pay $51.50')).toBeNull();
    fireEvent.click(screen.getByText('Check payment status'));
    expect(await screen.findByText('Still being confirmed.')).toBeTruthy();
    fireEvent.click(screen.getByText('Check payment status'));
    expect(await screen.findByText('Payment Successful!')).toBeTruthy();
    expect((skipLineApi as any).verifyPayment).toHaveBeenCalledWith('i9');
    expect(skipLineApi.confirmPayment).toHaveBeenCalledTimes(1);
  });
});
