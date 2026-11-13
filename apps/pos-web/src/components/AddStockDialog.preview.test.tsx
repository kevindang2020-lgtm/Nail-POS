// AddStockDialog — Products Management 09 (round 10): before Add Stock the server's preview for THIS location is shown —
// on hand now, still coming on purchase orders, after this receipt, after it + what is coming, each with its stock status
// (the server's, never re-derived) and the location's levels; nothing is saved until Add to inventory.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { inv } = vi.hoisted(() => ({ inv: { addStock: vi.fn(), stockPreview: vi.fn() } }));
vi.mock('../api/inventoryApi', () => ({ inventoryApi: inv }));
import { AddStockDialog } from './InventoryKit';

const pv = (quantity: number, over: Record<string, unknown> = {}) => ({ productId: 'p1', branch: { id: 'b1', name: 'Main' }, unit: 'jar', quantity, onHand: 2, incoming: 3, afterAdd: 2 + quantity, afterAddAndIncoming: 5 + quantity,
  reorderLevel: 8, criticalLevel: 4, maximumStock: 12, statusNow: 'critical', statusAfter: 'low', statusAfterIncoming: 'in_stock', clearsReorder: false, overMaximum: false, ...over });

describe('AddStockDialog — stock status preview', () => {
  it('shows the server preview for the typed quantity and re-asks when it changes; nothing is added', async () => {
    inv.stockPreview.mockImplementation(async (_id: string, q: number) => (q === 7 ? pv(7, { statusAfter: 'in_stock', clearsReorder: true }) : pv(q)));
    render(<AddStockDialog product={{ id: 'p1', name: 'Builder gel', unit: 'jar', onHand: 2 }} onClose={() => {}} onSaved={() => {}} />);
    const box = await screen.findByTestId('add-stock-preview');
    expect(inv.stockPreview).toHaveBeenCalledWith('p1', 6);
    expect(box.textContent).toContain('Preview for Main');
    expect(screen.getByTestId('add-stock-pv-now').textContent).toBe('On hand now2 Critical');
    expect(screen.getByTestId('add-stock-pv-after').textContent).toBe('After this receipt8 Low');
    expect(screen.getByTestId('add-stock-pv-afterIncoming').textContent).toBe('After this + what is on order11 In stock');
    expect(screen.getByTestId('add-stock-pv-incoming').textContent).toBe('Still coming on purchase orders3');
    expect(screen.getByTestId('add-stock-pv-levels').textContent).toBe('Reorder at 8 · critical at 4 · maximum 12');
    expect(screen.queryByTestId('add-stock-pv-clears')).toBeNull();
    fireEvent.change(screen.getByTestId('add-stock-qty'), { target: { value: '7' } });
    await waitFor(() => expect(screen.getByTestId('add-stock-pv-clears')).toBeInTheDocument());
    expect(screen.getByTestId('add-stock-pv-after').textContent).toBe('After this receipt9 In stock');
    expect(inv.addStock).not.toHaveBeenCalled();
  });
  it('an invalid quantity or an unavailable preview shows no preview (the plain before → after subtitle stays)', async () => {
    inv.stockPreview.mockReset(); inv.stockPreview.mockRejectedValue(new Error('offline'));
    render(<AddStockDialog product={{ id: 'p1', name: 'Builder gel', unit: 'jar', onHand: 2 }} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(inv.stockPreview).toHaveBeenCalled());
    expect(screen.queryByTestId('add-stock-preview')).toBeNull();
    inv.stockPreview.mockClear();
    fireEvent.change(screen.getByTestId('add-stock-qty'), { target: { value: '0' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(inv.stockPreview).not.toHaveBeenCalled();
  });
});
