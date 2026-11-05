import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('../api/posProductsApi', () => ({ posProductsApi: { list: listMock, categories: vi.fn().mockResolvedValue({ categories: [] }), brands: vi.fn().mockResolvedValue({ brands: [] }), create: vi.fn(), archive: vi.fn(), addStock: vi.fn() } }));
import { POSProductsScreen } from './POSProductsScreen';
describe('Products permissions', () => {
  it('shows a permission message on 403', async () => { listMock.mockRejectedValue({ status: 403 }); render(<POSProductsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
