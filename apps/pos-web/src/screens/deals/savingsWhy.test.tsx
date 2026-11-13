import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RedemptionsTable } from '../POSDiscountsScreen';

const row = (o: Record<string, unknown>) => ({ id: 'r1aaaaaaaa', at: '2026-11-01T10:00:00Z', customerName: 'Ann', ticketId: 't1', ticketNumber: '101', eligibleSubtotalCents: 8000, discountCents: 1000, finalCents: 7000, status: 'confirmed', dealId: 'd1', ...o });
describe('Discounts · automatic savings explanation', () => {
  it('each redemption shows eligible subtotal, rule, cap and saving as separate lines', () => {
    render(<RedemptionsTable compact rows={[row({})]} rule={{ discountType: 'percent', discountPercent: 20, maxDiscountCents: 1000 }} />);
    const why = screen.getByTestId('savings-why');
    expect(why.textContent).toMatch(/80\.00/); expect(why.textContent).toMatch(/16\.00/);
    expect(within(why).getByTestId('savings-why-cap').textContent).toMatch(/6\.00/);
    expect(within(why).queryByTestId('savings-why-diff')).toBeNull();
  });
  it('a recorded saving that differs from today\'s terms is kept and called out; no subtotal → no explainer', () => {
    render(<RedemptionsTable compact rows={[row({ discountCents: 1200 }), row({ id: 'r2bbbbbbbb', eligibleSubtotalCents: null })]} rule={{ discountType: 'fixed', discountCents: 1000 }} />);
    expect(screen.getAllByTestId('savings-why')).toHaveLength(1);
    expect(screen.getByTestId('savings-why-diff')).toBeInTheDocument();
  });
});

// Deals & Offers 08 — preview vs paid: the server's comparison is rendered as written (never re-derived here)
describe('Deals & Offers · preview vs paid', () => {
  const pvp = { estimateCents: 1600, paidCents: 1200, changeCents: -400, unchanged: false, changes: [
    { code: 'price_changed', lineId: 'a', beforeCents: 5000, afterCents: 6000, discountBeforeCents: 1000, discountAfterCents: 1200 },
    { code: 'line_removed', lineId: 'b', beforeCents: 3000, afterCents: null, discountBeforeCents: 600, discountAfterCents: null },
    { code: 'other_offers_or_limits', lineId: null, beforeCents: null, afterCents: null, discountBeforeCents: null, discountAfterCents: -200 },
  ] };
  it('shows first priced → paid and one plain line per change', () => {
    render(<RedemptionsTable compact rows={[row({ discountCents: 1200, previewVsPaid: pvp })]} />);
    const box = screen.getByTestId('pvp');
    expect(box.textContent).toContain('First priced −$16.00 → paid −$12.00');
    const lines = within(box).getAllByTestId('pvp-change').map((l) => l.textContent);
    expect(lines).toEqual([
      'A line went from $50.00 to $60.00 (discount −$10.00 → −$12.00)',
      'A $30.00 line came off the ticket (it carried −$6.00 off)',
      'Other offers on the ticket, a cap or the budget changed the discount by −$2.00',
    ]);
  });
  it('unchanged says so; no estimate on record shows nothing', () => {
    render(<RedemptionsTable compact rows={[row({ previewVsPaid: { ...pvp, changeCents: 0, unchanged: true, changes: [] } }), row({ id: 'r2bbbbbbbb', previewVsPaid: null })]} />);
    expect(screen.getAllByTestId('pvp-same')).toHaveLength(1);
    expect(screen.queryByTestId('pvp')).toBeNull();
  });
});
