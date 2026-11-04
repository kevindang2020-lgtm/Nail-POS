// TenantInventoryScreen — recipe editor (audit D9, Nov 4 2026): a recipe amount has up to two decimals (0.25 bottle); it was
// forced to a whole number of at least 1. The line cost is exact and an empty amount cannot be saved.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const setServiceRecipe = vi.fn(async () => ({}));
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers'); return { posInventoryScreenApi: h.anyApi(), posSuppliersApi: h.anyApi() }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: { ...(await import('./_invmocks.test-helpers')).anyApi(),
  serviceRecipe: async () => ({ service: { id: 's1', name: 'Gel Mani' }, lines: [{ id: 'l1', product_id: 'p1', quantity: 1, product_name: 'Gel Top', color_number: null, cost_cents: 1000 }], recipeCostCents: 1000 }),
  setServiceRecipe: (...a: unknown[]) => (setServiceRecipe as any)(...a) } }));
vi.mock('../api/posInventoryAlertsApi', async () => ({ posInventoryAlertsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posAiApi', async () => ({ posAiApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { RecipeEditorModal } from './TenantInventoryScreen';

describe('recipe editor amounts', () => {
  it('accepts 0.25, shows the exact cost, sends 0.25', async () => {
    render(<RecipeEditorModal serviceId="s1" products={[{ id: 'p1', name: 'Gel Top', cost_cents: 1000 } as any]} onClose={() => {}} onSaved={() => {}} />);
    const qty = await screen.findByTestId('recipe-qty');
    fireEvent.change(qty, { target: { value: '0.257' } });   // a third decimal is dropped
    expect((qty as HTMLInputElement).value).toBe('0.25');
    expect(screen.getAllByText('$2.50').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('recipe-save'));
    await waitFor(() => expect(setServiceRecipe).toHaveBeenCalledWith('s1', [{ productId: 'p1', quantity: 0.25 }]));
  });
  it('an empty amount cannot be saved', async () => {
    render(<RecipeEditorModal serviceId="s1" products={[{ id: 'p1', name: 'Gel Top', cost_cents: 1000 } as any]} onClose={() => {}} onSaved={() => {}} />);
    const qty = await screen.findByTestId('recipe-qty');
    fireEvent.change(qty, { target: { value: '' } });
    expect(screen.getByTestId('recipe-save')).toBeDisabled();
  });
});
