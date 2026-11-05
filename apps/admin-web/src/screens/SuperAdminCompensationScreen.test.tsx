import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SuperAdminCompensationScreen } from './SuperAdminCompensationScreen';
import { superAdminCompensationApi } from '../api/superAdminCompensationApi';

vi.mock('../api/superAdminCompensationApi', () => ({ superAdminCompensationApi: { overview: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); });

describe('SuperAdminCompensationScreen', () => {
  it('shows each tenant\'s compensation configuration', async () => {
    (superAdminCompensationApi.overview as any).mockResolvedValue([
      { tenantId: 't1', tenantName: 'Salon A', activeRules: 2, tierPlans: 1, bonusRules: 3, classifications: 5, agreements: 4, acknowledgedAgreements: 2 },
    ]);
    render(<SuperAdminCompensationScreen />);
    await waitFor(() => expect(screen.getByText('Salon A')).toBeInTheDocument());
    expect(screen.getByText('2/4 acknowledged')).toBeInTheDocument();
  });

  it('shows an empty state when no tenant has configured anything', async () => {
    (superAdminCompensationApi.overview as any).mockResolvedValue([]);
    render(<SuperAdminCompensationScreen />);
    await waitFor(() => expect(screen.getByText(/No tenants have configured/)).toBeInTheDocument());
  });
});
