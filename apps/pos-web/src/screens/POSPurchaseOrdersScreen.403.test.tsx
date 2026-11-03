import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('../api/posPurchaseOrdersApi', () => ({ posPurchaseOrdersApi: { list: listMock, vendors: vi.fn().mockResolvedValue({ vendors: [] }), products: vi.fn().mockResolvedValue({ products: [] }), get: vi.fn(), create: vi.fn(), approve: vi.fn(), receive: vi.fn(), cancel: vi.fn() } }));
import { POSPurchaseOrdersScreen } from './POSPurchaseOrdersScreen';
describe('Purchase orders permissions', () => {
  it('shows a permission message on 403', async () => { listMock.mockRejectedValue({ status: 403 }); render(<MemoryRouter><POSPurchaseOrdersScreen /></MemoryRouter>); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
