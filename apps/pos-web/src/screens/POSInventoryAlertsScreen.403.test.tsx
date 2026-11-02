import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const api = vi.hoisted(() => ({ summary: vi.fn(), active: vi.fn(), history: vi.fn(), usage: vi.fn(), ledger: vi.fn(), technicians: vi.fn(), pickers: vi.fn(), event: vi.fn(), acknowledge: vi.fn(), record: vi.fn(), adjust: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posInventoryAlertsApi', () => ({ posInventoryAlertsApi: api }));
import { POSInventoryAlertsScreen } from './POSInventoryAlertsScreen';
describe('Stock alerts permissions', () => {
  it('shows a permission message on 403 and no figures', async () => {
    for (const f of Object.values(api)) f.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSInventoryAlertsScreen /></MemoryRouter>);
    expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-open')).toBeNull();
  });
});
