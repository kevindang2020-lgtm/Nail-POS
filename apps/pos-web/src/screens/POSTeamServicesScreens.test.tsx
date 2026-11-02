import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { teamMock, svcMock } = vi.hoisted(() => ({ teamMock: vi.fn(), svcMock: vi.fn() }));
vi.mock('../api/posTeamApi', () => ({ posTeamApi: { list: vi.fn(), getState: teamMock, getMember: vi.fn() } }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { state: svcMock, categories: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), reactivate: vi.fn(), setTechnicians: vi.fn() } }));
import { POSTeamProfilesScreen } from './POSTeamProfilesScreen';
beforeEach(() => { teamMock.mockReset(); svcMock.mockReset(); });

describe('POSTeamProfilesScreen', () => {
  it('renders KPIs + roster from /pos/team/state', async () => {
    teamMock.mockResolvedValue({ kpis: { totalMembers: 8, activeToday: 5, onShiftNow: 3, avgPerformance: 92, totalServices: 120, totalCommissionCents: 450000 }, rows: { items: [{ employeeId: 'e1', name: 'Anna Tech', role: 'Nail Tech', department: 'Nail Services', status: 'active', servicesCount: 20, revenueCents: 200000, performanceLabel: 'Great' }] } });
    render(<POSTeamProfilesScreen />);
    expect(await screen.findByRole('heading', { name: 'Team Profiles' })).toBeInTheDocument();
    expect(screen.getByText('Anna Tech')).toBeInTheDocument();
    expect(screen.getAllByText('$2,000.00').length).toBeGreaterThan(0);
  });
});
// Service Categories: POSCatalogScreens.test.tsx (Oct 30 2026 rebuild)
