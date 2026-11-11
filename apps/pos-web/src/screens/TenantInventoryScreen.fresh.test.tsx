// TenantInventoryScreen — inventory data freshness (backlog Inventory Management · 16): the time of the last successful metrics
// read; a failed refresh never shows a fresh-looking time — it says the numbers are from the last good read.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { st } = vi.hoisted(() => ({ st: { fail: false } }));
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers'); return { posInventoryScreenApi: h.anyApi({ metrics: async () => { if (st.fail) throw new Error('down'); return h.METRICS; } }), posSuppliersApi: h.anyApi() }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posInventoryAlertsApi', async () => ({ posInventoryAlertsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posAiApi', async () => ({ posAiApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { TenantInventoryScreen } from './TenantInventoryScreen';

describe('Inventory data freshness', () => {
  it('stamps a good read; a failed refresh says the numbers are from the last good read', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory']}><TenantInventoryScreen /></MemoryRouter>);
    expect(await screen.findByTestId('inventory-fresh')).toHaveTextContent(/Numbers updated/);
    st.fail = true;
    fireEvent.click(screen.getByTestId('refresh'));
    expect(await screen.findByText(/Refresh failed — the last good numbers are from/)).toBeInTheDocument();
  });
});
