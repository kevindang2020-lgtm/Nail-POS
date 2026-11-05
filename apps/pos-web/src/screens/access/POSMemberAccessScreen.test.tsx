// POSMemberAccessScreen.test.tsx — BUILD_PLAN Phase 9: one person's access. Real api client, routed fetch; routes are
// contract §2.6 exactly (/pos/access/members/:id …, /pos/access/overrides/:id/revoke, /pos/access/preview, /pos/access/audit).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { REALTIME_EVENT } from '../../realtime/realtime-client';

const perms = { deny: new Set<string>(), me: 'u1', held: null as string[] | null };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: perms.me, role: 'OWNER', permissions: perms.held ?? undefined } }) }));
import { install, sent, CATALOG, ROLES, EFFECTIVE, member, stepUpGated, stepUpRoute, type Routes as R } from './accessTestKit';
import { POSMemberAccessScreen } from './POSMemberAccessScreen';

const M = '/pos/access/members/u2';
const routes = (): R => ({
  [`GET ${M}`]: { body: member({ overrides: [
    { id: 'o7', permission: 'settings.edit', effect: 'ALLOW', branchId: null, reason: 'covering for Olga', grantedByName: 'Olga Owner', startsAt: '2026-10-08T09:00:00Z', expiresAt: '2026-10-09T18:00:00Z', active: true, temporary: true },
    { id: 'o2', permission: 'customers.export', effect: 'DENY', branchId: 'b2', reason: 'no exports', grantedByName: 'Olga Owner', startsAt: '2026-10-01T09:00:00Z', expiresAt: null, active: true, temporary: false },
    { id: 'o0', permission: 'reports.view', effect: 'ALLOW', branchId: null, reason: 'old', grantedByName: null, startsAt: '2026-09-01T09:00:00Z', expiresAt: '2026-09-02T09:00:00Z', active: false, temporary: true },
  ] }) },
  [`GET ${M}/effective`]: { body: EFFECTIVE },
  'GET /pos/access/roles': { body: ROLES },
  'GET /pos/access/catalog': { body: CATALOG },
  'GET /tenant/locations': { body: { locations: [{ id: 'b1', name: 'Downtown' }, { id: 'b2', name: 'Uptown' }], summary: { total: 2, active: 2 } } },
  'GET /pos/access/audit': (c) => ({ body: { items: c.url.includes('page=2') ? [{ id: 'a3', action: 'role.assigned', actorName: 'Olga Owner', targetName: 'Mai Tran', before: null, after: { templateKey: null }, reason: 'first', createdAt: '2026-09-01T10:00:00Z' }]
    : [{ id: 'a1', action: 'override.granted', actorName: 'Olga Owner', targetName: 'Mai Tran', before: null, after: { permission: 'settings.edit' }, reason: 'covering for Olga', createdAt: '2026-10-08T09:00:00Z' }], page: c.url.includes('page=2') ? 2 : 1, pageSize: 20, total: 2, hasMore: !c.url.includes('page=2') } }),
  'POST /pos/access/preview': (c) => ({ body: c.body.templateKey === 'ACCOUNTANT'
    ? { granted: ['pos.login', 'reports.view'], denied: [], added: [], removed: ['booking.manage', 'checkout.approve_refund'], highRisk: [] }
    : { granted: ['pos.login', 'checkout.approve_refund'], denied: [], added: [c.body.overrides?.[0]?.permission].filter(Boolean), removed: [], highRisk: ['checkout.approve_refund'] } }),
  'POST /auth/step-up': stepUpRoute(),
  [`PUT ${M}/role`]: stepUpGated(() => ({ body: member({ templateKey: 'ACCOUNTANT', templateName: 'Accountant' }) })),
  [`PUT ${M}/branches`]: stepUpGated(() => ({ body: member() })),
  [`POST ${M}/overrides`]: stepUpGated((c) => ({ body: { id: 'o9', permission: c.body.permission, effect: c.body.effect, branchId: c.body.branchId, reason: c.body.reason, grantedByName: 'Olga Owner', startsAt: '2026-10-08T12:00:00Z', expiresAt: c.body.expiresAt, active: true, temporary: !!c.body.expiresAt } })),
  'POST /pos/access/overrides/o2/revoke': { body: { id: 'o2', active: false } },
});
let R0: R;
beforeEach(() => { perms.deny = new Set(); perms.me = 'u1'; perms.held = null; R0 = routes(); install(R0); });
const renderAt = () => render(<MemoryRouter initialEntries={['/tenant/team/permissions/u2']}><Routes><Route path="/tenant/team/permissions/:userId" element={<POSMemberAccessScreen />} /></Routes></MemoryRouter>);
const confirmStepUp = async () => {
  const dlg = await screen.findByRole('dialog', { name: "Confirm it's you" });
  fireEvent.change(within(dlg).getByLabelText('Your password'), { target: { value: 'right-pw' } });
  fireEvent.click(within(dlg).getByText('Confirm'));
};

describe('effective permissions with reason codes', () => {
  it('shows every key with WHY they hold it (incl. a temporary grant’s end) and what is blocked', async () => {
    renderAt();
    expect((await screen.findAllByTestId('effective-row')).length).toBe(3);
    expect(screen.getByTestId('reason-pos.login')).toHaveTextContent('Role');
    expect(screen.getByTestId('reason-settings.edit')).toHaveTextContent(/Temporary grant · until Oct 09, 2026/);
    expect(screen.getByTestId('denied-row')).toHaveTextContent('Export customers — Blocked for this person');
    fireEvent.change(screen.getByLabelText('Search permissions'), { target: { value: 'reports' } });
    expect(screen.getAllByTestId('effective-row').length).toBe(1);
  });
});

describe('role: preview before saving, reason, step-up', () => {
  it('offers every role grouped by base role (theirs first; another base = promotion / demotion); Save needs a preview + a reason; step-up then saves once', async () => {
    renderAt();
    const sel = (await screen.findByLabelText('Role template')) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'MANAGER', 'ACCOUNTANT', 'FRONT_DESK', 'custom:lead']);   // their base role first
    expect([...sel.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Manager roles', 'Front Desk roles (changes their base role)']);
    fireEvent.change(sel, { target: { value: 'ACCOUNTANT' } });
    const save = screen.getByText('Save role');
    fireEvent.change(screen.getByLabelText('Reason for the role change'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Reason for the role change'), { target: { value: 'Moved to the books' } });
    expect(save).toBeDisabled();   // a reason but no preview yet → cannot save
    fireEvent.change(screen.getByLabelText('Reason for the role change'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Preview change'));
    const pv = await screen.findByTestId('access-preview');
    expect(pv).toHaveTextContent('0 added · 2 removed');
    expect(pv).toHaveTextContent('Removes: Manage bookings, Approve large refunds');
    expect(sent('POST', '/pos/access/preview')[0].body).toEqual({ userId: 'u2', templateKey: 'ACCOUNTANT' });
    expect(save).toBeDisabled();   // no reason yet
    fireEvent.change(screen.getByLabelText('Reason for the role change'), { target: { value: 'Moved to the books' } });
    fireEvent.click(save);
    await confirmStepUp();
    expect(await screen.findByText(/Role saved/)).toBeInTheDocument();
    const puts = sent('PUT', `${M}/role`);
    expect(puts.length).toBe(2);
    expect(puts[1].body).toEqual({ templateKey: 'ACCOUNTANT', reason: 'Moved to the books' });
  });
  it('a refusal (self-escalation / above your ceiling) is shown with its reason code', async () => {
    R0[`PUT ${M}/role`] = { status: 403, body: { code: 'PERMISSION_DENIED', message: 'You cannot give access you do not hold.', reason: 'missing_permission', permission: 'roles.manage' } };
    renderAt();
    fireEvent.change(await screen.findByLabelText('Role template'), { target: { value: 'ACCOUNTANT' } });
    fireEvent.click(screen.getByText('Preview change'));
    await screen.findByTestId('access-preview');
    fireEvent.change(screen.getByLabelText('Reason for the role change'), { target: { value: 'test it' } });
    fireEvent.click(screen.getByText('Save role'));
    expect(await screen.findByText('You cannot give access you do not hold. (Not in their role)')).toBeInTheDocument();
  });
  it('a 409 LAST_OWNER is explained', async () => {
    R0[`PUT ${M}/role`] = { status: 409, body: { code: 'LAST_OWNER', message: 'x' } };
    renderAt();
    fireEvent.change(await screen.findByLabelText('Role template'), { target: { value: 'ACCOUNTANT' } });
    fireEvent.click(screen.getByText('Preview change'));
    await screen.findByTestId('access-preview');
    fireEvent.change(screen.getByLabelText('Reason for the role change'), { target: { value: 'demote' } });
    fireEvent.click(screen.getByText('Save role'));
    expect(await screen.findByText(/must keep at least one active owner/)).toBeInTheDocument();
  });
  it('your own page is read-only: no role, branch or grant controls (self-assignment is blocked)', async () => {
    perms.me = 'u2';
    renderAt();
    expect(await screen.findByTestId('self-note')).toBeInTheDocument();
    expect(screen.getByLabelText('Role template')).toBeDisabled();
    expect(screen.queryByText('Save role')).toBeNull();
    expect(screen.queryByText('Save branches')).toBeNull();
    expect(screen.queryByRole('group', { name: 'New grant' })).toBeNull();
    expect(screen.queryByText('Revoke…')).toBeNull();
  });
});

describe('branch access', () => {
  it('saves the chosen branches + level + reason through step-up', async () => {
    renderAt();
    fireEvent.click(await screen.findByLabelText('Branch Uptown'));
    fireEvent.change(screen.getByLabelText('Access level'), { target: { value: 'viewer' } });
    fireEvent.change(screen.getByLabelText('Reason for the branch change'), { target: { value: 'Helps at Uptown' } });
    fireEvent.click(screen.getByText('Save branches'));
    await confirmStepUp();
    expect(await screen.findByText('Branch access saved.')).toBeInTheDocument();
    expect(sent('PUT', `${M}/branches`)[1].body).toEqual({ branchIds: ['b2'], accessLevel: 'viewer', reason: 'Helps at Uptown' });
  });
  it('without branch_access.manage the editor is read-only', async () => {
    perms.deny = new Set(['branch_access.manage']);
    renderAt();
    expect(await screen.findByLabelText('Branch Uptown')).toBeDisabled();
    expect(screen.queryByText('Save branches')).toBeNull();
  });
});

describe('individual grants: ALLOW / DENY, temporary, preview, revoke', () => {
  it('lists live grants (temporary until …, blocked for one branch) and ended ones apart', async () => {
    renderAt();
    const rows = await screen.findAllByTestId('override-row');
    expect(rows.length).toBe(3);   // 2 live + 1 ended (inside <details>)
    expect(rows[0]).toHaveTextContent(/Edit salon settings.*Allowed.*All their branches.*Until Oct 09, 2026/);
    expect(rows[1]).toHaveTextContent(/Export customers.*Blocked.*Uptown.*Until revoked/);
    expect(screen.getByText('Ended or revoked (1)')).toBeInTheDocument();
  });
  it('a temporary ALLOW: preview, then step-up, then POST with expiresAt; ALLOW offers only keys the granter holds and never platform keys', async () => {
    perms.held = ['pos.login', 'reports.view', 'customers.export'];
    renderAt();
    const pick = (await screen.findByLabelText('Permission')) as HTMLSelectElement;
    const offered = [...pick.querySelectorAll('option')].map((o) => o.value).filter(Boolean);
    expect(offered.sort()).toEqual(['customers.export', 'pos.login', 'reports.view']);
    fireEvent.change(pick, { target: { value: 'reports.view' } });
    fireEvent.click(screen.getByLabelText('Temporary'));
    fireEvent.change(screen.getByLabelText('Expires at'), { target: { value: '2026-10-10T18:00' } });
    fireEvent.change(screen.getByLabelText('Reason for the grant'), { target: { value: 'Month-end close' } });
    expect(screen.getByRole('button', { name: 'Grant' })).toBeDisabled();
    fireEvent.click(screen.getByText('Preview'));
    expect(await screen.findByTestId('access-preview')).toHaveTextContent('Adds: View reports');
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }));
    await confirmStepUp();
    expect(await screen.findByText('Temporary access granted.')).toBeInTheDocument();
    const b = sent('POST', `${M}/overrides`)[1].body;
    expect(b).toMatchObject({ permission: 'reports.view', effect: 'ALLOW', reason: 'Month-end close' });
    expect('branchId' in b).toBe(false);   // a top-level branchId is refused by the client and stripped by the API (see OVERRIDE_BRANCH_FIELD)
    expect(b.expiresAt).toBe(new Date('2026-10-10T18:00').toISOString());
    expect(sent('POST', '/pos/access/preview')[0].body.overrides[0]).toMatchObject({ permission: 'reports.view', effect: 'ALLOW' });
  });
  it('a DENY may block any salon key (even one the granter lacks); the branch picker defaults to every branch (no scopeBranchId sent)', async () => {
    perms.held = ['pos.login'];
    renderAt();
    fireEvent.change(await screen.findByLabelText('Allow or block'), { target: { value: 'DENY' } });
    const offered = [...(screen.getByLabelText('Permission') as HTMLSelectElement).querySelectorAll('option')].map((o) => o.value).filter(Boolean);
    expect(offered).toContain('checkout.approve_refund');
    expect(offered).not.toContain('super_admin.tenants.view');
    fireEvent.change(screen.getByLabelText('Permission'), { target: { value: 'checkout.approve_refund' } });
    expect((screen.getByLabelText('Grant branch') as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Reason for the grant'), { target: { value: 'Under review' } });
    fireEvent.click(screen.getByText('Preview'));
    await screen.findByTestId('access-preview');
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    await confirmStepUp();
    expect(await screen.findByText('Blocked.')).toBeInTheDocument();
    expect(sent('POST', `${M}/overrides`)[1].body).toEqual({ permission: 'checkout.approve_refund', effect: 'DENY', reason: 'Under review', expiresAt: null });
  });
  it('revoke needs a reason and posts to /pos/access/overrides/:id/revoke', async () => {
    renderAt();
    await screen.findAllByTestId('override-row');
    fireEvent.click(screen.getAllByText('Revoke…')[1]);
    const btn = screen.getByText('Revoke');
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for revoking'), { target: { value: 'review done' } });
    fireEvent.click(btn);
    expect(await screen.findByText('Revoked.')).toBeInTheDocument();
    expect(sent('POST', '/pos/access/overrides/o2/revoke')[0].body).toEqual({ reason: 'review done' });
  });
  it('without permissions.override there is no grant form and no revoke', async () => {
    perms.deny = new Set(['permissions.override']);
    renderAt();
    await screen.findAllByTestId('override-row');
    expect(screen.queryByRole('group', { name: 'New grant' })).toBeNull();
    expect(screen.queryByText('Revoke…')).toBeNull();
  });
});

describe('audit + live refresh', () => {
  it('pages the member’s authorization audit (userId, page, pageSize go to the server)', async () => {
    renderAt();
    expect((await screen.findAllByTestId('audit-row')).length).toBe(1);
    expect(sent('GET', '/pos/access/audit')[0].url).toMatch(/userId=u2/);
    fireEvent.click(screen.getByText('Load more'));
    await waitFor(() => expect(screen.getAllByTestId('audit-row').length).toBe(2));
    expect(sent('GET', '/pos/access/audit').some((c) => /page=2/.test(c.url) && /pageSize=20/.test(c.url))).toBe(true);
  });
  it('an authorization_changed event (team-permissions) reloads the person', async () => {
    renderAt();
    await screen.findAllByTestId('effective-row');
    const before = sent('GET', `${M}/effective`).length;
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type: 'authorization_changed', screens: ['session', 'navigation', 'team-permissions'] } })); });
    await waitFor(() => expect(sent('GET', `${M}/effective`).length).toBeGreaterThan(before), { timeout: 3000 });
  });
  it('a 403 on the member shows a permission message', async () => {
    R0[`GET ${M}`] = { status: 403, body: { code: 'PERMISSION_DENIED' } };
    renderAt();
    expect(await screen.findByText(/do not have permission/)).toBeInTheDocument();
  });
});

// B-13 (Oct 20 2026): end employment for staff who are not technicians
describe('end employment', () => {
  it('needs a typed reason, confirms through step-up, posts to /end-employment and shows the ended state', async () => {
    R0[`POST ${M}/end-employment`] = stepUpGated((c) => ({ body: { ok: true, userId: 'u2', sessionsRevoked: 2, branchGrantsRemoved: 1, reason: c.body.reason } }));
    install(R0);
    renderAt();
    fireEvent.click(await screen.findByText('End employment…'));
    const save = screen.getByText('End employment now');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for ending employment'), { target: { value: 'Left the salon on Oct 20' } });
    fireEvent.click(save);
    await confirmStepUp();
    expect(await screen.findByText(/Employment ended — 2 session\(s\) signed out/)).toBeInTheDocument();
    expect(sent('POST', `${M}/end-employment`)[1].body).toEqual({ reason: 'Left the salon on Oct 20' });
  });
  it('is not offered on your own page, for technicians, or without roles.manage', async () => {
    perms.me = 'u2'; const r1 = renderAt();
    expect(await screen.findByTestId('self-note')).toBeInTheDocument();
    expect(screen.queryByText('End employment…')).toBeNull();
    r1.unmount();
    perms.me = 'u1'; perms.deny = new Set(['roles.manage']); const r2 = renderAt();
    await screen.findByText('Mai Tran');
    expect(screen.queryByText('End employment…')).toBeNull();
    r2.unmount();
    perms.deny = new Set();
    R0[`GET ${M}`] = { body: member({ role: 'TECHNICIAN' }) }; install(R0); renderAt();
    await screen.findByText('Mai Tran');
    expect(screen.queryByText('End employment…')).toBeNull();
  });
  it('a 409 LAST_OWNER is explained', async () => {
    R0[`GET ${M}`] = { body: member({ role: 'OWNER', isOwner: true }) };
    R0[`POST ${M}/end-employment`] = stepUpGated(() => ({ status: 409, body: { code: 'LAST_OWNER', message: 'The salon must keep an active owner.' } }));
    install(R0); renderAt();
    fireEvent.click(await screen.findByText('End employment…'));
    fireEvent.change(screen.getByLabelText('Reason for ending employment'), { target: { value: 'retiring' } });
    fireEvent.click(screen.getByText('End employment now'));
    await confirmStepUp();
    expect(await screen.findByText(/must keep at least one active owner/)).toBeInTheDocument();
  });
});
