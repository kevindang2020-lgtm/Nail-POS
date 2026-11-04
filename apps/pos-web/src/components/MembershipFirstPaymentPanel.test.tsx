// D6 §16 (Nov 4 2026): the first-payment panel offers only what can work (a saved card when billing is set up, the paid
// invoices that cover the amount) and sends one Idempotency-Key per attempt.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/posMembershipEnrollApi', () => ({ posMembershipEnrollApi: { firstPayment: vi.fn(), collectFirstPayment: vi.fn() } }));
import { posMembershipEnrollApi } from '../api/posMembershipEnrollApi';
import { MembershipFirstPaymentPanel } from './MembershipFirstPaymentPanel';

const api = posMembershipEnrollApi as any;
beforeEach(() => { api.firstPayment.mockReset(); api.collectFirstPayment.mockReset(); });

describe('MembershipFirstPaymentPanel', () => {
  it('card billing off: the card button is disabled with the reason; a paid invoice activates it', async () => {
    api.firstPayment.mockResolvedValue({ membershipId: 'm1', status: 'pending', awaitingFirstPayment: true, amountDueCents: 7500, cardOnFile: true, cardBillingConfigured: false, invoices: [{ id: 'i1', number: 'INV-3', totalCents: 7500, paidAt: null }] });
    api.collectFirstPayment.mockResolvedValue({ status: 'active', amountCents: 7500, duplicate: false });
    const onPaid = vi.fn();
    render(<MembershipFirstPaymentPanel membershipId="m1" customerName="Jess" onPaid={onPaid} onLater={() => {}} />);
    await screen.findByText('First payment');
    expect(screen.getByTestId('fp-card')).toBeDisabled();
    expect(screen.getByText('Card-on-file billing is not set up for this salon.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('fp-use-invoice'));
    await waitFor(() => expect(onPaid).toHaveBeenCalled());
    expect(api.collectFirstPayment).toHaveBeenCalledWith('m1', { method: 'invoice', invoiceId: 'i1' }, expect.any(String));
  });
  it('a declined card shows the reason and a retry reuses the same key', async () => {
    api.firstPayment.mockResolvedValue({ membershipId: 'm1', status: 'pending', awaitingFirstPayment: true, amountDueCents: 6000, cardOnFile: true, cardBillingConfigured: true, invoices: [] });
    api.collectFirstPayment.mockRejectedValueOnce(new Error('The card was declined. The membership stays pending.')).mockResolvedValue({ status: 'active', amountCents: 6000, duplicate: false });
    render(<MembershipFirstPaymentPanel membershipId="m1" customerName="Jess" onPaid={() => {}} onLater={() => {}} />);
    await screen.findByText('First payment');
    fireEvent.click(screen.getByTestId('fp-card'));
    await screen.findByText('The card was declined. The membership stays pending.');
    fireEvent.click(screen.getByTestId('fp-card'));
    await waitFor(() => expect(api.collectFirstPayment).toHaveBeenCalledTimes(2));
    expect(api.collectFirstPayment.mock.calls[1][2]).toBe(api.collectFirstPayment.mock.calls[0][2]);
  });
});
