// TenantInventoryScreen — one purchase-order workspace (Nov 7 2026): a Reorder (Stock Alerts / Products / Inventory) opens
// Inventory → Purchase Orders with a DRAFT prefilled with the product, quantity and supplier — what the removed standalone
// Purchase Orders page did. Nothing is saved until Create; the link's parameters are used once.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
const create = vi.fn(async () => ({ id: 'po-new', poNumber: 'PO-9' }));
const draft = vi.fn(async (): Promise<any> => ({}));   // an older server / no answer → the link's own values stay
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers'); return { posInventoryScreenApi: h.anyApi({ metrics: async () => h.METRICS, purchaseOrders: async () => ({ ...h.emptyPage(), rows: [], total: 0 }) }), posSuppliersApi: h.anyApi() }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi({
  products: async () => ({ products: [{ id: 'p1', name: 'Polish A' }, { id: 'p2', name: 'Acetone' }] }),
  vendors: async () => ({ vendors: [{ id: 'v1', name: 'Supply Co' }] }),
  createPurchaseOrder: (...a: any[]) => (create as any)(...a),
  reorderDraft: (...a: any[]) => (draft as any)(...a),
}) }));
vi.mock('../api/posInventoryAlertsApi', async () => ({ posInventoryAlertsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posAiApi', async () => ({ posAiApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { TenantInventoryScreen } from './TenantInventoryScreen';

let search = '';
function Spy() { search = useLocation().search; return null; }

describe('Reorder → a prefilled draft purchase order', () => {
  it('opens the draft with the product, quantity and supplier; the link parameters are dropped from the address', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory?tab=purchaseOrders&new=1&productId=p2&qty=6&vendorId=v1']}>
      <Routes><Route path="/tenant/inventory" element={<><TenantInventoryScreen /><Spy /></>} /></Routes></MemoryRouter>);
    expect(await screen.findByDisplayValue('6')).toBeInTheDocument();
    await waitFor(() => expect((screen.getAllByRole('combobox') as HTMLSelectElement[]).some((s) => s.value === 'v1')).toBe(true));
    expect((screen.getAllByRole('combobox') as HTMLSelectElement[]).some((s) => s.value === 'p2')).toBe(true);
    await waitFor(() => expect(search).toBe('?tab=purchaseOrders'));
    expect(create).not.toHaveBeenCalled();   // a draft is only saved by Create
  });
  it('without new=1 nothing opens', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory?tab=purchaseOrders']}><TenantInventoryScreen /></MemoryRouter>);
    expect(await screen.findByTestId('new-po')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('6')).toBeNull();
    fireEvent.click(screen.getByTestId('new-po'));
    expect(await screen.findByDisplayValue('12')).toBeInTheDocument();   // the ordinary new draft
  });
  // Products Management 14 (round 10): the server prefills the draft from the VERIFIED supplier mapping — supplier, packs (THE
  // reorder rule) and the supplier's last cost — and says so; no mapping → it says so and guesses nothing
  it('uses the server\'s reorder draft: mapped supplier, packs and cost, with the basis and the approval note', async () => {
    draft.mockImplementationOnce(async () => ({ productId: 'p2', productName: 'Acetone', branchId: 'b1', unit: 'bottle', onHand: 3, onOrder: 0, reorderLevel: 10, reorderQuantity: 12, suggestedUnits: 12,
      mapping: { vendorId: 'v1', vendorName: 'Supply Co', supplierSku: 'A-AC1', unitCostCents: 900, purchaseUnit: 'case', unitsPerPurchaseUnit: 4, minimumOrderQty: null, leadTimeDays: null }, purchaseUnitsToOrder: 3, unitsThatArrive: 12 }));
    render(<MemoryRouter initialEntries={['/tenant/inventory?tab=purchaseOrders&new=1&productId=p2&qty=12']}><TenantInventoryScreen /></MemoryRouter>);
    const basis = await screen.findByTestId('po-reorder-basis');
    expect(draft).toHaveBeenCalledWith('p2');
    expect(basis.textContent).toBe('From the verified supplier mapping: Supply Co · supplier SKU A-AC1 · pack of 4 — 3 pack(s) = 12 unit(s). On hand 3, on order 0, reorder at 10. This is a draft: nothing is ordered until it is created and approved.');
    expect(await screen.findByDisplayValue('3')).toBeInTheDocument();      // packs, not the 12 bottles of the link
    expect(screen.getByDisplayValue('9.00')).toBeInTheDocument();
    await waitFor(() => expect((screen.getAllByRole('combobox') as HTMLSelectElement[]).some((s) => s.value === 'v1')).toBe(true));
    expect(create).not.toHaveBeenCalled();
  });
  it('no verified mapping: says so, keeps the suggested quantity, picks no supplier', async () => {
    draft.mockImplementationOnce(async () => ({ productId: 'p2', productName: 'Acetone', branchId: 'b1', unit: 'bottle', onHand: 3, onOrder: 0, reorderLevel: 10, reorderQuantity: 12, suggestedUnits: 12, mapping: null, purchaseUnitsToOrder: 12, unitsThatArrive: 12 }));
    render(<MemoryRouter initialEntries={['/tenant/inventory?tab=purchaseOrders&new=1&productId=p2&qty=12']}><TenantInventoryScreen /></MemoryRouter>);
    expect((await screen.findByTestId('po-reorder-basis')).textContent).toContain('No verified supplier mapping for this product');
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    expect((screen.getAllByRole('combobox') as HTMLSelectElement[]).some((s) => s.value === 'v1')).toBe(false);
  });
});
