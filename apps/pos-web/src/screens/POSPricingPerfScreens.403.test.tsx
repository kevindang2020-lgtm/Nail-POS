import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { svcMock, teamMock } = vi.hoisted(() => ({ svcMock: vi.fn(), teamMock: vi.fn() }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { state: svcMock, categories: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), reactivate: vi.fn(), setTechnicians: vi.fn() } }));
vi.mock('../api/posTeamApi', () => ({ posTeamApi: { list: vi.fn(), getState: teamMock, getMember: vi.fn() } }));
import { POSServicePricingScreen } from './POSServicePricingScreen';
import { POSTeamPerformanceScreen } from './POSTeamPerformanceScreen';
describe('Pricing permissions', () => { it('pricing 403', async () => { svcMock.mockRejectedValue({ status: 403 }); render(<POSServicePricingScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); }); });
describe('Performance permissions', () => { it('performance 403', async () => { teamMock.mockRejectedValue({ status: 403 }); render(<POSTeamPerformanceScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); }); });
