// TenantInventoryScreen — D9 gaps (Nov 5 2026): a shipped transfer shows In transit; the receiving location gets Receive (how many
// of each arrived, short arrivals warned), the sending location gets Cancel transfer (with a reason).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const ROWS = [
  { id: 'tr-in', number: 'TR-IN', status: 'in_transit', items: 1, units: 3, notes: null, createdAt: '2026-11-04T12:00:00Z', from: 'Main', to: 'Second', outbound: false, createdBy: 'Olive' },
  { id: 'tr-out', number: 'TR-OUT', status: 'in_transit', items: 1, units: 2, notes: null, createdAt: '2026-11-04T12:00:00Z', from: 'Second', to: 'Main', outbound: true, createdBy: 'Olive' },
  { id: 'tr-done', number: 'TR-DONE', status: 'completed', items: 1, units: 1, notes: null, createdAt: '2026-11-03T12:00:00Z', from: 'Main', to: 'Second', outbound: true, createdBy: 'Olive' },
];
const receive = vi.fn(async () => ({ transfer: {}, lines: [] })); const cancel = vi.fn(async () => ({ transfer: {}, lines: [] }));
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers'); return { posInventoryScreenApi: h.anyApi({ metrics: async () => h.METRICS, transfers: async () => ({ ...h.emptyPage(), rows: ROWS, total: 3 }) }), posSuppliersApi: h.anyApi() }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi({
  transfer: async () => ({ transfer: { transfer_number: 'TR-IN' }, lines: [{ id: 'l1', product_id: 'p1', product_name: 'Gel Red', quantity_requested: 3, quantity_moved: 3 }] }),
  receiveTransfer: (...a: any[]) => (receive as any)(...a), cancelTransfer: (...a: any[]) => (cancel as any)(...a),
}) }));
vi.mock('../api/posInventoryAlertsApi', async () => ({ posInventoryAlertsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posAiApi', async () => ({ posAiApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { TenantInventoryScreen } from './TenantInventoryScreen';

describe('shipped transfers on the POS', () => {
  it('Receive on the inbound row (2 of 3 arrived), Cancel with a reason on the outbound row; none on a completed one', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory?tab=transfers']}><TenantInventoryScreen /></MemoryRouter>);
    expect(await screen.findAllByText(/In transit|Đang trên đường/)).toHaveLength(2);
    expect(screen.getAllByTestId('transfer-receive')).toHaveLength(1);
    expect(screen.getAllByTestId('transfer-cancel')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('transfer-receive'));
    const inp = await screen.findByTestId('recv-tr-p1');
    fireEvent.change(inp, { target: { value: '2' } });
    expect(screen.getByTestId('transfer-short')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('transfer-receive-save'));
    await waitFor(() => expect(receive).toHaveBeenCalledWith('tr-in', { lines: [{ productId: 'p1', received: 2 }] }));
    fireEvent.click(screen.getByTestId('transfer-cancel'));
    expect(screen.getByTestId('transfer-cancel-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('transfer-cancel-why'), { target: { value: 'Driver did not come' } });
    fireEvent.click(screen.getByTestId('transfer-cancel-save'));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('tr-out', 'Driver did not come'));
  });
});
