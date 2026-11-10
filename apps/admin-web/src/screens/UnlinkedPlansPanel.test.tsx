import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UnlinkedPlansPanel } from './UnlinkedPlansPanel';
import { superAdminPlansApi } from '../api/superAdminPlansApi';

vi.mock('../api/superAdminPlansApi', () => ({ superAdminPlansApi: { unlinkedTenants: vi.fn(), linkTenantPlan: vi.fn() } }));

describe('UnlinkedPlansPanel (batch 8 decision 3)', () => {
  it('lists salons whose plan matches no catalogue plan and links one with a reason', async () => {
    vi.mocked(superAdminPlansApi.unlinkedTenants).mockResolvedValueOnce({ tenants: [{ tenantId: 't1', tenantName: 'Pilot Nail Salon', tenantCode: 'PILOT01', planText: 'Standard', status: 'active', subscriptionId: 's1' }],
      plans: [{ code: 'starter', name: 'Starter', status: 'active' }, { code: 'premium', name: 'Premium', status: 'active' }] })
      .mockResolvedValueOnce({ tenants: [], plans: [] });
    vi.mocked(superAdminPlansApi.linkTenantPlan).mockResolvedValue({ tenantId: 't1', planCode: 'starter', planText: 'Standard' });
    render(<UnlinkedPlansPanel />);
    expect(await screen.findByText('Pilot Nail Salon')).toBeInTheDocument();
    const btn = screen.getByTestId('sa-unlinked-link');
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Catalogue plan for/), { target: { value: 'starter' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'pilot salon is on Starter' } });
    fireEvent.click(btn);
    await waitFor(() => expect(superAdminPlansApi.linkTenantPlan).toHaveBeenCalledWith('t1', 'starter', 'pilot salon is on Starter'));
    expect(await screen.findByTestId('sa-unlinked-none')).toBeInTheDocument();
    expect(screen.getByTestId('sa-unlinked-msg').textContent).toContain('Price and status were not changed');
  });
});
