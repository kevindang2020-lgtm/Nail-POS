import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api } = vi.hoisted(() => ({ api: { kpis: vi.fn(), list: vi.fn(), redemptions: vi.fn(), performance: vi.fn(), detail: vi.fn(), exportList: vi.fn(), exportRedemptions: vi.fn() } }));
vi.mock('../api/posDiscountsApi', () => ({ posDiscountsApi: api }));
import { POSDiscountsScreen } from './POSDiscountsScreen';
describe('Discounts permissions', () => {
  it('shows an access message on 403, never the data shape', async () => {
    api.kpis.mockRejectedValue({ status: 403 }); api.list.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSDiscountsScreen /></MemoryRouter>);
    expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument();
  });
});
