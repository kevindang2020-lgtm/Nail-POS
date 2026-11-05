import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/inventoryApi', () => ({
  inventoryApi: {
    summary: vi.fn(async () => ({ summary: { } })),
    products: vi.fn(async () => ({ products: [] })),
    reports: vi.fn(async () => ({ reports: [] })),
    alertFeed: vi.fn(async () => ({ openCount: 0 })),
    createProduct: vi.fn(async () => ({ id: 'p1' })),
    categories: vi.fn(async () => ({ categories: [] })),
    brands: vi.fn(async () => ({ brands: [] })),
    vendors: vi.fn(async () => ({ vendors: [] })),
  },
}));

import { TenantInventoryScreen } from './TenantInventoryScreen';

beforeEach(() => vi.clearAllMocks());

describe('Overview "Add Product" deep-link', () => {
  it('opens the Add Product modal when navigated with ?add=1', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory?add=1']}><TenantInventoryScreen /></MemoryRouter>);
    expect(await screen.findByText('Add product')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/DND Gel Polish/)).toBeInTheDocument();
  });
  it('does NOT open the modal on a normal visit', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory']}><TenantInventoryScreen /></MemoryRouter>);
    // let it settle
    await screen.findAllByText(/Inventory|Products/i);
    expect(screen.queryByText('Add product')).not.toBeInTheDocument();
  });
});
