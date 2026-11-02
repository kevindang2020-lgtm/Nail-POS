// OwnerCommunityCard.test.tsx — BUILD_PLAN Phase 8 (tenant_safety_community) in the Owner App: active alerts, advisories
// waiting for approval with Approve (expectedVersion) and Return (a note is required), 409 → reload + message, hidden on a
// 403 for both reads, live reload on community_* events, the way into Community settings; and the settings screen (CAS
// save, technician grant, 409 reload).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const api: Record<string, any> = { activeAlerts: vi.fn(), awaitingApproval: vi.fn(), approve: vi.fn(), returnAdvisory: vi.fn(), settings: vi.fn(), saveSettings: vi.fn() };
vi.mock('../api/ownerCommunityApi', () => ({ ownerCommunityApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
const nav = { openCommunitySettings: vi.fn(), back: vi.fn() };
vi.mock('../shell/nav', () => ({ useOwnerNav: () => nav }));
const stream: { fn: ((e: string) => void) | null } = { fn: null };
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: (cb: (e: string) => void) => { stream.fn = cb; } }));
import { OwnerCommunityCard } from './OwnerCommunityCard';
import { OwnerCommunitySettingsScreen } from './OwnerCommunitySettingsScreen';

const adv = (o: any = {}) => ({ id: 'd1', title: 'Caller asked for our login code', body: 'A caller from [phone removed] asked for the code.', category: 'account_takeover_attempt', severity: 'high', status: 'manager_approval', version: 3, privacyScanFlags: ['phone'], moderationRequired: true, ...o });
const settings = (o: any = {}) => ({ enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: false, displayName: null, authorDisplay: 'tenant_name', allowAnonymous: false, branchVisibility: 'tenant', retentionDays: 365, regionPreferences: [], riskMatchingEnabled: false, notify: { categories: [], push: true, email: false, criticalSms: false }, roleGrants: {}, roleRemovals: {}, version: 2, rulesVersion: 'v', rulesAcknowledgedByMe: true, ...o });
const e = (status: number, code?: string) => Object.assign(new Error(code || 'x'), { status, code });
beforeEach(() => {
  for (const k of Object.keys(api)) api[k].mockReset();
  nav.openCommunitySettings.mockReset();
  api.activeAlerts.mockResolvedValue([{ postId: 'p1', title: 'Fake processor calls', severity: 'critical', category: 'account_takeover_attempt', publishedAt: '', author: { label: 'A salon in NJ', isOwnSalon: false, anonymous: true } }]);
  api.awaitingApproval.mockResolvedValue([adv()]);
  api.approve.mockResolvedValue(adv({ status: 'moderation_review', version: 4 }));
  api.returnAdvisory.mockResolvedValue(adv({ status: 'returned_for_correction' }));
  api.settings.mockResolvedValue(settings());
  api.saveSettings.mockImplementation(async (u: any) => settings({ ...u, version: 3 }));
});

describe('Owner Safety Community card', () => {
  it('shows active alerts and the advisories waiting for approval', async () => {
    render(<OwnerCommunityCard />);
    expect(await screen.findByTestId('owner-community-alert')).toHaveTextContent('Fake processor calls');
    expect(screen.getByTestId('owner-community-alert')).toHaveTextContent('Critical');
    expect(screen.getByTestId('owner-community-approval')).toHaveTextContent('Hidden by the privacy check: phone');
  });
  it('Approve sends the version and says moderators review it next', async () => {
    render(<OwnerCommunityCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Caller asked for our login code' }));
    expect(await screen.findByTestId('owner-community-notice')).toHaveTextContent('moderators review it next');
    expect(api.approve).toHaveBeenCalledWith('d1', 3);
    expect(api.awaitingApproval).toHaveBeenCalledTimes(2);
  });
  it('Return needs a note', async () => {
    render(<OwnerCommunityCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Return: Caller asked for our login code' }));
    const g = screen.getByRole('group', { name: 'Return Caller asked for our login code for correction' });
    expect(within(g).getByRole('button', { name: 'Send back' })).toBeDisabled();
    fireEvent.change(within(g).getByLabelText('Note for the writer'), { target: { value: 'Remove the street.' } });
    fireEvent.click(within(g).getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(api.returnAdvisory).toHaveBeenCalledWith('d1', 3, 'Remove the street.'));
  });
  it('a 409 reloads and explains', async () => {
    api.approve.mockRejectedValue(e(409, 'version_conflict'));
    render(<OwnerCommunityCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Caller asked for our login code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else acted on this');
    expect(api.awaitingApproval).toHaveBeenCalledTimes(2);
  });
  it('hidden when both reads are refused; a disabled community is explained', async () => {
    api.activeAlerts.mockRejectedValue(e(403, 'permission_denied'));
    api.awaitingApproval.mockRejectedValue(e(403, 'permission_denied'));
    const { container, unmount } = render(<OwnerCommunityCard />);
    await waitFor(() => expect(api.awaitingApproval).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(''));
    unmount();
    api.activeAlerts.mockRejectedValue(e(403, 'community_disabled'));
    api.awaitingApproval.mockRejectedValue(e(400, 'community_disabled'));
    render(<OwnerCommunityCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('turned off for your salon');
  });
  it('Phase 12: a salon not in the community is explained WITHOUT asking for alerts or approvals (no 403s)', async () => {
    api.settings.mockResolvedValue(settings({ enabled: false }));
    render(<OwnerCommunityCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('turned off for your salon');
    expect(api.activeAlerts).not.toHaveBeenCalled();
    expect(api.awaitingApproval).not.toHaveBeenCalled();
  });
  it('community_* events reload; Community settings opens the settings screen', async () => {
    render(<OwnerCommunityCard />);
    await screen.findByTestId('owner-community-approval');
    await act(async () => { stream.fn!('owner_payroll_updated'); });
    expect(api.awaitingApproval).toHaveBeenCalledTimes(1);
    await act(async () => { stream.fn!('community_post_updated'); });
    await waitFor(() => expect(api.awaitingApproval).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Community settings' }));
    expect(nav.openCommunitySettings).toHaveBeenCalled();
  });
  it('nothing waiting → plain message', async () => {
    api.awaitingApproval.mockResolvedValue([]);
    api.activeAlerts.mockResolvedValue([]);
    render(<OwnerCommunityCard />);
    expect(await screen.findByTestId('owner-community-empty')).toBeInTheDocument();
    expect(screen.getByTestId('owner-community-no-alerts')).toBeInTheDocument();
  });
});

describe('Owner community settings screen', () => {
  it('saves with expectedVersion; the technician toggle is a view_community grant', async () => {
    render(<OwnerCommunitySettingsScreen />);
    fireEvent.click(await screen.findByLabelText('Technicians can read the Safety Community'));
    fireEvent.click(screen.getByLabelText('SMS for critical alerts'));
    fireEvent.change(screen.getByLabelText('Community display name'), { target: { value: 'A Marlton salon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save community settings' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    expect(api.saveSettings.mock.calls[0][0]).toMatchObject({ expectedVersion: 2, displayName: 'A Marlton salon', roleGrants: { technician: ['view_community'] }, notify: { criticalSms: true, push: true } });
    expect(await screen.findByRole('status')).toHaveTextContent('saved');
  });
  it('a 409 reloads; a 403 is explained', async () => {
    api.saveSettings.mockRejectedValueOnce(e(409, 'version_conflict')).mockRejectedValueOnce(e(403, 'permission_denied'));
    render(<OwnerCommunitySettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save community settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else acted on this');
    expect(api.settings).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Save community settings' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('do not have permission'));
  });
});
