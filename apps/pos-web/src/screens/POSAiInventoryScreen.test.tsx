// POSAiInventoryScreen — AI Inventory Assistant. The four tabs stay; the Command Center reads the inventory center (Nov 3 2026 guides): the
// six cards with a definition each, the reasons behind Critical (own level vs half the reorder level), products with no levels and stock
// that differs from its history, the product list and stock activity as server queries, and Check Inventory System.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { center, lowMock, reorderMock, slowMock } = vi.hoisted(() => ({
  center: { summary: vi.fn(), products: vi.fn(), activity: vi.fn(), check: vi.fn() }, lowMock: vi.fn(), reorderMock: vi.fn(), slowMock: vi.fn(),
}));
vi.mock('../api/posAiInventoryApi', () => ({
  posAiInventoryApi: { center, lowStock: lowMock, reorder: reorderMock, slowMoving: slowMock },
}));
import { POSAiInventoryScreen } from './POSAiInventoryScreen';
const page = (items: any[], o: any = {}) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' }, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  center.summary.mockResolvedValue({ scope: 'branch', cards: { products: 11, inStock: 0, low: 0, critical: 11, outOfStock: 0, overstock: 0 },
    reasons: { criticalExplicit: 0, criticalDerived: 11, noThreshold: 2, ledgerMismatch: 1, noStockRecord: 0, withOpenOrders: 0 } });
  center.products.mockResolvedValue(page([{ id: 'p1', name: 'Gel base coat', sku: 'GEL-01', category: null, vendor: 'Sally Beauty', onHand: 3, reserved: 0, openOrderQty: 0, reorderLevel: 10, criticalLevel: 5,
    criticalSource: 'derived', status: 'critical', noThreshold: false, hasStockRecord: true, ledgerBalance: 4, ledgerMismatch: true }]));
  center.activity.mockResolvedValue(page([{ id: 'm1', at: '2026-11-02T15:00:00Z', group: 'service_usage', product: 'Gel base coat', change: -6, after: 4, reason: 'Gel manicure', actor: 'Tech Mai' }]));
  lowMock.mockResolvedValue({ branchId: 'B1', items: [
    { productId: 'p1', name: 'Acetone', sku: 'AC-1', categoryName: 'Consumable', sellableAvailable: 3, reorderLevel: 10, confirmedInbound: 0, severity: 'critical', vendorName: 'BeautyCo', leadTimeDays: 7 },
  ] });
  reorderMock.mockResolvedValue({ branchId: 'B1', costVisible: true, recommendations: [] });
  slowMock.mockResolvedValue({ branchId: 'B1', costVisible: true, windowDays: 90, items: [] });
});

describe('POSAiInventoryScreen', () => {
  it('renders the six Command Center cards with definitions and explains "11 Critical, 0 Out of Stock"', async () => {
    render(<POSAiInventoryScreen />);
    await waitFor(() => expect(screen.getByTestId('icx-card-critical')).toHaveTextContent('11'));
    expect(screen.getByTestId('icx-card-out_of_stock')).toHaveTextContent('None left');
    expect(screen.getByTestId('icx-reasons')).toHaveTextContent('11 critical because they are at or below half their reorder level');
    expect(screen.getByTestId('icx-reasons')).toHaveTextContent('2 product(s) have no reorder or critical level');
  });
  it('the product list shows levels, their source and the history difference; filters reach the server', async () => {
    render(<POSAiInventoryScreen />);
    const r = await screen.findByTestId('icx-product-row');
    expect(r).toHaveTextContent('Gel base coat'); expect(r).toHaveTextContent('(half the reorder level)'); expect(r).toHaveTextContent('History says 4');
    fireEvent.change(screen.getByTestId('icx-status'), { target: { value: 'ledger_mismatch' } });
    await waitFor(() => expect(center.products).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ledger_mismatch', page: 1 })));
  });
  it('stock activity: newest first, type and presets reach the server', async () => {
    render(<POSAiInventoryScreen />);
    expect(await screen.findByTestId('icx-move-row')).toHaveTextContent('Used in a service');
    fireEvent.change(screen.getByTestId('icx-type'), { target: { value: 'received' } });
    fireEvent.click(screen.getByTestId('icx-preset-last_30'));
    await waitFor(() => expect(center.activity).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'received', preset: 'last_30', page: 1 })));
  });
  it('Check Inventory System renders localized checks with part and last pass', async () => {
    center.check.mockResolvedValue({ overall: 'FAILED', checkedAt: '2026-11-03T05:00:00Z', checks: [{ key: 'ledger_matches_stock', component: 'ledger', state: 'FAILED', count: 1, lastPassedAt: null }] });
    render(<POSAiInventoryScreen />);
    fireEvent.click(await screen.findByTestId('icx-check'));
    const k = await screen.findByTestId('icx-chk-ledger_matches_stock');
    expect(k).toHaveTextContent('Stock matches its history'); expect(k).toHaveTextContent('Part: Stock history'); expect(k).toHaveTextContent('Has not passed yet');
  });
  it('extras AI Inventory 12 / 18: duplicate SKU and count-vs-ledger checks are shown in words', async () => {
    center.check.mockResolvedValue({ overall: 'FAILED', checkedAt: '2026-11-03T05:00:00Z', checks: [
      { key: 'count_variance_applied', component: 'ledger', state: 'FAILED', count: 1, lastPassedAt: null },
      { key: 'sku_unique', component: 'catalog', state: 'WARNING', count: 2, lastPassedAt: null }] });
    render(<POSAiInventoryScreen />);
    fireEvent.click(await screen.findByTestId('icx-check'));
    const c = await screen.findByTestId('icx-chk-count_variance_applied');
    expect(c).toHaveTextContent('Physical counts reached the ledger'); expect(c).toHaveTextContent('Recount those products');
    const s = screen.getByTestId('icx-chk-sku_unique');
    expect(s).toHaveTextContent('Every SKU belongs to one product'); expect(s).toHaveTextContent('Part: Product catalog'); expect(s).toHaveTextContent('2');
  });
  it('extras AI Inventory 03 / 11: a product row opens its details overlay with that product\'s own stock history (productId, paged)', async () => {
    render(<POSAiInventoryScreen />);
    fireEvent.click((await screen.findAllByTestId('icx-product-row'))[0]);
    const o = await screen.findByTestId('icx-product-overlay');
    await waitFor(() => expect(center.activity).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', page: 1, pageSize: 10 })));
    const f = screen.getByTestId('icx-po-fields');
    expect(f).toHaveTextContent('GEL-01'); expect(f).toHaveTextContent('Sally Beauty'); expect(f).toHaveTextContent('differs from the stock record');
    expect(f.textContent).toMatch(/Barcode—/);
    expect(await screen.findAllByTestId('icx-po-move')).toHaveLength(1);
    expect(o).toHaveTextContent('Gel manicure');
  });
  it('loads Low Stock when its tab is selected', async () => {
    render(<POSAiInventoryScreen />);
    await screen.findByTestId('icx-panel');
    fireEvent.click(screen.getByText('Low Stock'));
    expect(await screen.findByText('Acetone')).toBeInTheDocument();
    expect(screen.getByText('BeautyCo')).toBeInTheDocument();
  });
  it('the old context read is retired from the client', async () => {
    const actual = await vi.importActual<any>('../api/posAiInventoryApi');
    expect(actual.posAiInventoryApi.context).toBeUndefined();
  });
  it('SUNMI: the six KPI cards and the four buttons stay visible together on every tab; the Command Center detail only on its tab', async () => {
    render(<POSAiInventoryScreen />);
    await waitFor(() => expect(screen.getByTestId('icx-card-critical')).toHaveTextContent('11'));
    expect(screen.getByTestId('icx-kpis').children).toHaveLength(6);
    expect(screen.getByTestId('icx-actions').querySelectorAll('button')).toHaveLength(4);
    fireEvent.click(screen.getByTestId('inv-tab-low'));
    expect(await screen.findByText('Acetone')).toBeInTheDocument();
    expect(screen.getByTestId('icx-kpis').children).toHaveLength(6);
    expect(screen.getByTestId('icx-actions').querySelectorAll('button')).toHaveLength(4);
    expect(screen.queryByTestId('icx-reasons')).toBeNull();
  });
});

