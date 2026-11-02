import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const api = vi.hoisted(() => ({ summary: vi.fn(), physical: vi.fn(), routing: vi.fn() }));
vi.mock('../api/posTerminalsScreenApi', () => ({ posTerminalsScreenApi: api }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => false }));
import { POSPaymentTerminalsScreen } from './POSPaymentTerminalsScreen';
describe('Payment terminals permissions', () => {
  it('shows a permission message on 403 (no actions offered)', async () => {
    for (const f of Object.values(api)) f.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSPaymentTerminalsScreen /></MemoryRouter>);
    expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pair-terminal')).toBeNull();
  });
});
