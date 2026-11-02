import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers'); const deny = async () => { throw { status: 403 }; };
  return { posInventoryScreenApi: h.anyApi({ metrics: deny, products: deny }), posSuppliersApi: h.anyApi() }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posProductsApi', async () => ({ posProductsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { POSProductsScreen } from './POSProductsScreen';
describe('Products permissions', () => {
  it('shows an access message on 403', async () => { render(<MemoryRouter><POSProductsScreen /></MemoryRouter>); expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument(); });
});
