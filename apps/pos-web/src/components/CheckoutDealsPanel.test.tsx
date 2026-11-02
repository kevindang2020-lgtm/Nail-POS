// CheckoutDealsPanel.test.tsx — BUILD_PLAN Phase 5 at the register: itemized discounts (no fake "DISCOUNT" chip),
// eligible offers with their value, "why not" reasons, best deal, coupon codes, remove — and refusals said out loud
// (a permission error used to be swallowed: bug 2).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const offers = vi.fn(); const applyOffer = vi.fn(); const applyBestOffers = vi.fn(); const removeOffer = vi.fn();
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: {
  offers: (...a: any[]) => offers(...a), applyOffer: (...a: any[]) => applyOffer(...a), applyBestOffers: (...a: any[]) => applyBestOffers(...a), removeOffer: (...a: any[]) => removeOffer(...a),
} }));
import { CheckoutDealsPanel } from './CheckoutDealsPanel';

const panel = (over: any = {}) => ({
  available: true, applied: [],
  eligible: [{ dealId: 'd1', title: 'Spring 20%', kind: 'deal', discountType: 'percent', discountPercent: 20, discountCents: null, estimatedCents: 1400, endsAt: null, terms: null }],
  notEligible: [{ dealId: 'd2', title: 'Members Pedi', kind: 'deal', discountType: 'fixed', discountPercent: null, discountCents: 500, estimatedCents: 500, endsAt: null, terms: null, reasons: [{ code: 'members_only', message: 'For members only.' }] }],
  best: { dealIds: ['d1'], add: [{ dealId: 'd1', couponId: null }], savingsCents: 1400, currentCents: 0, better: true }, ...over,
});
const err = (status: number, message: string, reasons?: any[]) => Object.assign(new Error(message), { status, body: { message, reasons } });
beforeEach(() => { for (const f of [offers, applyOffer, applyBestOffers, removeOffer]) f.mockReset(); offers.mockResolvedValue(panel()); });
const mount = (props: any = {}) => { const onChanged = vi.fn(); const onNote = vi.fn(); render(<CheckoutDealsPanel ticketId="t1" isPaid={false} discounts={[]} onChanged={onChanged} onNote={onNote} {...props} />); return { onChanged, onNote }; };

describe('the checkout deals panel', () => {
  it('lists what the customer can use, with its value on this ticket, and applies it', async () => {
    applyOffer.mockResolvedValue({ applied: true });
    const { onChanged, onNote } = mount();
    fireEvent.click(await screen.findByText('Apply −$14.00'));
    await waitFor(() => expect(applyOffer).toHaveBeenCalledWith('t1', { dealId: 'd1' }));
    expect(onNote).toHaveBeenCalledWith('Spring 20% applied.');
    expect(onChanged).toHaveBeenCalled();
  });
  it('shows WHY a deal cannot be used', async () => {
    mount();
    fireEvent.click(await screen.findByText('Members Pedi — why not?'));
    expect(screen.getByTestId('why-d2')).toHaveTextContent('For members only.');
  });
  it('"Apply best deal" shows the saving and applies the server’s best combination', async () => {
    applyBestOffers.mockResolvedValue({ applied: ['d1'] });
    mount();
    fireEvent.click(await screen.findByText(/Apply best deal — saves \$14\.00/));
    await waitFor(() => expect(applyBestOffers).toHaveBeenCalledWith('t1'));
  });
  it('a coupon code goes to the engine; a refusal shows the server’s reasons', async () => {
    applyOffer.mockRejectedValue(err(400, 'That code isn’t valid here.', [{ code: 'unknown_code', message: 'That code isn’t valid here.' }]));
    mount();
    fireEvent.change(await screen.findByLabelText('Deal or coupon code'), { target: { value: 'spring10' } });
    fireEvent.click(screen.getByText('Apply code'));
    await waitFor(() => expect(applyOffer).toHaveBeenCalledWith('t1', { code: 'spring10' }));
    expect(await screen.findByTestId('deals-error')).toHaveTextContent('That code isn’t valid here.');
  });
  it('a permission refusal is said plainly (bug 2: it used to be swallowed)', async () => {
    applyOffer.mockRejectedValue(err(403, 'Forbidden'));
    mount();
    fireEvent.click(await screen.findByText('Apply −$14.00'));
    expect(await screen.findByTestId('deals-error')).toHaveTextContent('permission');
  });
  it('itemizes what is on the ticket — a manual discount is a manual discount, never a "DISCOUNT" coupon — and a deal can be removed', async () => {
    removeOffer.mockResolvedValue({ removed: true });
    mount({ discounts: [{ category: 'manual', label: 'Manual Discount', amountCents: 500, dealId: null, redemptionId: null }, { category: 'deal', label: 'Deal: Spring 20%', amountCents: 1400, dealId: 'd1', redemptionId: 'r1' }] });
    const list = await screen.findByTestId('applied-discounts');
    expect(list).toHaveTextContent('Manual discount');
    expect(list).toHaveTextContent('Spring 20%');
    expect(list).not.toHaveTextContent('DISCOUNT Applied');
    fireEvent.click(screen.getByLabelText('Remove Deal: Spring 20%'));
    await waitFor(() => expect(removeOffer).toHaveBeenCalledWith('t1', 'r1'));
  });
  it('a paid ticket shows what was applied but offers nothing more', async () => {
    mount({ isPaid: true, discounts: [{ category: 'deal', label: 'Deal: Spring', amountCents: 1400, dealId: 'd1', redemptionId: 'r1' }] });
    await screen.findByTestId('applied-discounts');
    await waitFor(() => expect(offers).toHaveBeenCalled());
    expect(screen.queryByTestId('eligible-offers')).toBeNull();
    expect(screen.queryByLabelText('Remove Deal: Spring')).toBeNull();
  });
});
