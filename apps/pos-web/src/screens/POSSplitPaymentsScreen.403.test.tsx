import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), registers: vi.fn() }));
vi.mock('../api/posSplitPaymentsApi', () => ({ posSplitPaymentsApi: api }));
import { POSSplitPaymentsScreen } from './POSSplitPaymentsScreen';
describe('Split payments permissions', () => {
  it('shows a permission message on 403', async () => {
    for (const f of Object.values(api)) f.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSSplitPaymentsScreen /></MemoryRouter>);
    expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument();
    expect(screen.queryByTestId('export')).toBeNull();
  });
});
