// payments-summary.spec — batch 9 guide 13 (Nov 10 2026): every collected method counts; a split is a real count
import { describe, it, expect } from 'vitest';
import { buildReportsState } from './reports.repository';

const row = (id: string, ticketId: string, method: string, cents: number, status: 'completed' | 'refunded' = 'completed') => ({
  id, ticketId, at: '2026-11-05', occurredAt: '2026-11-05T15:00:00Z', customerId: 'c', customer: 'Ann', customerType: 'returning', technicianId: 't', technician: 'Lisa',
  service: 'Mani', category: 'Nails', paymentMethod: method, bookingSource: 'walk_in', grossCents: cents, discountCents: 0, surchargeCents: 0, taxCents: 0, tipCents: 0, status }) as any;

describe('payments summary', () => {
  it('collects every method (cash to technician, reward, deposit …) and counts split tickets', () => {
    const { state } = buildReportsState([
      row('p1', 'T1', 'card', 3000), row('p2', 'T1', 'cash', 2000),          // a split ticket
      row('p3', 'T2', 'cash_to_technician', 4000), row('p4', 'T3', 'global_reward', 500), row('p5', 'T4', 'giftCard', 1000),
      row('r1', 'T2', 'cash_to_technician', 4000, 'refunded'),
    ], { from: '2026-11-01', to: '2026-11-10' }, 'b');
    expect(state.payments).toMatchObject({ cardCents: 3000, cashCents: 2000, giftCardCents: 1000, otherCents: 4500, collectedCents: 10500, splitCount: 1 });
    expect(state.payments.byMethod).toEqual({ card: 3000, cash: 2000, cash_to_technician: 4000, global_reward: 500, giftCard: 1000 });
  });
});
