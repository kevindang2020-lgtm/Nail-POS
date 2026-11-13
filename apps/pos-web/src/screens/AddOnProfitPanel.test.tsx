// AddOnProfitPanel.test.tsx — Extras · ADD-ONS 09: the server's add-on profitability with its basis stated; an add-on with
// no recipe shows "—" (never $0) and the uncosted sales are called out; the period goes to the server.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const addOnProfitability = vi.fn();
vi.mock('../api/posCatalogApi', () => ({ posCatalogApi: { addOnProfitability: (...a: any[]) => addOnProfitability(...a) } }));
import { AddOnProfitPanel } from './AddOnProfitPanel';

beforeEach(() => {
  addOnProfitability.mockReset();
  addOnProfitability.mockResolvedValue({ window: { days: 30, from: '2026-10-14T04:00:00Z', timeZone: 'America/New_York' },
    basis: { revenue: 'paid_tickets_line_totals', cost: 'recipe_at_current_product_cost', excludes: ['commission', 'tax', 'labor', 'refunded_or_voided_tickets'] },
    totals: { unitsSold: 5, revenueCents: 6700, costedRevenueCents: 5500, recipeCostCents: 730, contributionCents: 4770, addOnsWithoutRecipe: 1 },
    items: [
      { key: 'a', name: 'Nail Art', unitsSold: 3, ticketCount: 2, revenueCents: 4500, recipeUnitCostCents: 160, recipeCostCents: 480, contributionCents: 4020 },
      { key: 'c', name: 'Chrome', unitsSold: 1, ticketCount: 1, revenueCents: 1200, recipeUnitCostCents: null, recipeCostCents: null, contributionCents: null },
    ], page: 1, pageSize: 10, totalItems: 2, totalPages: 1 });
});

describe('ADD-ONS 09 — add-on profitability panel', () => {
  it('renders the server figures, "—" without a recipe, the uncosted sales and the basis', async () => {
    render(<AddOnProfitPanel />);
    const rows = await screen.findAllByTestId('pf-row');
    expect(rows[0].textContent).toContain('$45.00'); expect(rows[0].textContent).toContain('$4.80'); expect(rows[0].textContent).toContain('$40.20');
    expect(within(rows[1]).getAllByText('—')).toHaveLength(3);
    expect(within(rows[1]).queryByText('$0.00')).toBeNull();
    expect(screen.getByTestId('pf-norecipe').textContent).toBe('1 add-on(s) have no recipe, so no cost is shown for their $12.00 of sales (not counted in the cost totals).');
    expect(screen.getByTestId('pf-basis').textContent).toMatch(/today’s product cost .* Before commission, tax and labor\./);
    expect(addOnProfitability).toHaveBeenCalledWith({ days: 30, page: 1, pageSize: 10 });
  });
  it('a different period is asked of the server', async () => {
    render(<AddOnProfitPanel />);
    await screen.findAllByTestId('pf-row');
    fireEvent.change(screen.getByTestId('pf-days'), { target: { value: '90' } });
    await waitFor(() => expect(addOnProfitability).toHaveBeenLastCalledWith({ days: 90, page: 1, pageSize: 10 }));
  });
});
