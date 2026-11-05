import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { svcMock, teamMock } = vi.hoisted(() => ({ svcMock: vi.fn(), teamMock: vi.fn() }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { state: svcMock, categories: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), reactivate: vi.fn(), setTechnicians: vi.fn() } }));
vi.mock('../api/posTeamApi', () => ({ posTeamApi: { list: vi.fn(), getState: teamMock, getMember: vi.fn() } }));
import { POSServicePricingScreen } from './POSServicePricingScreen';
import { POSTeamPerformanceScreen } from './POSTeamPerformanceScreen';
beforeEach(() => { svcMock.mockReset(); teamMock.mockReset(); });

describe('POSServicePricingScreen', () => {
  it('renders the service menu with prices', async () => {
    svcMock.mockResolvedValue({ services: { items: [{ serviceId: 's1', serviceName: 'Gel Manicure', categoryName: 'Manicures', durationMinutes: 45, priceCents: 6500 }] } });
    render(<POSServicePricingScreen />);
    expect(await screen.findByRole('heading', { name: 'Service Pricing' })).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument();
    expect(screen.getAllByText('$65.00').length).toBeGreaterThan(0);
  });
});
describe('POSTeamPerformanceScreen', () => {
  it('renders overall score + top performers', async () => {
    teamMock.mockResolvedValue({ kpis: { avgPerformance: 88, totalServices: 100 }, performance: { overall: 91, distribution: [{ label: 'A', count: 4 }, { label: 'B', count: 2 }] }, topPerformers: [{ employeeId: 'e1', name: 'Anna Tech', score: 96 }] });
    render(<POSTeamPerformanceScreen />);
    expect(await screen.findByRole('heading', { name: 'Team Performance' })).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
    expect(screen.getByText('Anna Tech')).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
  });
});
