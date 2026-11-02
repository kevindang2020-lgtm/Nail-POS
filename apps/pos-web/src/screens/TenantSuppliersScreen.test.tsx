// TenantSuppliersScreen — Suppliers rebuild (Oct 29 2026): the four KPIs with their scopes, the directory (contacts, the
// search that also matches contact phones), the Orders workspace, Add Supplier.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { mocks } = vi.hoisted(() => ({ mocks: {} as Record<string, any> }));
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers');
  mocks.sup = h.anyApi({ kpis: async () => ({ totalSuppliers: 1, inactiveSuppliers: 1, preferredSuppliers: 0, activePurchaseOrders: 0, draftPurchaseOrders: 1, totalPurchaseOrders: 1, openPoValueCents: 0, draftValueCents: 0, brands: 6, brandsWithoutSupplier: 6 }),
    directory: async () => ({ ...h.emptyPage(), items: [{ id: 'v1', name: 'Acme Beauty Supply', tradeName: null, supplierCode: null, active: true, isPreferred: false, primaryContact: { name: 'Jane Doe', phone: '(856) 555-1212', email: null }, contacts: 1, products: 0, openPurchaseOrders: 0, openValueCents: 0, lastOrderAt: null, matchedVia: null }], totalItems: 1 }) });
  return { posInventoryScreenApi: h.anyApi(), posSuppliersApi: mocks.sup }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { TenantSuppliersScreen } from './TenantSuppliersScreen';

describe('TenantSuppliersScreen', () => {
  it('renders the four KPIs and the directory from the read model', async () => {
    render(<MemoryRouter><TenantSuppliersScreen /></MemoryRouter>);
    expect((await screen.findAllByText('Acme Beauty Supply')).length).toBeGreaterThan(0);
    for (const t of ['kpi-suppliers', 'kpi-active-pos', 'kpi-open-value', 'kpi-brands', 'add-supplier', 'work-directory', 'work-orders']) expect(screen.getByTestId(t)).toBeInTheDocument();
    expect(screen.getByTestId('kpi-open-value')).toHaveTextContent('$0.00');   // a real zero, never a dash
  });
  it('the search goes to the server (it matches contact phones there)', async () => {
    render(<MemoryRouter><TenantSuppliersScreen /></MemoryRouter>);
    await screen.findAllByText('Acme Beauty Supply');
    fireEvent.change(screen.getByTestId('search'), { target: { value: '856-555-1212' } });
    await new Promise((r) => setTimeout(r, 600));
    expect(mocks.sup.directory).toHaveBeenCalledWith(expect.objectContaining({ search: '856-555-1212' }));
  });
});
