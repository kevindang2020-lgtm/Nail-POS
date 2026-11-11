// ProductFormDialog — concurrent-edit protection (Products backlog · 17): an edit carries the updatedAt the form opened with;
// the server's 409 PRODUCT_CHANGED message is shown and nothing is reported as saved.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { inv } = vi.hoisted(() => ({ inv: { categories: vi.fn(async () => ({ categories: [] })), brands: vi.fn(async () => ({ brands: [] })), vendors: vi.fn(async () => ({ vendors: [] })),
  updateProduct: vi.fn(), createProduct: vi.fn(), setStockOverrides: vi.fn() } }));
vi.mock('../api/inventoryApi', () => ({ inventoryApi: inv }));
import { ProductFormDialog } from './InventoryKit';

const product = { id: 'p1', name: 'Polish A', unit: 'bottle', trackingMode: 'bottle', reorderLevel: 3, reorderQuantity: 6, updatedAt: '2026-11-11T10:00:00.123Z', thresholds: {} };
describe('ProductFormDialog — concurrent edit', () => {
  it('sends expectedUpdatedAt and shows the server refusal without calling onSaved', async () => {
    inv.updateProduct.mockRejectedValue(Object.assign(new Error('This product was changed on another device since you opened it. Reload and try again.'), { status: 409, code: 'PRODUCT_CHANGED' }));
    const onSaved = vi.fn();
    render(<ProductFormDialog product={product} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.click(screen.getByTestId('product-save'));
    await waitFor(() => expect(inv.updateProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Polish A', expectedUpdatedAt: '2026-11-11T10:00:00.123Z' })));
    expect(await screen.findByText(/changed on another device/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
