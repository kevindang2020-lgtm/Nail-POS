// ProductFormDialog — concurrent-edit protection (Products backlog · 17): an edit carries the updatedAt the form opened with;
// the server's 409 PRODUCT_CHANGED message is shown and nothing is reported as saved.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { inv } = vi.hoisted(() => ({ inv: { categories: vi.fn(async () => ({ categories: [] })), brands: vi.fn(async () => ({ brands: [] })), vendors: vi.fn(async () => ({ vendors: [] })),
  updateProduct: vi.fn(), createProduct: vi.fn(), setStockOverrides: vi.fn(), productDuplicates: vi.fn(async () => ({ candidates: [], checked: {} })) as any } }));
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

// Products Management 07 (round 10): a NEW product first shows the server's possible duplicates for review (nothing created);
// a second Create with the same name / codes creates it anyway; changing a code checks again
describe('ProductFormDialog — duplicate product warning', () => {
  it('shows the candidates with their reasons, creates nothing until Create is pressed again', async () => {
    inv.createProduct.mockReset(); inv.createProduct.mockResolvedValue({ id: 'new1' });
    inv.productDuplicates = vi.fn(async () => ({ candidates: [{ productId: 'p9', name: 'OPI Gel Base', sku: 'OPI-GB-15', barcode: null, reasons: ['sku_near', 'supplier_sku'], supplierSku: 'NSC 7788', supplierName: 'Nail Supply Co' }], checked: { sku: true, barcode: false, supplierSku: false, name: true } }));
    const onSaved = vi.fn();
    render(<ProductFormDialog onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByTestId('pf-name'), { target: { value: 'OPI gel base' } });
    fireEvent.change(screen.getByTestId('pf-sku'), { target: { value: 'opi gb 15' } });
    fireEvent.click(screen.getByTestId('product-save'));
    const box = await screen.findByTestId('pf-dups');
    expect(inv.productDuplicates).toHaveBeenCalledWith({ name: 'OPI gel base', sku: 'opi gb 15', barcode: '' });
    expect(box.textContent).toContain('1 possible duplicate(s) — please review');
    expect(screen.getByTestId('pf-dup-p9').textContent).toBe('OPI Gel Base · SKU OPI-GB-15 — almost the same SKU, supplier SKU NSC 7788 (Nail Supply Co)');
    expect(inv.createProduct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('product-save'));   // reviewed → create anyway
    await waitFor(() => expect(inv.createProduct).toHaveBeenCalledTimes(1));
    expect(inv.productDuplicates).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new1'));
  });
  it('no candidate → created at once; the manual check says so; a changed SKU is checked again', async () => {
    inv.createProduct.mockReset(); inv.createProduct.mockResolvedValue({ id: 'new2' });
    inv.productDuplicates = vi.fn(async () => ({ candidates: [], checked: { sku: true, barcode: false, supplierSku: false, name: true } }));
    const onSaved = vi.fn();
    render(<ProductFormDialog onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByTestId('pf-name'), { target: { value: 'Brand new' } });
    fireEvent.click(screen.getByTestId('pf-dup-check'));
    expect(await screen.findByTestId('pf-dups-none')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('pf-sku'), { target: { value: 'BN-1' } });
    expect(screen.queryByTestId('pf-dups-none')).toBeNull();   // the earlier answer was for other codes
    fireEvent.click(screen.getByTestId('product-save'));
    await waitFor(() => expect(inv.createProduct).toHaveBeenCalledTimes(1));
    expect(inv.productDuplicates).toHaveBeenCalledTimes(2);
  });
});
