import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), detail: vi.fn(), lookupCustomers: vi.fn(), createInvoice: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posInvoicesApi', () => ({ posInvoicesApi: api }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => false }));
import { POSInvoicesScreen } from './POSInvoicesScreen';

describe('Invoices permissions', () => {
  it('a 403 shows an access message; no New Invoice or Export', async () => {
    api.summary.mockRejectedValue({ status: 403 }); api.list.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSInvoicesScreen /></MemoryRouter>);
    expect((await screen.findAllByText('Your role cannot see this information.')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('new-invoice')).toBeNull();
    expect(screen.queryByTestId('export')).toBeNull();
  });
});
