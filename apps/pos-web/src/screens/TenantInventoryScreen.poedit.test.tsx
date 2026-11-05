// TenantInventoryScreen — D9 gaps (Nov 5 2026): a DRAFT purchase order has Edit; it opens the order's lines and saves the
// change through PATCH (the supplier is not sent — it stays). An approved order has no Edit.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const PO_ROWS = [
  { id: 'po-d', poNumber: 'PO-D', status: 'draft', totalCents: 2000, lines: 1, ordered: 2, received: 0, remaining: 2, remainingCents: 2000, createdAt: '2026-11-01T12:00:00Z' },
  { id: 'po-a', poNumber: 'PO-A', status: 'approved', totalCents: 1000, lines: 1, ordered: 1, received: 0, remaining: 1, remainingCents: 1000, createdAt: '2026-11-01T12:00:00Z' },
];
const update = vi.fn(async () => ({ purchaseOrder: {}, lines: [] }));
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers'); return { posInventoryScreenApi: h.anyApi({ metrics: async () => h.METRICS, purchaseOrders: async () => ({ ...h.emptyPage(), rows: PO_ROWS, total: 2 }) }), posSuppliersApi: h.anyApi() }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi({
  products: async () => ({ products: [{ id: 'p1', name: 'Polish A' }] }),
  vendors: async () => ({ vendors: [{ id: 'v1', name: 'Supply Co' }] }),
  purchaseOrder: async () => ({ purchaseOrder: { po_number: 'PO-D', vendor_id: 'v1', shipping_cents: 500 }, lines: [{ id: 'l1', product_id: 'p1', quantity_ordered: 2, quantity_received: 0, unit_cost_cents: 1000 }] }),
  updatePurchaseOrder: (...a: any[]) => (update as any)(...a),
}) }));
vi.mock('../api/posInventoryAlertsApi', async () => ({ posInventoryAlertsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posAiApi', async () => ({ posAiApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { TenantInventoryScreen } from './TenantInventoryScreen';

describe('edit a draft purchase order', () => {
  it('only the draft row has Edit; saving sends the lines and shipping without the supplier', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory?tab=purchaseOrders']}><TenantInventoryScreen /></MemoryRouter>);
    const edits = await screen.findAllByTestId('po-edit');
    expect(edits).toHaveLength(1);
    fireEvent.click(edits[0]);
    expect(await screen.findByTestId('po-edit-note')).toBeInTheDocument();
    const qty = await screen.findByDisplayValue('2');
    fireEvent.change(qty, { target: { value: '5' } });
    fireEvent.click(screen.getByText(/Save changes|Lưu thay đổi/));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const [id, body] = (update.mock.calls[0] as any[]);
    expect(id).toBe('po-d');
    expect(body.vendorId).toBeUndefined();
    expect(body).toMatchObject({ shippingCents: 500, lines: [{ productId: 'p1', quantityOrdered: 5, unitCostCents: 1000 }] });
  });
});
