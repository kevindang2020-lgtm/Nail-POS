import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RedemptionsTable, DiscountDetailsDialog } from '../POSDiscountsScreen';

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

// round 10 — Deals & Offers 09: each use names the rules version it was charged under (server value, never re-derived)
describe('Deals & Offers · rule version per use', () => {
  it('shows the version used, that the rules changed since, and when the terms are not on record', () => {
    render(<RedemptionsTable compact rows={[row({ ruleVersion: { used: 2, current: 3, changedSince: true, frozen: true } }), row({ id: 'r2bbbbbbbb', ruleVersion: { used: 1, current: 1, changedSince: false, frozen: false } }), row({ id: 'r3cccccccc' })]} />);
    const v = screen.getAllByTestId('red-version');
    expect(v).toHaveLength(2);
    expect(v[0].textContent).toBe('Charged under rules version 2 · rules changed since (now version 3) — this use keeps its own terms');
    expect(v[1].textContent).toBe('Charged under rules version 1 · terms at payment time not on record');
  });
});

// round 10 — Coupons 08: version history names the approver and each version's changes against the one before (server values)
describe('Coupons · change history with approver and before → after', () => {
  it('renders approver, the changed fields before → after, and "First version"', async () => {
    const x = { id: 'd1', code: '••••NG20', name: 'vishal', lifecycle: 'active', discountType: 'percent', discountPercent: 25, history: [
      { id: 'v2', version: 2, at: '2026-11-02T10:00:00Z', actor: 'Kim', terms: { discountPercent: 25, minSpendCents: 5000 }, approvedBy: 'Olivia Owner', approvedAt: '2026-11-02T11:00:00Z', changes: [{ field: 'discountPercent', before: 20, after: 25 }, { field: 'minSpendCents', before: null, after: 5000 }] },
      { id: 'v1', version: 1, at: '2026-11-01T10:00:00Z', actor: 'Kim', terms: { discountPercent: 20 }, approvedBy: null, approvedAt: null, changes: null }] };
    render(<DiscountDetailsDialog id="d1" initialTab="history" tick={0} onClose={() => undefined} onCustomer={() => undefined} extras={{ load: async () => x } as any} />);
    const rows = await screen.findAllByTestId('dd-history-row');
    expect(within(rows[0]).getByTestId('dd-history-approver').textContent).toMatch(/^Olivia Owner · /);
    expect(within(rows[0]).getByTestId('dd-history-changes').textContent).toMatch(/: 20 → 25 · .*: — → \$50\.00$/);
    expect(within(rows[1]).getByTestId('dd-history-changes').textContent).toBe('First version');
    expect(within(rows[1]).getByTestId('dd-history-approver').textContent).toBe('—');
  });
});
