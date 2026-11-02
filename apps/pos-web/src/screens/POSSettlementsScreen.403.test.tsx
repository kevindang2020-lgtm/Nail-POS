import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), detail: vi.fn(), transactions: vi.fn(), exportCsv: vi.fn(), exportDetail: vi.fn() }));
vi.mock('../api/posSettlementsApi', () => ({ posSettlementsApi: api }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => false }));
import { POSSettlementsScreen } from './POSSettlementsScreen';

describe('POSSettlementsScreen — permissions', () => {
  it('a 403 shows an access message and no figures; no Export button', async () => {
    api.summary.mockRejectedValue({ status: 403 }); api.list.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSSettlementsScreen /></MemoryRouter>);
    expect((await screen.findAllByText('Your role cannot see this information.')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$\d/)).toBeNull();
    expect(screen.queryByTestId('export')).toBeNull();
  });
});
