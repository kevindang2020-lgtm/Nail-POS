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
