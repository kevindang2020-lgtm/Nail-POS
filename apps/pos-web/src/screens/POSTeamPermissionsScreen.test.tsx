// POSTeamPermissionsScreen.test.tsx — BUILD_PLAN Phase 9: the ONE roster (Team › Roles & Permissions). Through the real
// api client with a routed fetch; routes are contract §2.6 (/pos/access/*) + /pos/staff-roles (custom roles).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const perms = { deny: new Set<string>(), held: null as string[] | null };
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', role: 'OWNER', permissions: perms.held ?? undefined } }) }));
import { install, sent, CATALOG, MEMBERS, ROLES, stepUpGated, stepUpRoute, type Routes as R } from './access/accessTestKit';
import { POSTeamPermissionsScreen } from './POSTeamPermissionsScreen';

const matrix = { roles: ['OWNER', 'MANAGER'], roleSummaries: [{ role: 'OWNER', count: 144 }, { role: 'MANAGER', count: 126 }], totalPermissions: 144,
  groups: [{ domain: 'checkout', permissions: [{ key: 'checkout.view', roles: ['OWNER', 'MANAGER'] }, { key: 'checkout.process_payment', roles: ['OWNER'] }] }] };
const routes = (): R => ({
  'GET /pos/access/members': { body: MEMBERS },
  'GET /pos/access/roles': { body: ROLES },
  'GET /pos/access/catalog': { body: CATALOG },
  'GET /pos/team': { body: { users: [{ id: 'u1', name: 'Olga Owner', email: null, role: 'OWNER', status: 'active', branchId: null, lastLoginAt: null, mfaEnabled: true, createdAt: '2024-01-01T00:00:00Z', isYou: true }], roles: [], summary: { total: 1, active: 1, admins: 1 } } },
  'GET /pos/team/permissions/state': { body: matrix },
  'POST /pos/access/preview': (c) => ({ body: { granted: c.body.customRole.permissions, denied: [], added: [], removed: ['booking.manage'], highRisk: c.body.customRole.permissions.filter((k: string) => k === 'customers.export') } }),
  'POST /pos/staff-roles': { body: { key: 'custom:new', name: 'x', baseRole: 'MANAGER', scope: 'BRANCH', permissions: [], custom: true } },
  'POST /pos/staff-roles/lead/archive': { body: { ok: true } },
  'POST /auth/step-up': stepUpRoute(),
  'POST /pos/access/ownership/transfer': stepUpGated(() => ({ body: { ok: true, newOwnerUserId: 'u2', previousOwnerUserId: 'u1' } })),
});
let R0: R;
beforeEach(() => { perms.deny = new Set(); perms.held = null; R0 = routes(); install(R0); });
const renderAt = () => render(<MemoryRouter initialEntries={['/tenant/team/permissions']}><Routes>
  <Route path="/tenant/team/permissions" element={<POSTeamPermissionsScreen />} />
  <Route path="/tenant/team/permissions/:userId" element={<div data-testid="member-page" />} />
</Routes></MemoryRouter>);
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('Team roster', () => {
  it('lists everyone with role, branches, grants, 2FA, dormant badge and owner badges', async () => {
    renderAt();
    expect((await screen.findAllByTestId('access-member-row')).length).toBe(3);
    expect(screen.getByText('Primary owner')).toBeInTheDocument();
    expect(screen.getAllByTestId('dormant-badge').length).toBe(1);
    const rae = screen.getAllByTestId('access-member-row')[2];
    expect(rae.textContent).toContain('Uptown');
    expect(rae.textContent).toContain('1 (1 blocked)');
    expect(await screen.findByText('You')).toBeInTheDocument();            // merged from /pos/team (the old Users & Roles data)
    expect(screen.getAllByTestId('access-member-row')[1].textContent).toContain('Home branch');
  });
  it('search and role filter narrow the list; a row opens the per-person page', async () => {
    renderAt();
    await screen.findAllByTestId('access-member-row');
    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'FRONT_DESK' } });
    expect(screen.getAllByTestId('access-member-row').length).toBe(1);
    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search team'), { target: { value: 'mai' } });
    expect(screen.getAllByTestId('access-member-row').length).toBe(1);
    fireEvent.click(screen.getByText('Mai Tran'));
    expect(await screen.findByTestId('member-page')).toBeInTheDocument();
  });
});

describe('Invite staff (wave 4 pilot: the salon invites its own front desk / manager)', () => {
  it('an owner invites a receptionist: POST /pos/access/invitations, and a link to hand over when nothing was delivered', async () => {
    R0['POST /pos/access/invitations'] = { body: { id: 'inv1', status: 'pending', role: 'RECEPTION', deliveryStatus: 'not_connected', acceptUrl: 'https://portal.test/accept-invite?token=abc' } };
    renderAt();
    await screen.findAllByTestId('access-member-row');
    fireEvent.click(screen.getByRole('button', { name: 'Invite staff' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Rae Desk' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'rae@desk.test' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'RECEPTION' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(sent('POST', '/pos/access/invitations').length).toBe(1));
    expect(sent('POST', '/pos/access/invitations')[0].body).toMatchObject({ fullName: 'Rae Desk', email: 'rae@desk.test', role: 'RECEPTION' });
    expect(await screen.findByText(/accept-invite\?token=abc/)).toBeInTheDocument();
  });
  it('inviting a MANAGER answers STEP_UP_REQUIRED: the form asks for the password inline, then the invitation goes through', async () => {
    R0['POST /pos/access/invitations'] = stepUpGated(() => ({ body: { id: 'inv2', status: 'pending', role: 'MANAGER', deliveryStatus: 'sent' } }));
    renderAt();
    await screen.findAllByTestId('access-member-row');
    fireEvent.click(screen.getByRole('button', { name: 'Invite staff' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Max Floor' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'max@floor.test' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'MANAGER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    const dlg = await screen.findByRole('dialog', { name: "Confirm it's you" });
    expect(screen.queryByRole('alert')).toBeNull();   // not reported as a failure — it asks
    fireEvent.change(within(dlg).getByLabelText('Your password'), { target: { value: 'right-pw' } });
    fireEvent.click(within(dlg).getByText('Confirm'));
    expect(await screen.findByText('Invitation sent.')).toBeInTheDocument();
    expect(sent('POST', '/pos/access/invitations').length).toBe(2);   // refused once, retried once after the step-up
    expect(sent('POST', '/auth/step-up').length).toBe(1);
  });
  it('cancelling the step-up leaves the form open with no invitation and no error', async () => {
    R0['POST /pos/access/invitations'] = stepUpGated(() => ({ body: { id: 'inv3', status: 'pending', role: 'MANAGER', deliveryStatus: 'sent' } }));
    renderAt();
    await screen.findAllByTestId('access-member-row');
    fireEvent.click(screen.getByRole('button', { name: 'Invite staff' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Max Floor' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'max@floor.test' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'MANAGER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    const dlg = await screen.findByRole('dialog', { name: "Confirm it's you" });
    fireEvent.click(within(dlg).getByText('Cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send invitation' })).not.toBeDisabled();
  });
  it('without roles.manage there is no invite button', async () => {
    perms.deny = new Set(['roles.manage']);
    renderAt();
    await screen.findAllByTestId('access-member-row');
    expect(screen.queryByRole('button', { name: 'Invite staff' })).toBeNull();
  });
});

describe('Roles + the custom-role builder', () => {
  it('lists templates and custom roles; archiving a custom role posts to /pos/staff-roles/:id/archive', async () => {
    renderAt(); tab('Roles');
    expect((await screen.findAllByTestId('role-row')).length).toBe(4);
    fireEvent.click(screen.getByText('Archive'));
    await waitFor(() => expect(sent('POST', '/pos/staff-roles/lead/archive').length).toBe(1));
  });
  it('offers only the base role’s keys the builder HOLDS, grouped by registry domain with sensitivity; Create needs a preview first', async () => {
    perms.held = ['pos.login', 'reports.view', 'customers.export', 'booking.manage'];   // not checkout.approve_refund
    renderAt(); tab('Roles');
    fireEvent.click(await screen.findByText('New custom role'));
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Shift Lead' } });
    fireEvent.change(screen.getByLabelText('Built on'), { target: { value: 'MANAGER' } });
    const box = screen.getByLabelText('New role');
    expect(within(box).getByLabelText('Export customers')).toBeInTheDocument();
    expect(within(box).queryByLabelText('Approve large refunds')).toBeNull();    // above the builder's own ceiling
    expect(within(box).queryByLabelText('Edit salon settings')).toBeNull();      // not a MANAGER template key
    expect(within(box).getByTestId('sens-high')).toBeInTheDocument();
    expect(within(box).getByText('Lets them customers.export')).toBeInTheDocument();   // the registry description
    fireEvent.click(within(box).getByLabelText('Export customers'));
    expect(screen.getByText('Create role')).toBeDisabled();
    fireEvent.click(screen.getByText('Preview'));
    expect(await screen.findByTestId('role-preview')).toHaveTextContent('High-risk: Export customers');
    expect(sent('POST', '/pos/access/preview')[0].body).toEqual({ customRole: { baseRole: 'MANAGER', scope: 'BRANCH', permissions: ['pos.login', 'customers.export'] } });
    fireEvent.click(screen.getByText('Create role'));
    await waitFor(() => expect(sent('POST', '/pos/staff-roles').length).toBe(1));
    expect(sent('POST', '/pos/staff-roles')[0].body).toEqual({ name: 'Shift Lead', baseRole: 'MANAGER', scope: 'BRANCH', permissions: ['pos.login', 'customers.export'] });
  });
  it('changing a permission after the preview needs a new preview', async () => {
    renderAt(); tab('Roles');
    fireEvent.click(await screen.findByText('New custom role'));
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Shift Lead' } });
    fireEvent.click(screen.getByText('Preview'));
    await screen.findByTestId('role-preview');
    expect(screen.getByText('Create role')).not.toBeDisabled();
    fireEvent.click(within(screen.getByLabelText('New role')).getByLabelText('Manage bookings'));
    expect(screen.queryByTestId('role-preview')).toBeNull();
    expect(screen.getByText('Create role')).toBeDisabled();
  });
  it('without roles.manage there is no builder and no archive', async () => {
    perms.deny = new Set(['roles.manage']);
    renderAt(); tab('Roles');
    await screen.findAllByTestId('role-row');
    expect(screen.queryByText('New custom role')).toBeNull();
    expect(screen.queryByText('Archive')).toBeNull();
  });
});

describe('Role matrix (reference)', () => {
  it('renders per-role counts and expands a domain', async () => {
    renderAt(); tab('Role matrix');
    expect(await screen.findByText('144')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Checkout/));
    expect(await screen.findByText('process payment')).toBeInTheDocument();
  });
});

describe('Ownership transfer', () => {
  it('owners only: the tab is absent without ownership.transfer', async () => {
    perms.deny = new Set(['ownership.transfer']);
    renderAt();
    await screen.findAllByTestId('access-member-row');
    expect(screen.queryByRole('tab', { name: 'Ownership' })).toBeNull();
  });
  it('confirm → step-up prompt → password → the transfer is retried once and succeeds', async () => {
    renderAt(); tab('Ownership');
    const sel = (await screen.findByLabelText('New owner')) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'u2', 'u3']);   // never the current owner / yourself
    fireEvent.change(sel, { target: { value: 'u2' } });
    fireEvent.change(screen.getByLabelText('Your role afterwards'), { target: { value: 'MANAGER' } });
    fireEvent.change(screen.getByLabelText('Reason for the transfer'), { target: { value: 'Selling the salon' } });
    fireEvent.click(screen.getByText('Transfer ownership…'));
    fireEvent.click(screen.getByText('Yes, transfer'));
    const dlg = await screen.findByRole('dialog', { name: "Confirm it's you" });
    fireEvent.change(within(dlg).getByLabelText('Your password'), { target: { value: 'wrong' } });
    fireEvent.click(within(dlg).getByText('Confirm'));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Password is not correct.');
    fireEvent.change(within(dlg).getByLabelText('Your password'), { target: { value: 'right-pw' } });
    fireEvent.click(within(dlg).getByText('Confirm'));
    expect(await screen.findByText('Ownership transferred to Mai Tran.')).toBeInTheDocument();
    const t = sent('POST', '/pos/access/ownership/transfer');
    expect(t.length).toBe(2);   // refused (step-up) once, then retried once
    expect(t[1].body).toEqual({ toUserId: 'u2', reason: 'Selling the salon', keepPreviousOwnerAs: 'MANAGER' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('a 409 LAST_OWNER is explained, not shown as a raw error', async () => {
    R0['POST /pos/access/ownership/transfer'] = { status: 409, body: { code: 'LAST_OWNER', message: 'conflict' } };
    renderAt(); tab('Ownership');
    fireEvent.change(await screen.findByLabelText('New owner'), { target: { value: 'u2' } });
    fireEvent.change(screen.getByLabelText('Reason for the transfer'), { target: { value: 'Selling the salon' } });
    fireEvent.click(screen.getByText('Transfer ownership…'));
    fireEvent.click(screen.getByText('Yes, transfer'));
    expect(await screen.findByText(/must keep at least one active owner/)).toBeInTheDocument();
  });
  it('cancelling the step-up makes no change and says so', async () => {
    renderAt(); tab('Ownership');
    fireEvent.change(await screen.findByLabelText('New owner'), { target: { value: 'u2' } });
    fireEvent.change(screen.getByLabelText('Reason for the transfer'), { target: { value: 'Selling the salon' } });
    fireEvent.click(screen.getByText('Transfer ownership…'));
    fireEvent.click(screen.getByText('Yes, transfer'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Cancel'));
    expect(await screen.findByText(/password confirmation was cancelled/)).toBeInTheDocument();
    expect(sent('POST', '/pos/access/ownership/transfer').length).toBe(1);
  });
});
