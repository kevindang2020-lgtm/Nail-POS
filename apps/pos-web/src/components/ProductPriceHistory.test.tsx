// Products backlog · 11 readable price history: the Pricing tab lists audited cost / retail changes (before → after, who,
// when, why) and says past receipts keep their price; an edit that changes a price may send a reason.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { inv, scr } = vi.hoisted(() => ({
  inv: { categories: vi.fn(async () => ({ categories: [] })), brands: vi.fn(async () => ({ brands: [] })), vendors: vi.fn(async () => ({ vendors: [] })), updateProduct: vi.fn(async (_id: string, _body: Record<string, unknown>) => ({})), createProduct: vi.fn(), setStockOverrides: vi.fn() },
  scr: { product: vi.fn(), movements: vi.fn(async () => ({ rows: [], total: 0, page: 1, pageSize: 6, pages: 1 })) },
}));
vi.mock('../api/inventoryApi', () => ({ inventoryApi: inv }));
vi.mock('../api/posInventoryScreenApi', () => ({ posInventoryScreenApi: scr, posSuppliersApi: {} }));
import { ProductDetailsDialog, ProductFormDialog } from './InventoryKit';

const product = { id: 'p1', name: 'Polish A', unit: 'bottle', trackingMode: 'bottle', reorderLevel: 3, reorderQuantity: 6, costCents: 400, retailCents: 1200, updatedAt: '2026-11-11T10:00:00.123Z', thresholds: { reorderLevel: 3, criticalLevel: 1 }, onHand: 2, expired: 0 };

describe('Products · 11 price history', () => {
  it('the Pricing tab shows each change with before → after, actor and reason, newest first', async () => {
    scr.product.mockResolvedValue({ product, bottles: [], suppliers: [], purchaseOrders: [], audit: [], priceHistory: [
      { id: 'a2', at: '2026-11-10T15:00:00Z', actor: 'Mia Manager', reason: null, retail: { before: 1500, after: 1200 }, cost: null },
      { id: 'a1', at: '2026-11-01T15:00:00Z', actor: 'Olive Owner', reason: 'Supplier raised cost', retail: { before: 1000, after: 1500 }, cost: { before: 350, after: 400 } },
    ] });
    render(<ProductDetailsDialog productId="p1" onClose={() => {}} onChanged={() => {}} can={() => true} initialTab="pricing" />);
    const rows = await screen.findAllByTestId('price-change');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Retail \$15\.00 → \$12\.00/);
    expect(rows[0]).toHaveTextContent(/Mia Manager/);
    expect(rows[1]).toHaveTextContent(/Retail \$10\.00 → \$15\.00 · Cost \$3\.50 → \$4\.00/);
    expect(rows[1]).toHaveTextContent(/why: Supplier raised cost/);
    expect(screen.getByTestId('pd-price-receipts')).toHaveTextContent(/never rewrites/);
  });
  it('no recorded changes is said plainly', async () => {
    scr.product.mockResolvedValue({ product, bottles: [], suppliers: [], purchaseOrders: [], audit: [] });
    render(<ProductDetailsDialog productId="p1" onClose={() => {}} onChanged={() => {}} can={() => true} initialTab="pricing" />);
    expect(await screen.findByTestId('pd-price-history')).toHaveTextContent(/No price changes recorded yet/);
  });
  it('the edit form asks why only when a price changed, and sends the reason with the save', async () => {
    render(<ProductFormDialog product={product} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.queryByTestId('pf-price-reason')).toBeNull();
    fireEvent.change(screen.getByTestId('pf-retail'), { target: { value: '15.00' } });
    fireEvent.change(screen.getByTestId('pf-price-reason'), { target: { value: 'New season price' } });
    fireEvent.click(screen.getByTestId('product-save'));
    await waitFor(() => expect(inv.updateProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ retailPriceCents: 1500, priceChangeReason: 'New season price' })));
  });
  it('an edit with unchanged prices sends no reason', async () => {
    inv.updateProduct.mockClear();
    render(<ProductFormDialog product={product} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByTestId('product-save'));
    await waitFor(() => expect(inv.updateProduct).toHaveBeenCalled());
    expect(inv.updateProduct.mock.calls[0][1]).not.toHaveProperty('priceChangeReason');
  });
  it('an edit by a viewer whose prices are hidden (blank) never sends a price, so it cannot wipe one', async () => {
    inv.updateProduct.mockClear();
    render(<ProductFormDialog product={{ ...product, costCents: null, retailCents: null }} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByTestId('product-save'));
    await waitFor(() => expect(inv.updateProduct).toHaveBeenCalled());
    const body = inv.updateProduct.mock.calls[0][1];
    expect(body).not.toHaveProperty('costCents');
    expect(body).not.toHaveProperty('retailPriceCents');
  });
});
