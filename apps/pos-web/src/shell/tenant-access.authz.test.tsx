// tenant-access.authz.test.tsx — BUILD_PLAN Phase 9: the sidebar re-asks /tenant/navigation when the server says this
// person's grants changed — the x-authorization-changed response header (any API call) or the authorization_changed
// realtime event (screen key "navigation") — so a demoted manager's menu shrinks without a reload.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { install, sent } from '../screens/access/accessTestKit';
import { api } from '../api/client';
import { REALTIME_EVENT } from '../realtime/realtime-client';
import { useTenantNavAccess } from './tenant-access';

function Probe() { const a = useTenantNavAccess('MANAGER', []); return <div data-testid="p">{a.permissions.join(',')}</div>; }
let perms = ['roles.view', 'technicians.edit'];
beforeEach(() => { perms = ['roles.view', 'technicians.edit']; install({
  'GET /tenant/navigation': () => ({ body: { role: 'MANAGER', permissions: perms, features: [], aiPackages: [], subscriptionStatus: 'active', salonName: 'S' } }),
  'GET /pos/anything': { body: {}, headers: { 'x-authorization-changed': '1' } },
  'GET /pos/quiet': { body: {} },
}); });

describe('sidebar refresh on an authorization change', () => {
  it('a response carrying x-authorization-changed: 1 makes the sidebar ask again; a normal response does not', async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('roles.view,technicians.edit'));
    await act(async () => { await api.get('/pos/quiet'); });
    expect(sent('GET', '/tenant/navigation').length).toBe(1);
    perms = ['technicians.edit'];
    await act(async () => { await api.get('/pos/anything'); });
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('technicians.edit'));
    expect(sent('GET', '/tenant/navigation').length).toBe(2);
  });
  it('the authorization_changed realtime event (screen "navigation") refetches; other events do not', async () => {
    render(<Probe />);
    await waitFor(() => expect(sent('GET', '/tenant/navigation').length).toBe(1));
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type: 'queue_updated', screens: ['queue'] } })); });
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type: 'authorization_changed', screens: ['session', 'navigation', 'team-permissions'] } })); });
    await waitFor(() => expect(sent('GET', '/tenant/navigation').length).toBe(2));
  });
});
