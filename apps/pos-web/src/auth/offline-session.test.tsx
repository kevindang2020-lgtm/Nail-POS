// offline-session.test.tsx — Decision 33: opening the POS with no connection. Only the last user's remembered session,
// within 8 hours, never on a locked or signed-out device, read-only; back online the server decides at once.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { rememberSession, forgetSession, offlineSessionPrincipal, OFFLINE_SESSION_HOURS } from './offline-session';
import { markLocked } from '../shell/idle-lock';

const me = vi.fn(); const logoutApi = vi.fn(async () => {});
vi.mock('../api/authApi', () => ({ authApi: { me: () => me(), logout: () => logoutApi() } }));
import { AuthProvider, useAuth } from './AuthContext';

const P = { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'FRONT_DESK', permissions: ['pos.booking.view'], fullName: 'Ana Lee' } as any;
let online = true;
beforeEach(() => { localStorage.clear(); me.mockReset(); online = true; Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online }); });
afterEach(() => { vi.useRealTimers(); });

describe('offlineSessionPrincipal', () => {
  const t0 = Date.parse('2026-10-03T14:00:00Z');
  it('the last remembered user, within 8 hours — nothing secret stored', () => {
    rememberSession({ ...P, email: 'ana@x.test' }, localStorage, t0);
    expect(offlineSessionPrincipal(localStorage, t0 + OFFLINE_SESSION_HOURS * 3_600_000)).toMatchObject({ userId: 'u1', role: 'FRONT_DESK' });
    expect(JSON.stringify(localStorage)).not.toMatch(/password|pin|token|cookie|ana@x\.test/i);
  });
  it('not after 8 hours, not on a locked device, not for a billing-only session, not after it is forgotten', () => {
    rememberSession(P, localStorage, t0);
    expect(offlineSessionPrincipal(localStorage, t0 + OFFLINE_SESSION_HOURS * 3_600_000 + 1)).toBeNull();
    markLocked(localStorage, t0 + 1000);
    expect(offlineSessionPrincipal(localStorage, t0 + 2000)).toBeNull();
    localStorage.clear(); rememberSession({ ...P, restriction: 'SUSPENDED_BILLING_ONLY' }, localStorage, t0);
    expect(offlineSessionPrincipal(localStorage, t0 + 1000)).toBeNull();
    rememberSession(P, localStorage, t0); forgetSession();
    expect(offlineSessionPrincipal(localStorage, t0 + 1000)).toBeNull();
  });
});

function Probe() { const a = useAuth(); return <div>{a.loading ? 'loading' : a.principal ? `in:${a.principal.userId}:${a.offline ? 'offline' : 'online'}` : 'signed-out'}<button onClick={() => a.logout()}>out</button></div>; }

describe('AuthProvider — opening offline', () => {
  it('online: /auth/me signs in and the session is remembered', async () => {
    me.mockResolvedValue(P);
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText(/in:u1:online/)).toBeInTheDocument();
    expect(offlineSessionPrincipal()).toMatchObject({ userId: 'u1' });
  });
  it('no connection + a remembered session → opens read-only offline', async () => {
    rememberSession(P); online = false; me.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('in:u1:offline')).toBeInTheDocument();
  });
  it('the server saying no (not a lost connection) never opens offline', async () => {
    rememberSession(P); me.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('signed-out')).toBeInTheDocument();
  });
  it('no connection but nothing remembered (or signed out before) → the sign-in screen', async () => {
    online = false; me.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('signed-out')).toBeInTheDocument();
  });
  it('back online: a valid session continues; a rejected one signs out and is forgotten', async () => {
    rememberSession(P); online = false; me.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const a = render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('in:u1:offline');
    online = true; me.mockResolvedValueOnce(P);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(await screen.findByText('in:u1:online')).toBeInTheDocument();
    a.unmount();
    rememberSession(P); online = false; me.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('in:u1:offline');
    online = true; me.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(await screen.findByText('signed-out')).toBeInTheDocument();
    expect(offlineSessionPrincipal()).toBeNull();
  });
  it('signing out forgets the session — the device will not reopen offline', async () => {
    me.mockResolvedValue(P);
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText(/in:u1:online/);
    await act(async () => { screen.getByText('out').click(); });
    await waitFor(() => expect(offlineSessionPrincipal()).toBeNull());
  });
  it("the offline copies are scoped BEFORE the screens' first fetch (child effects run before the provider's)", async () => {
    // 1) An earlier online visit saved the board under this user's scope.
    const first = await import('../api/offline-read-cache');
    first.setOfflineCacheScope('t1:b1:u1');
    (window as any).fetch = vi.fn(async () => new Response(JSON.stringify({ board: 'saved' }), { status: 200 }));
    let off = first.installOfflineReadCache(window as any);
    await fetch('/pos/booking/state'); await new Promise((r) => setTimeout(r, 0)); off();
    rememberSession(P);
    // 2) A FRESH page load with no connection: new module instances (empty in-memory scope), same device storage.
    vi.resetModules();
    const cache = await import('../api/offline-read-cache');
    const auth = await import('./AuthContext');
    const React = await import('react');
    online = false; me.mockRejectedValue(new TypeError('Failed to fetch'));
    (window as any).fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    off = cache.installOfflineReadCache(window as any);
    let got: any = null;
    function Screen() { React.useEffect(() => { fetch('/pos/booking/state').then((r) => r.json()).then((j) => { got = j; }).catch(() => { got = 'none'; }); }, []); return null; }
    function Gate() { const a = auth.useAuth(); return a.principal ? <Screen /> : null; }
    render(<auth.AuthProvider><Gate /></auth.AuthProvider>);
    await waitFor(() => expect(got).not.toBeNull());
    expect(got).toEqual({ board: 'saved' });
    off();
  });
});
