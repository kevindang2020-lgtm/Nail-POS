// CommunityOpsCards.test — extras Safety Community 06 / 08 / 09: each card shows the server's answer only (the role preview's
// verdicts and reasons, the corrections inbox's changes / reach / appeals, the diagnostics export's outcome).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { B, installFetch, myPost, page, sent, err, type Route as R } from './communityTestKit';

const perms = { deny: new Set<string>() };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER', userId: 'u1' } }) }));
import { posCommunityApi } from '../../api/posCommunityApi';
import { CommunityRolePreviewCard, CommunityDiagnosticsCard } from './CommunityOpsCards';
import { CommunityDraftsScreen } from './CommunityDraftsScreen';

const action = (a: string, allowed: boolean, blockedBy: string | null = null) => ({ action: a, routeKey: 'community.x', capability: null, routeHeld: blockedBy !== 'role_permission', capabilityHeld: allowed, allowed, blockedBy });
const preview = (o: any = {}) => ({ communityEnabled: true, settingsVersion: 3, customRoles: 2, moderationGrantable: false, roles: [
  { key: 'TENANT_OWNER', name: 'Tenant Owner', baseRole: 'OWNER', communityRole: 'owner', actions: [action('approve_advisory', true), action('manage_settings', true)] },
  { key: 'RECEPTIONIST', name: 'Receptionist', baseRole: 'FRONT_DESK', communityRole: 'receptionist', actions: [action('draft_advisory', true), action('submit_advisory', false, 'role_permission'), action('comment', false, 'salon_setting')] },
], ...o });
let routes: Record<string, R>;
beforeEach(() => {
  perms.deny = new Set();
  routes = {
    [`GET ${B}/role-preview`]: { body: preview() },
    [`GET ${B}/mine`]: { body: page([myPost({ id: 'm1', title: 'My draft' })]) },
    [`GET ${B}/corrections`]: { body: { page: 1, pageSize: 10, total: 1, totalPages: 1, items: [{ postId: 'p9', title: 'Gift card callers', status: 'resolved', publishedAt: '2026-10-01T12:00:00Z', followers: 4, lastChangeAt: '2026-10-05T12:00:00Z',
      removedNote: null, resolutionNote: 'The caller was caught', disputes: { open: 1, closed: 0 },
      changes: [{ at: '2026-10-05T12:00:00Z', version: 7, kind: 'resolved', byModeration: false, note: 'The caller was caught', notifiedSalons: 3 },
        { at: '2026-10-03T12:00:00Z', version: 5, kind: 'label', byModeration: true, note: null, notifiedSalons: 0 }],
      appeals: [{ id: 'a1', subject: 'severity_change', status: 'under_review', createdAt: '2026-10-04T10:00:00Z', decidedAt: null, decisionNote: null }] }] } },
  };
  installFetch(routes);
});

describe('extras Safety Community 08 — role preview card', () => {
  it('loads on request; each action says can / cannot and why (from the server); a role switch shows that role', async () => {
    render(<CommunityRolePreviewCard />);
    expect(sent('GET', `${B}/role-preview`)).toHaveLength(0);                  // nothing is fetched until asked
    fireEvent.click(screen.getByTestId('community-role-preview-load'));
    const rows = await screen.findAllByTestId('community-role-action');
    expect(rows.map((r) => [r.getAttribute('data-action'), r.getAttribute('data-allowed')])).toEqual([['draft_advisory', 'yes'], ['submit_advisory', 'no'], ['comment', 'no']]);
    expect(rows[1].textContent).toContain('the role does not have this permission');
    expect(rows[2].textContent).toContain("turned off in this salon's settings");
    expect(screen.getByTestId('community-role-preview').textContent).toContain('2 custom role(s)');
    fireEvent.change(screen.getByTestId('community-role-preview-role'), { target: { value: 'TENANT_OWNER' } });
    expect(screen.getAllByTestId('community-role-action').every((r) => r.getAttribute('data-allowed') === 'yes')).toBe(true);
  });
  it('says plainly when the community is off; a refusal shows the server error', async () => {
    routes[`GET ${B}/role-preview`] = { body: preview({ communityEnabled: false }) };
    const { unmount } = render(<CommunityRolePreviewCard />);
    fireEvent.click(screen.getByTestId('community-role-preview-load'));
    expect(await screen.findByTestId('community-role-preview-off')).toBeTruthy();
    unmount();
    routes[`GET ${B}/role-preview`] = err(403, 'permission_denied');
    render(<CommunityRolePreviewCard />);
    fireEvent.click(screen.getByTestId('community-role-preview-load'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('extras Safety Community 09 — diagnostics export card', () => {
  it('sends the chosen range to the server export and reports the outcome', async () => {
    (URL as any).createObjectURL = vi.fn(() => 'blob:x'); (URL as any).revokeObjectURL = vi.fn();
    const spy = vi.spyOn(posCommunityApi, 'diagnosticsExport').mockResolvedValueOnce('csv').mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503, code: 'export_unavailable' }));
    render(<CommunityDiagnosticsCard />);
    fireEvent.change(screen.getByTestId('community-diag-from'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByTestId('community-diag-to'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByTestId('community-diag-export'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('2026-09-01', '2026-09-30'));
    expect(await screen.findByTestId('community-diag-note')).toHaveTextContent('Diagnostics downloaded.');
    fireEvent.click(screen.getByTestId('community-diag-export'));
    await waitFor(() => expect(screen.getByTestId('community-diag-note').getAttribute('role')).toBe('alert'));
  });
});

describe('extras Safety Community 06 — corrections tab', () => {
  const renderIt = () => render(<MemoryRouter initialEntries={['/community/drafts']}><Routes><Route path="/community/drafts" element={<CommunityDraftsScreen />} /></Routes></MemoryRouter>);
  it('lists each change with who made it and its in-app reach, plus the appeal; moderation notes are not shown', async () => {
    renderIt();
    await screen.findByText('My draft');
    fireEvent.click(screen.getByRole('tab', { name: 'Corrections' }));
    const item = await screen.findByTestId('community-correction');
    expect(within(item).getByText('Gift card callers').closest('a')).toHaveAttribute('href', '/community/posts/p9');
    const changes = within(item).getAllByTestId('community-correction-change');
    expect(changes.map((c) => c.getAttribute('data-kind'))).toEqual(['resolved', 'label']);
    expect(changes[0].textContent).toContain('by your salon'); expect(within(changes[0]).getByTestId('community-correction-reach').textContent).toBe('reached 3 salons');
    expect(changes[1].textContent).toContain('by moderation');
    expect(within(item).getByTestId('community-correction-appeals').textContent).toContain('Appeal (severity change): under review');
    expect(item.textContent).toContain('4 following · 1 open disputes');
    expect(sent('GET', `${B}/corrections`)[0].query.get('page')).toBe('1');
  });
  it('the tab is hidden without the appeal permission', async () => {
    perms.deny = new Set(['community.appeal.create']);
    renderIt();
    await screen.findByText('My draft');
    expect(screen.queryByRole('tab', { name: 'Corrections' })).toBeNull();
  });
});
