// POSLoyaltyScreen — the one-screen overview (/pos/loyalty/overview + paged rewards / members / redemptions). The old
// /pos/loyalty/state client method is retired; a failed overview is an error with Retry, never zeros.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { overview: vi.fn(), rewards: vi.fn(), members: vi.fn(), redemptions: vi.fn() } }));
vi.mock('../api/posLoyaltyApi', () => ({ posLoyaltyApi: api }));
import { POSLoyaltyScreen } from './POSLoyaltyScreen';

const empty = { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 };
const overview = { period: { label: 'This month', start: '2026-10-01', timeZone: 'America/New_York' }, kpis: { loyaltyMembers: 2, newMembersThisMonth: 1, pointsOutstanding: 620, balanceReconciled: true, activeRewards: 1, totalRewards: 2, redemptionsThisMonth: 1, redemptionsPending: 0, pointsRedeemedThisMonth: 200 },
  tiers: [{ tier: 'VIP', members: 1, points: 500 }, { tier: 'Regular', members: 1, points: 120 }] };
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.overview.mockResolvedValue(overview); api.rewards.mockResolvedValue(empty); api.members.mockResolvedValue(empty); api.redemptions.mockResolvedValue(empty);
});
const mount = () => render(<MemoryRouter><POSLoyaltyScreen /></MemoryRouter>);

describe('POSLoyaltyScreen', () => {
  it('shows the server\'s KPIs and tiers', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('kpi-points')).toHaveTextContent('620'));
    expect(screen.getByTestId('kpi-members')).toHaveTextContent('2');
    expect(screen.getByTestId('panel-tiers')).toHaveTextContent('VIP');
  });
  it('a failed overview is an error with Retry — never zeros', async () => {
    api.overview.mockRejectedValue({ status: 503 });
    mount();
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-points')).toBeNull();
  });
});
