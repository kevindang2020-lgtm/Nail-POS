// POSProductsScreen — Products rebuild (Oct 29 2026): the three KPIs, the server-paged catalog with its columns, the
// universal search sent to the server, Add Stock / Archive per row, the empty state.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { mocks } = vi.hoisted(() => ({ mocks: {} as Record<string, any> }));
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers'); mocks.screen = h.anyApi({ metrics: async () => ({ ...h.METRICS, products: 2, needReorder: 1, outOfStock: 0, retailValueCents: 4800 }),
  products: async (q: any) => ({ ...h.emptyPage(), rows: q.search === 'zzz' ? [] : [{ id: 'p1', name: 'OPI Big Apple Red', sku: 'OPI-BAR', onHand: 1, unit: 'bottle', severity: 'critical', retailCents: 1200, brand: 'OPI', category: 'Gel Polish', archivedAt: null, lastUsedAt: null }], total: q.search === 'zzz' ? 0 : 1 }) });
  return { posInventoryScreenApi: mocks.screen, posSuppliersApi: h.anyApi() }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posProductsApi', async () => ({ posProductsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posInventoryAlertsApi', async () => ({ posInventoryAlertsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { POSProductsScreen } from './POSProductsScreen';

describe('POSProductsScreen', () => {
  it('renders the three KPIs and a product row with Add Stock and Archive', async () => {
    render(<MemoryRouter><POSProductsScreen /></MemoryRouter>);
    expect(await screen.findByText('OPI Big Apple Red')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-products')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-reorder')).toHaveTextContent('1');
    expect(screen.getByTestId('add-stock')).toBeInTheDocument();
    expect(screen.getByTestId('archive')).toBeInTheDocument();
  });
  it('the search box searches the server and shows a clear empty state', async () => {
    render(<MemoryRouter><POSProductsScreen /></MemoryRouter>);
    await screen.findByText('OPI Big Apple Red');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/zzz/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(mocks.screen.products).toHaveBeenCalledWith(expect.objectContaining({ search: 'zzz', page: 1 }));
  });
  it('Metrics freshness marker: stamped after a successful read; a failed refresh says the numbers are from the last good read', async () => {
    render(<MemoryRouter><POSProductsScreen /></MemoryRouter>);
    expect(await screen.findByTestId('metrics-fresh')).toHaveTextContent(/Numbers updated/);
    const ok = mocks.screen.metrics;
    mocks.screen.metrics = async () => { throw new Error('down'); };
    try {
      fireEvent.click(screen.getByTestId('refresh'));
      expect(await screen.findByText(/Refresh failed — the last good numbers are from/)).toBeInTheDocument();
    } finally { mocks.screen.metrics = ok; }
  });
});
