import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
import { api } from '../api/client';
import { FeatureRegistryScreen } from './FeatureRegistryScreen';

describe('Feature Registry (Constitution 7 §30–§33)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => Promise.resolve(url.includes('/resolve')
      ? { active: false, featureKey: 'deals_engine', reason: 'KILL_SWITCH_ACTIVE', detail: 'Stopped by the deals.engine kill switch.' }
      : url.endsWith('/rollouts') ? [{ flagKey: 'deals_engine', rolloutPercent: 25, allowTenantIds: ['00000000-0000-4000-8000-000000000001'], denyTenantIds: [], killed: false, reason: 'canary', version: 3, updatedAt: null, updatedBy: null }]
      : [{ feature_key: 'deals_engine', name: 'Deals Engine', category: 'marketing', status: 'AVAILABLE', requires_configuration: false, platform_kill_switch_supported: true, kill_switch_key: 'deals.engine' }]));
    (api.patch as any).mockResolvedValue({});
    (api.put as any).mockResolvedValue({});
  });
  it('lists features with status and kill switch; a status change needs a reason', async () => {
    render(<FeatureRegistryScreen />);
    expect(await screen.findByText('Deals Engine')).toBeInTheDocument();
    expect(screen.getByText('deals.engine')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Status…' }));
    fireEvent.change(screen.getByLabelText('Feature status'), { target: { value: 'BETA' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Status reason'), { target: { value: 'limited rollout to pilots' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/super-admin/features/deals_engine', { status: 'BETA', reason: 'limited rollout to pilots' }));
  });
  it('"Check a salon" shows the resolver\'s structured reason', async () => {
    render(<FeatureRegistryScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check a salon…' }));
    fireEvent.change(screen.getByLabelText('Salon id'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Not active — KILL_SWITCH_ACTIVE');
  });
  it('§76 rollout: shows the policy, edits percentage / lists / kill with a reason and the version it read', async () => {
    render(<FeatureRegistryScreen />);
    expect(await screen.findByText('25% · allow 1 · deny 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rollout…' }));
    fireEvent.change(screen.getByLabelText('Rollout percent'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Deny salons'), { target: { value: '00000000-0000-4000-8000-000000000002' } });
    const save = screen.getByRole('button', { name: 'Save rollout' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Rollout reason'), { target: { value: 'widen the canary to half' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/super-admin/features/deals_engine/rollout', {
      rolloutPercent: 50, allowTenantIds: ['00000000-0000-4000-8000-000000000001'], denyTenantIds: ['00000000-0000-4000-8000-000000000002'], killed: false, reason: 'widen the canary to half', expectedVersion: 3 }));
  });
});
