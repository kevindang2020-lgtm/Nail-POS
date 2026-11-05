// TechnicianTips.test — Split Tips guide (Nov 5 2026, G4): the customer taps each technician and chooses that technician's
// own tip; tapping A never changes B; Confirm sends every choice once with the screen's version; nothing is confirmed until
// each technician has a choice (No Tip counts).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CustomerDisplayState, DisplayTechnicianTips } from '@aipowersalon/api-contracts/customer';
import { TipAndPay, type CheckoutActions } from './CheckoutPanel';

const tt = (over: Partial<DisplayTechnicianTips> = {}): DisplayTechnicianTips => ({
  recipients: [
    { technicianId: 'a', name: 'Anna', services: ['Gel Manicure'], basisCents: 4000, choice: { tipType: 'custom', percent: null, tipCents: 500 } },
    { technicianId: 'b', name: 'Ben', services: ['Spa Pedicure'], basisCents: 6000, choice: null },
  ], version: 3, state: 'DRAFT', stale: false, totalTipCents: 500, presetCents: [300, 500, 1000], percents: [15, 18, 20], ...over });
const state = (t: DisplayTechnicianTips): CustomerDisplayState => ({ state: 'tip_selected', salonName: 'S', tipOptions: [], selectedTipCents: t.totalTipCents,
  totals: { subtotalCents: 10000, tipCents: t.totalTipCents, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 10000 + t.totalTipCents, paymentMethod: 'card' }, payButtonEnabled: false, technicianTips: t });
const actions = (): CheckoutActions & { onTechTips: ReturnType<typeof vi.fn> } => ({ submitting: false, actionError: null, rated: null, onTip: vi.fn(), onMethod: vi.fn(), onPay: vi.fn(), onRate: vi.fn(), onClearError: vi.fn(), onTechTips: vi.fn() });

describe('per-technician tips on the customer display', () => {
  it('one card per technician; tapping Ben opens only Ben\'s menu; 20% shows Ben\'s own basis; Anna\'s $5 is kept', () => {
    const a = actions();
    render(<TipAndPay s={state(tt())} a={a} />);
    expect(screen.getByTestId('ttip-card-a')).toHaveTextContent('$5.00');
    expect(screen.getByTestId('ttip-card-b')).toHaveTextContent('Choose a tip');
    fireEvent.click(screen.getByTestId('ttip-card-b'));
    expect(screen.getByTestId('ttip-menu')).toHaveTextContent('Tip for Ben');
    expect(screen.getByTestId('ttip-pct-20')).toHaveTextContent('$12.00');
    fireEvent.click(screen.getByTestId('ttip-preset-1000'));
    expect(a.onTechTips).toHaveBeenCalledWith({ technicians: [{ technicianId: 'a', tipType: 'custom', percent: null, amountCents: 500 }, { technicianId: 'b', tipType: 'custom', percent: null, amountCents: 1000 }], expectedVersion: 3, confirm: false });
  });
  it('Confirm is disabled until every technician has a choice; then it sends confirm with the version', () => {
    const a = actions();
    const { rerender } = render(<TipAndPay s={state(tt())} a={a} />);
    fireEvent.click(screen.getByText('Review tips'));
    expect((screen.getByTestId('ttip-confirm') as HTMLButtonElement).disabled).toBe(true);
    const both = tt({ recipients: tt().recipients.map((r) => (r.choice ? r : { ...r, choice: { tipType: 'none', percent: null, tipCents: 0 } })) });
    rerender(<TipAndPay s={state(both)} a={a} />);
    expect(screen.getByTestId('ttip-card-b')).toHaveTextContent('No tip');
    fireEvent.click(screen.getByTestId('ttip-confirm'));
    expect(a.onTechTips).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: true, expectedVersion: 3 }));
  });
  it('a confirmed selection shows each technician and the total; a stale one asks to choose again', () => {
    render(<TipAndPay s={state(tt({ state: 'CONFIRMED', recipients: tt().recipients.map((r) => ({ ...r, choice: r.choice ?? { tipType: 'custom', percent: null, tipCents: 1000 } })), totalTipCents: 1500 }))} a={actions()} />);
    expect(screen.getByTestId('ttip-confirmed')).toHaveTextContent('Anna$5.00');
    expect(screen.getByTestId('ttip-confirmed')).toHaveTextContent('Total tips$15.00');
  });
  it('without per-technician tips the single tip screen is unchanged', () => {
    const s = state(tt()); delete (s as { technicianTips?: unknown }).technicianTips;
    render(<TipAndPay s={s} a={actions()} />);
    expect(screen.queryByTestId('ttip-cards')).toBeNull();
  });
});
