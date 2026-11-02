import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), facets: vi.fn(), find: vi.fn(), detail: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posRefundsVoidsApi', () => ({ posRefundsVoidsApi: api }));
import { POSRefundsVoidsScreen } from './POSRefundsVoidsScreen';
describe('Refunds/voids permissions', () => {
  it('shows a permission message on 403 and no figures', async () => {
    for (const f of Object.values(api)) f.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSRefundsVoidsScreen /></MemoryRouter>);
    expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument();
    expect(screen.queryByTestId('export')).toBeNull(); expect(screen.queryByTestId('kpi-refunds')).toBeNull();
  });
});
