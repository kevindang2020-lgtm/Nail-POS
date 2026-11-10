import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { metricsMock } = vi.hoisted(() => ({ metricsMock: vi.fn() }));
vi.mock('../api/posInventoryReportApi', () => ({ posInventoryReportApi: { metrics: metricsMock, products: vi.fn(), movements: vi.fn() } }));
import { POSInventoryReportScreen } from './POSInventoryReportScreen';
describe('Inventory report permissions', () => {
  it('shows a permission message on 403', async () => {
    metricsMock.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSInventoryReportScreen /></MemoryRouter>);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
