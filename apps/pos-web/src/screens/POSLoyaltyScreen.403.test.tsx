import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { overview: vi.fn(), rewards: vi.fn(), members: vi.fn(), redemptions: vi.fn() } }));
vi.mock('../api/posLoyaltyApi', () => ({ posLoyaltyApi: api }));
import { POSLoyaltyScreen } from './POSLoyaltyScreen';
describe('Loyalty permissions', () => {
  it('a refused overview (403) is an error state, not zeros', async () => {
    const empty = { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 };
    api.overview.mockRejectedValue({ status: 403 }); api.rewards.mockResolvedValue(empty); api.members.mockResolvedValue(empty); api.redemptions.mockResolvedValue(empty);
    render(<MemoryRouter><POSLoyaltyScreen /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-points')).toBeNull();
  });
});
