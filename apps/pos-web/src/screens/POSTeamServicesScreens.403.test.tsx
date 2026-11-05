import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { teamMock, svcMock } = vi.hoisted(() => ({ teamMock: vi.fn(), svcMock: vi.fn() }));
vi.mock('../api/posTeamApi', () => ({ posTeamApi: { list: vi.fn(), getState: teamMock, getMember: vi.fn() } }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { state: svcMock, categories: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), reactivate: vi.fn(), setTechnicians: vi.fn() } }));
import { POSTeamProfilesScreen } from './POSTeamProfilesScreen';
import { POSServiceCategoriesScreen } from './POSServiceCategoriesScreen';
describe('Team/Services permissions', () => {
  it('team 403', async () => { teamMock.mockRejectedValue({ status: 403 }); render(<POSTeamProfilesScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
describe('Services permissions', () => {
  it('services 403', async () => { svcMock.mockRejectedValue({ status: 403 }); render(<POSServiceCategoriesScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
