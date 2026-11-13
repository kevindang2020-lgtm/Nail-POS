// Add Stock — round 10 (Inventory 10): every save carries an Idempotency-Key; an unknown outcome (no answer / 5xx) says a retry
// is safe and the retry reuses the SAME key (the server answers from the first save — never added twice); a refusal does not.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const inv = vi.hoisted(() => ({ addStock: vi.fn() }));
vi.mock('../api/inventoryApi', () => ({ inventoryApi: inv }));
import { AddStockDialog } from '../components/InventoryKit';
beforeEach(() => inv.addStock.mockReset());

describe('Add Stock — safe retry', () => {
  it('no answer → "retry is safe"; the retry sends the same key and the dialog completes', async () => {
    inv.addStock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { status: undefined })).mockResolvedValueOnce({ product: { id: 'p1' } });
    const saved = vi.fn();
    render(<AddStockDialog product={{ id: 'p1', name: 'Rose Gel', unit: 'bottle', onHand: 3 }} onClose={() => {}} onSaved={saved} />);
    fireEvent.click(screen.getByTestId('add-stock-save'));
    expect(await screen.findByTestId('add-stock-unsure')).toHaveTextContent('never counts it twice');
    fireEvent.click(screen.getByTestId('add-stock-save'));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(inv.addStock).toHaveBeenCalledTimes(2);
    const [k1, k2] = [inv.addStock.mock.calls[0][2], inv.addStock.mock.calls[1][2]];
    expect(typeof k1).toBe('string'); expect(k2).toBe(k1);
  });
  it('a refusal (4xx) is not unknown: no retry note; changing the quantity makes a NEW key', async () => {
    inv.addStock.mockRejectedValueOnce(Object.assign(new Error('Too many'), { status: 400 })).mockResolvedValueOnce({ product: { id: 'p1' } });
    render(<AddStockDialog product={{ id: 'p1', name: 'Rose Gel', unit: 'bottle', onHand: 3 }} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByTestId('add-stock-save'));
    await waitFor(() => expect(inv.addStock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('add-stock-unsure')).toBeNull();
    fireEvent.change(screen.getByTestId('add-stock-qty'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('add-stock-save'));
    await waitFor(() => expect(inv.addStock).toHaveBeenCalledTimes(2));
    expect(inv.addStock.mock.calls[1][2]).not.toBe(inv.addStock.mock.calls[0][2]);
  });
});
