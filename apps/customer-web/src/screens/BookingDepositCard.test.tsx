// BookingDepositCard.test — D11 (Oct 21 2026): the deposit the salon asked for at booking, paid from the app with the
// hosted tokenizer's token; the terms said plainly; a decline retried; no gateway → "in person", the booking stands.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, configure } from '@testing-library/react';
// Oct 23 2026: the tokenizer iframe + pay round trip outlived the 1 s default under a loaded parallel lane (one red in the
// apps lane, 3/3 green alone) — the assertions are unchanged, only the wait is longer.
configure({ asyncUtilTimeout: 5000 });
vi.mock('../api/customerApi', () => ({ customerApi: { paymentTokenizer: vi.fn(), payBookingDeposit: vi.fn(), bookingDeposit: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { BookingDepositCard } from './BookingDepositCard';

const pending = { depositId: 'd1', appointmentId: 'a1', status: 'pending' as const, amountCents: 2500, cardLast4: null, refundableUntil: '2026-11-04T15:00:00.000Z', forfeitOnNoShow: true, appliedCents: null, refundedCents: null, endedReason: null, failureReason: null };
const tokenArrives = () => act(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://fts.cardconnect.com', data: JSON.stringify({ message: '9418594164541111', expiry: '202912' }) })); });

beforeEach(() => { vi.clearAllMocks(); (customerApi.paymentTokenizer as any).mockResolvedValue({ available: true, url: 'https://fts.cardconnect.com/itoke/ajax-tokenizer.html', origin: 'https://fts.cardconnect.com' }); });

describe('BookingDepositCard', () => {
  it('shows the amount and the terms, takes the tokenizer\'s token (never a card number), pays, and reports paid', async () => {
    (customerApi.payBookingDeposit as any).mockResolvedValue({ ...pending, status: 'captured', cardLast4: '1111' });
    render(<BookingDepositCard appointmentId="a1" initial={pending} />);
    expect(screen.getByText('Deposit — $25.00')).toBeInTheDocument();
    expect(screen.getByTestId('booking-deposit-terms').textContent).toMatch(/full refund; after that it is kept/);
    expect(screen.getByTestId('booking-deposit-terms').textContent).toMatch(/no-show keeps the deposit/);
    await screen.findByTitle('Secure card entry');
    const pay = screen.getByTestId('booking-deposit-pay') as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    act(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: JSON.stringify({ message: '9418594164541111' }) })); });   // wrong origin: ignored
    expect(pay.disabled).toBe(true);
    tokenArrives();
    await waitFor(() => expect(pay.disabled).toBe(false));
    fireEvent.click(pay);
    await waitFor(() => expect(customerApi.payBookingDeposit).toHaveBeenCalledWith('a1', { cardToken: '9418594164541111', expiry: '1229' }));
    expect(await screen.findByText('Deposit paid — $25.00')).toBeInTheDocument();
    expect(screen.getByTestId('booking-deposit-terms').textContent).toMatch(/card ending 1111/);
    expect(screen.queryByTestId('booking-deposit-pay')).toBeNull();
  });
  it('a decline is said with the processor\'s words and can be retried with another card', async () => {
    (customerApi.payBookingDeposit as any).mockRejectedValueOnce(Object.assign(new Error('The card was declined: Insufficient funds'), { status: 402, body: { code: 'DEPOSIT_DECLINED', message: 'The card was declined: Insufficient funds' } }));
    (customerApi.bookingDeposit as any).mockResolvedValue({ ...pending, status: 'failed', failureReason: 'Insufficient funds' });
    render(<BookingDepositCard appointmentId="a1" initial={pending} />);
    await screen.findByTitle('Secure card entry');
    tokenArrives();
    fireEvent.click(await screen.findByText('Pay $25.00 deposit'));
    expect(await screen.findByRole('status')).toHaveTextContent('Insufficient funds');
    expect(await screen.findByText(/Try another card/)).toBeInTheDocument();
    expect(screen.getByTestId('booking-deposit-pay')).toBeInTheDocument();            // still payable
  });
  it('no card gateway at this salon: the deposit is taken in person and the booking stands', async () => {
    (customerApi.paymentTokenizer as any).mockResolvedValue({ available: false, reason: 'gateway_not_configured' });
    render(<BookingDepositCard appointmentId="a1" initial={pending} />);
    expect(await screen.findByTestId('booking-deposit-in-person')).toHaveTextContent('Your booking stands');
    expect(screen.queryByTestId('booking-deposit-pay')).toBeNull();
  });
});
