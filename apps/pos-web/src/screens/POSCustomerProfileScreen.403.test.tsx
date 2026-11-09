import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent } from '@testing-library/react';
const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock, getDetail: vi.fn() } }));
vi.mock('../api/posCustomerSearchApi', () => ({ posCustomerSearchApi: { summary: vi.fn().mockResolvedValue({ kpis: { customers: 0, active: 0, sharedContactProfiles: 0 } }), customers: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, pageCount: 1 }), check: vi.fn() } }));
import { POSCustomerProfileScreen } from './POSCustomerProfileScreen';
describe('Customer profile permissions', () => {
  it('shows a permission message on 403 from search', async () => {
    searchMock.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSCustomerProfileScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
