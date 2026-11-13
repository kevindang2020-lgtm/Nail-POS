// ConflictSimulatorDialog.test.tsx — Extras · Promotions Management 15: the checkout conflict simulator renders the
// server's engine results as sent (no client-side re-pricing), expands a staging ticket to its conflicts, and only reads.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

let payload: any;
const conflictSimulator = vi.fn(async () => payload);
const post = vi.fn();
vi.mock('../../api/posDealsApi', () => ({ posDealsApi: { conflictSimulator: (...a: any[]) => (conflictSimulator as any)(...a), approve: (...a: any[]) => post(...a), create: (...a: any[]) => post(...a), update: (...a: any[]) => post(...a) } }));
import { ConflictSimulatorDialog } from './ConflictSimulatorDialog';

const policy = { mode: 'best_single', allowWithMembership: false, allowWithLoyalty: true, priceFloorPercent: 0, maxTotalDiscountPercent: null };
beforeEach(() => {
  conflictSimulator.mockClear(); post.mockClear();
  payload = { readOnly: true, cases: [
    { name: 'coupon_alone_card', lines: [{ lineId: 'gel', priceCents: 5000 }], offers: [{ id: 'coupon-20', category: 'coupon', description: 'Coupon 20%' }], policy,
      tenders: [{ kind: 'card', cents: 6400 }], refund: 'none',
      result: { subtotalCents: 8000, totalDiscountCents: 1600, dueCents: 6400, tenderedCents: 6400, applied: [{ id: 'coupon-20', category: 'coupon', description: 'Coupon 20%', appliedCents: 1600 }], rejected: [], refund: null, conflicts: [] } },
    { name: 'split_tenders_short', lines: [{ lineId: 'gel', priceCents: 5000 }], offers: [{ id: 'coupon-20', category: 'coupon', description: 'Coupon 20%' }, { id: 'deal-10', category: 'deal', description: 'Deal $10' }], policy,
      tenders: [{ kind: 'gift_card', cents: 2000 }, { kind: 'cash', cents: 4000 }], refund: ['pedi'],
      // deliberately not what a client-side recomputation would give: the panel must show the server's numbers
      result: { subtotalCents: 8000, totalDiscountCents: 1777, dueCents: 6223, tenderedCents: 6000, applied: [], rejected: [{ id: 'deal-10', reason: 'not_best' }], refund: null,
        conflicts: [{ code: 'offer_rejected', offerId: 'deal-10', reason: 'not_best' }, { code: 'tenders_short', cents: 223 }] } },
  ] };
});

describe('Promotions 15 — Checkout Conflict Simulator', () => {
  it('lists every staging ticket with the server\'s amounts and conflict counts, marked practice-only', async () => {
    render(<ConflictSimulatorDialog onClose={() => undefined} />);
    const rows = await screen.findAllByTestId('sim-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId('sim-readonly').textContent).toMatch(/nothing is charged/i);
    expect(screen.getByTestId('sim-summary').textContent).toBe('2 staging tickets · 1 with a conflict');
    expect(rows[0].textContent).toContain('Coupon alone, paid by card');
    expect(within(rows[1]).getByTestId('sim-conflict-count').textContent).toBe('2');
    expect(rows[1].textContent).toContain('$62.23');   // the server's due, not re-derived
    expect(rows[1].textContent).toContain('$17.77');
  });
  it('expands a ticket to its offers, payments, refund and each conflict in words; only one read, no writes', async () => {
    render(<ConflictSimulatorDialog onClose={() => undefined} />);
    fireEvent.click((await screen.findAllByTestId('sim-row'))[1]);
    const d = screen.getByTestId('sim-detail');
    expect(d.textContent).toContain('Gift card $20.00 + Cash $40.00');
    expect(d.textContent).toContain('Lines: pedi');
    const items = within(d).getAllByTestId('sim-conflict').map((x) => x.textContent);
    expect(items).toEqual(['deal-10 was not applied — another offer saves more', 'Payments are $2.23 short of the amount due']);
    fireEvent.click(screen.getAllByTestId('sim-row')[0]);
    expect(within(screen.getByTestId('sim-detail')).getByTestId('sim-conflicts').textContent).toMatch(/No conflicts/);
    expect(conflictSimulator).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
});
