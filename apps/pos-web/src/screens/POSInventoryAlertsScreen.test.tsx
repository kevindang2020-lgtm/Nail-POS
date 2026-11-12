// Inventory → Stock Alerts (Oct 29 2026 one-screen rebuild): the KPIs come from the server's ONE alert scope (the same number
// the sidebar shows), every product row shows "Last Used By" or "No recorded use", the four workspaces read their own server
// lists, and Record Product Use sends one request with an idempotency key (a double tap replays, never takes stock twice).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const api = vi.hoisted(() => ({ summary: vi.fn(), active: vi.fn(), history: vi.fn(), usage: vi.fn(), ledger: vi.fn(), technicians: vi.fn(), pickers: vi.fn(), event: vi.fn(), acknowledge: vi.fn(), record: vi.fn(), adjust: vi.fn(), exportCsv: vi.fn(), cause: vi.fn() }));
vi.mock('../api/posInventoryAlertsApi', () => ({ posInventoryAlertsApi: api }));
let perms: string[] = [];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u', role: 'MANAGER', permissions: perms } }) }));
import { POSInventoryAlertsScreen } from './POSInventoryAlertsScreen';

const PERIOD = { preset: 'month', from: '2026-10-01', to: '2026-10-29', tz: 'America/New_York', today: '2026-10-29' };
const summary = { openAlerts: 11, outOfStock: 3, critical: 4, low: 4, acknowledged: 0, totalAlerts: 11, productUsesToday: 5, activeTechniciansToday: 2, timeZone: 'America/New_York', definitions: {} };
const row = (o: Record<string, unknown>) => ({ productId: 'p1', alertId: null, name: 'Rose Gel', sku: 'RG-01', barcode: null, colorNumber: null, unit: 'bottle', brand: 'DND', category: null, vendorId: null, vendor: null, vendorPhone: null,
  severity: 'out_of_stock', onHand: 0, reorderLevel: 3, criticalLevel: 2, suggestedReorder: 6, onOrder: 0, openPurchaseOrders: null, since: null, acknowledgedAt: null, acknowledgedBy: null,
  lastUsedBy: null, lastUsedAt: null, lastUsedLabel: 'No recorded use', lastUsedQuantity: null, ...o });
const mount = () => render(<MemoryRouter><POSInventoryAlertsScreen /></MemoryRouter>);
beforeEach(() => {
  perms = ['inventory.view', 'inventory.product_usage.submit', 'inventory.stock.adjust', 'inventory.purchase_order.create'];
  Object.values(api).forEach((f) => f.mockReset());
  api.summary.mockResolvedValue(summary);
  api.active.mockResolvedValue({ total: 2, page: 1, pageSize: 10, pages: 1, rows: [row({}), row({ productId: 'p2', name: 'Top Coat', severity: 'critical', onHand: 1, lastUsedLabel: 'Bao Tran', lastUsedTechnicianId: 't2', lastUsedAt: '2026-10-29T15:00:00Z', lastUsedQuantity: '1' })] });
  api.usage.mockResolvedValue({ total: 0, page: 1, pageSize: 10, pages: 1, period: PERIOD, rows: [] });
  api.pickers.mockResolvedValue({ products: [{ id: 'p1', name: 'Rose Gel', sku: 'RG-01', barcode: '0123', unit: 'bottle', onHand: 3, stock: '3', stockHundredths: 300 }], technicians: [{ id: 't1', name: 'Anna Nguyen', isMe: true }, { id: 't2', name: 'Bao Tran', isMe: false }] });
});

describe('POSInventoryAlertsScreen', () => {
  it('shows the server KPIs (Open Alerts = the sidebar count) and Last Used By / No recorded use on each row', async () => {
    mount();
    expect(await screen.findByTestId('kpi-open')).toHaveTextContent('11');
    expect(screen.getByTestId('kpi-out')).toHaveTextContent('3');
    const rows = await screen.findAllByTestId('alert-row');
    expect(rows[0]).toHaveTextContent('No recorded use'); expect(rows[1]).toHaveTextContent('Bao Tran');
  });
  it('the product overlay explains why it is low from measured movements, an overdue order and a ledger mismatch', async () => {
    api.ledger.mockResolvedValue({ product: { id: 'p1', name: 'Rose Gel', sku: 'RG-01', unit: 'bottle', onHand: 1, reorderLevel: 3, criticalLevel: 2 }, lastUsedAt: null, lastUsedLabel: 'No recorded use', lastRecordedAt: null, period: PERIOD,
      byTechnician: [], total: 0, page: 1, pageSize: 8, pages: 1, events: [] });
    api.cause.mockResolvedValue({ product: { id: 'p1', name: 'Rose Gel', onHand: 1, reorderLevel: 3, low: true }, days: 30, buckets: { usage: -6, received: 0, losses: -2, corrections: 0, other: 0 },
      byType: [], lastReceivedAt: '2026-09-15T12:00:00Z', openOrders: { quantity: 10, orders: 1, expectedDate: '2026-10-27', overdue: true }, ledgerAfter: 2, consistent: false, causes: ['usage', 'losses', 'receiving_delayed', 'inconsistent'],
      reorder: { reorderQuantity: 6, onOrder: 10, suggested: 0, partlyReceivedLines: 1, receivedInWindow: 0, lastReceiptQuantity: 10 } });
    mount();
    fireEvent.click((await screen.findAllByText('Rose Gel'))[0]);
    const c = await screen.findByTestId('low-cause');
    expect(c.textContent).toMatch(/Why it is low/);
    expect(screen.getByTestId('cause-usage').textContent).toMatch(/Used: 6/);
    expect(screen.getByTestId('cause-receiving_delayed').textContent).toMatch(/10 on order/);
    expect(screen.getByTestId('cause-inconsistent').textContent).toMatch(/ends at 2 but on-hand shows 1/);
    expect(screen.getByTestId('reorder-recon').textContent).toMatch(/10 on order covers the reorder/);
    expect(screen.getByTestId('reorder-partial').textContent).toMatch(/1 order lines are partly received/);
    expect(api.cause).toHaveBeenCalledWith('p1');
  });
  it('switching to Product Usage reads the usage list with the period and date basis', async () => {
    mount(); await screen.findAllByTestId('alert-row');
    fireEvent.click(screen.getByTestId('tab-usage'));
    await waitFor(() => expect(api.usage).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'month', dateBasis: 'occurred', page: 1 })));
  });
  it('acknowledging an alert goes to the server by product (works for products that never had an alert row)', async () => {
    api.acknowledge.mockResolvedValue({ ok: true, alertId: 'a1', alreadyAcknowledged: false });
    mount(); const rows = await screen.findAllByTestId('alert-row');
    fireEvent.click(rows[0].querySelector('[data-testid="ack"]')!);
    await waitFor(() => expect(api.acknowledge).toHaveBeenCalledWith('p1'));
  });
  it('Record Product Use: product → yourself → 0.5 → review stock before/after → one request with a key', async () => {
    api.record.mockResolvedValue({ replay: false, event: { id: 'e1', productId: 'p1', productName: 'Rose Gel', technicianName: 'Anna Nguyen', quantity: '0.5' } });
    mount(); await screen.findAllByTestId('alert-row');
    fireEvent.click(screen.getByTestId('record-use'));
    fireEvent.click(await screen.findByTestId('product-pick'));
    fireEvent.click(screen.getByTestId('qty-0.5'));
    fireEvent.click(screen.getByTestId('review-use'));
    expect(screen.getByTestId('stock-after')).toHaveTextContent('2.5');
    fireEvent.click(screen.getByTestId('confirm-use'));
    await waitFor(() => expect(api.record).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', quantity: '0.5' }), expect.any(String)));
    expect(api.record.mock.calls[0][0].technicianId).toBeUndefined();
    expect(await screen.findByTestId('note')).toHaveTextContent('Rose Gel');
  });
  it('recording for another technician needs a reason', async () => {
    mount(); await screen.findAllByTestId('alert-row');
    fireEvent.click(screen.getByTestId('record-use')); fireEvent.click(await screen.findByTestId('product-pick'));
    fireEvent.change(screen.getByTestId('tech-pick'), { target: { value: 't2' } });
    expect(screen.getByTestId('review-use')).toBeDisabled();
    fireEvent.change(screen.getByTestId('on-behalf-reason'), { target: { value: 'forgot to log' } });
    expect(screen.getByTestId('review-use')).not.toBeDisabled();
  });
  it('a role without the usage permission sees no Record Product Use', async () => {
    perms = ['inventory.view']; mount(); await screen.findAllByTestId('alert-row');
    expect(screen.queryByTestId('record-use')).toBeNull(); expect(screen.queryByTestId('create-po')).toBeNull();
  });
});
