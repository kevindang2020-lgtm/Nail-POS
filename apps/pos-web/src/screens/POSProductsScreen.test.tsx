import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { listMock, createMock, archiveMock, addStockMock, catMock, brandMock } = vi.hoisted(() => ({ listMock: vi.fn(), createMock: vi.fn(), archiveMock: vi.fn(), addStockMock: vi.fn(), catMock: vi.fn(), brandMock: vi.fn() }));
vi.mock('../api/posProductsApi', () => ({ posProductsApi: { list: listMock, create: createMock, archive: archiveMock, addStock: addStockMock, categories: catMock, brands: brandMock } }));
import { POSProductsScreen } from './POSProductsScreen';
beforeEach(() => { [listMock, createMock, archiveMock, addStockMock, catMock, brandMock].forEach((m) => m.mockReset()); catMock.mockResolvedValue({ categories: [{ id: 'c1', name: 'Polish' }] }); brandMock.mockResolvedValue({ brands: [{ id: 'b1', name: 'OPI' }] }); });

const prod = (o: any = {}) => ({ id: 'p1', name: 'Gel Polish Red', color_name: 'Red', color_number: '204', sku: 'GP-204', brand_name: 'OPI', category_name: 'Polish', onHand: 3, status: 'low', retail_price_cents: 1200, cost_cents: 500, reorder_level: 5, ...o });

describe('POSProductsScreen', () => {
  it('renders KPIs + product rows with stock status', async () => {
    listMock.mockResolvedValue({ products: [prod(), prod({ id: 'p2', name: 'Base Coat', status: 'in_stock', onHand: 20, color_number: null })] });
    render(<POSProductsScreen />);
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByText(/Gel Polish Red/)).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('In stock')).toBeInTheDocument();
    expect(screen.getAllByText('GP-204').length).toBeGreaterThan(0);
  });
  it('creates a product (name required, dollars -> cents)', async () => {
    listMock.mockResolvedValue({ products: [] }); createMock.mockResolvedValue({ id: 'new' });
    render(<POSProductsScreen />);
    await screen.findByRole('heading', { name: 'Products' });
    fireEvent.click(screen.getByRole('button', { name: '+ New Product' }));
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Top Coat' } });
    fireEvent.change(screen.getByLabelText(/Retail/i), { target: { value: '9.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toMatchObject({ name: 'Top Coat', retailPriceCents: 950 });
  });
  it('adds stock to a product', async () => {
    listMock.mockResolvedValue({ products: [prod()] }); addStockMock.mockResolvedValue({});
    render(<POSProductsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add stock' }));
    fireEvent.change(screen.getByPlaceholderText('Quantity'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addStockMock).toHaveBeenCalledWith('p1', { quantity: 12 }));
  });
  it('archives a product', async () => {
    listMock.mockResolvedValue({ products: [prod()] }); archiveMock.mockResolvedValue({});
    render(<POSProductsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archiveMock).toHaveBeenCalledWith('p1'));
  });
});
