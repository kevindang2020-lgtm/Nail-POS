// TenantInventoryScreen — the Overview "Add Product" deep link (?add=1) still opens the product form after the Oct 29 2026
// rebuild; a normal visit shows the KPIs and the eight tabs without it.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers'); return { posInventoryScreenApi: h.anyApi({ metrics: async () => h.METRICS }), posSuppliersApi: h.anyApi() }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posInventoryAlertsApi', async () => ({ posInventoryAlertsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posAiApi', async () => ({ posAiApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { TenantInventoryScreen } from './TenantInventoryScreen';

describe('Overview "Add Product" deep-link', () => {
  it('opens the Add Product form when navigated with ?add=1', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory?add=1']}><TenantInventoryScreen /></MemoryRouter>);
    expect(await screen.findByTestId('product-form')).toBeInTheDocument();
  });
  it('does NOT open it on a normal visit; the eight tabs are there', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory']}><TenantInventoryScreen /></MemoryRouter>);
    expect(await screen.findByTestId('kpi-products')).toBeInTheDocument();
    for (const t of ['products', 'reports', 'purchaseOrders', 'transfers', 'counts', 'catalog', 'recipes', 'alerts']) expect(screen.getByTestId('tab-' + t)).toBeInTheDocument();
    expect(screen.queryByTestId('product-form')).not.toBeInTheDocument();
  });
});
