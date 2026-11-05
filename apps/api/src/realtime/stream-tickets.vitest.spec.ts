// stream-tickets.vitest.spec — BUILD_PLAN Phase 13 (Constitution 6 §28–32, bug 1): the native realtime stream ticket.
// Single use, 60-second expiry, bound to realm / device / session; a revoked session's ticket opens nothing; the ticket
// path is realm 'any'; with a cookie or bearer present the ticket is ignored (the browser path is unchanged).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamTicketService, InMemoryStreamTicketStore, StreamTicketMiddleware, hashTicket, STREAM_TICKET_TTL_SECONDS } from './stream-tickets';
import { TenantContextMiddleware } from '../common/tenant-context.middleware';
import { realmForPath } from '@aipowersalon/identity';

const T = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-10-09T12:00:00Z');
const exp = Math.floor(now.getTime() / 1000) + 900;
const techClaims = { userId: U, tenantId: T, branchId: B, role: 'TECHNICIAN', permissions: ['tech.dashboard.view'], subscriptionStatus: 'active', sid: 'sess-1', iat: exp - 900, exp };
const custClaims = { ...techClaims, role: 'CUSTOMER', branchId: null, sid: 'sess-2' };
const DEV = 'abcdef0123456789abcdef0123456789';

let store: InMemoryStreamTicketStore; let svc: StreamTicketService;
beforeEach(() => { store = new InMemoryStreamTicketStore(); svc = StreamTicketService.withStore(store); });

describe('issue', () => {
  it('returns a random ticket + expiresIn 60; stores only its hash, bound to session / realm / tenant / branch / device', async () => {
    const r = await svc.issue({ claims: techClaims, sessionId: 'sess-1', deviceId: DEV, now });
    expect(r.expiresIn).toBe(60); expect(STREAM_TICKET_TTL_SECONDS).toBe(60);
    expect(r.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.rows.has(r.ticket)).toBe(false);
    const row = store.rows.get(hashTicket(r.ticket))!;
    expect(row).toMatchObject({ sessionId: 'sess-1', realm: 'tenant', userId: U, tenantId: T, branchId: B, deviceId: DEV });
    expect(row.expiresAt.getTime() - now.getTime()).toBe(60_000);
    const r2 = await svc.issue({ claims: techClaims, sessionId: 'sess-1', now });
    expect(r2.ticket).not.toBe(r.ticket);
  });
  it('refuses an integration principal, a session without an id, and no session', async () => {
    await expect(svc.issue({ claims: techClaims, sessionId: 'sess-1', actorType: 'INTEGRATION', now })).rejects.toMatchObject({ status: 401 });
    await expect(svc.issue({ claims: techClaims, sessionId: null, now })).rejects.toMatchObject({ status: 401 });
    await expect(svc.issue({ claims: null, sessionId: 'x', now })).rejects.toMatchObject({ status: 401 });
  });
  it('a malformed device id is not bound (and not stored)', async () => {
    const r = await svc.issue({ claims: techClaims, sessionId: 'sess-1', deviceId: 'bad id with spaces', now });
    expect(store.rows.get(hashTicket(r.ticket))!.deviceId).toBeNull();
  });
});

describe('redeem', () => {
  it('opens its own realm stream ONCE — the reused ticket is refused', async () => {
    const { ticket } = await svc.issue({ claims: techClaims, sessionId: 'sess-1', deviceId: DEV, now });
    const c = await svc.redeem({ ticket, path: '/tech/stream', deviceId: DEV, now });
    expect(c).toMatchObject({ userId: U, tenantId: T, branchId: B, role: 'TECHNICIAN', sid: 'sess-1' });
    await expect(svc.redeem({ ticket, path: '/tech/stream', deviceId: DEV, now })).rejects.toMatchObject({ status: 401 });
  });
  it('expires after 60 s', async () => {
    const { ticket } = await svc.issue({ claims: techClaims, sessionId: 'sess-1', now });
    await expect(svc.redeem({ ticket, path: '/tech/stream', now: new Date(now.getTime() + 60_000) })).rejects.toMatchObject({ status: 401 });
    const t2 = (await svc.issue({ claims: techClaims, sessionId: 'sess-1', now })).ticket;
    await expect(svc.redeem({ ticket: t2, path: '/tech/stream', now: new Date(now.getTime() + 59_000) })).resolves.toBeTruthy();
  });
  it('a tenant ticket cannot open the customer stream, nor a customer ticket a staff stream', async () => {
    const t1 = (await svc.issue({ claims: techClaims, sessionId: 'sess-1', now })).ticket;
    await expect(svc.redeem({ ticket: t1, path: '/customer/stream', now })).rejects.toMatchObject({ response: expect.objectContaining({ reason: 'wrong_realm' }) });
    const t2 = (await svc.issue({ claims: custClaims, sessionId: 'sess-2', now })).ticket;
    await expect(svc.redeem({ ticket: t2, path: '/owner/stream', now })).rejects.toMatchObject({ response: expect.objectContaining({ reason: 'wrong_realm' }) });
    const t3 = (await svc.issue({ claims: custClaims, sessionId: 'sess-2', now })).ticket;
    await expect(svc.redeem({ ticket: t3, path: '/customer/stream', now })).resolves.toMatchObject({ role: 'CUSTOMER' });
  });
  it('a ticket bound to a device opens only from that device', async () => {
    const { ticket } = await svc.issue({ claims: techClaims, sessionId: 'sess-1', deviceId: DEV, now });
    await expect(svc.redeem({ ticket, path: '/tech/stream', deviceId: 'ffffffffffffffffffffffffffffffff', now })).rejects.toMatchObject({ response: expect.objectContaining({ reason: 'wrong_device' }) });
  });
  it('a session that expired before redemption is refused', async () => {
    const { ticket } = await svc.issue({ claims: { ...techClaims, exp: Math.floor(now.getTime() / 1000) + 10 }, sessionId: 'sess-1', now });
    await expect(svc.redeem({ ticket, path: '/tech/stream', now: new Date(now.getTime() + 20_000) })).rejects.toMatchObject({ response: expect.objectContaining({ reason: 'session_expired' }) });
  });
  it('the ticket path is realm "any" (a customer and a staff token are both read there); stream paths keep their realm', () => {
    expect(realmForPath('/realtime/stream-ticket')).toBe('any');
    expect(realmForPath('/api/v1/realtime/stream-ticket')).toBe('any');
    expect(realmForPath('/realtime/stream')).toBe('tenant');
    expect(realmForPath('/customer/stream')).toBe('customer');
  });
});

describe('StreamTicketMiddleware → TenantContextMiddleware (the request is authenticated as the session)', () => {
  const live = () => ({ ...techClaims, exp: Math.floor(Date.now() / 1000) + 900 });
  const run = async (req: any, sessions?: any) => {
    const mw = new StreamTicketMiddleware(svc);
    const next = vi.fn();
    await mw.use(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    const tc = new TenantContextMiddleware(sessions);
    const done = vi.fn();
    await tc.use(req, { setHeader: () => undefined }, done);
    return { done };
  };
  const reqFor = (url: string, extra: Record<string, unknown> = {}) => ({ method: 'GET', originalUrl: url, url, headers: {}, query: Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? '')), ...extra });

  it('no cookie, no bearer, ?ticket= → req.ctx is the ticket session; the ticket is stripped from the query', async () => {
    const { ticket } = await svc.issue({ claims: live(), sessionId: 'sess-1', deviceId: DEV, now: new Date() });
    const req: any = reqFor(`/api/v1/tech/stream?ticket=${ticket}&device=${DEV}`);
    const { done } = await run(req, { isRevoked: async () => false, lockedAt: async () => null });
    expect(done).toHaveBeenCalled();
    expect(req.ctx).toMatchObject({ userId: U, tenantId: T, branchId: B, role: 'TECHNICIAN' });
    expect(req.sessionId).toBe('sess-1');
    expect(req.query.ticket).toBeUndefined();
    expect(req.headers['x-device-id']).toBe(DEV);
  });
  it('a REVOKED session: its ticket redeems but the session middleware refuses the request (401)', async () => {
    const { ticket } = await svc.issue({ claims: live(), sessionId: 'sess-1', now: new Date() });
    const req: any = reqFor(`/tech/stream?ticket=${ticket}`);
    await new StreamTicketMiddleware(svc).use(req, {}, () => undefined);
    await expect(new TenantContextMiddleware({ isRevoked: async () => true } as any).use(req, {}, () => undefined)).rejects.toMatchObject({ status: 401 });
  });
  it('a bad ticket is a 401 before anything opens', async () => {
    await expect(new StreamTicketMiddleware(svc).use(reqFor('/tech/stream?ticket=' + 'x'.repeat(43)), {}, () => undefined)).rejects.toMatchObject({ status: 401 });
  });
  it('with a cookie or a bearer present the ticket is ignored (browser path unchanged) — and NOT consumed', async () => {
    const { ticket } = await svc.issue({ claims: live(), sessionId: 'sess-1', now: new Date() });
    const next = vi.fn();
    const req: any = reqFor(`/tech/stream?ticket=${ticket}`, { headers: { cookie: 'aps_session=abc' } });
    await new StreamTicketMiddleware(svc).use(req, {}, next);
    expect(next).toHaveBeenCalled(); expect(req.session).toBeUndefined();
    const req2: any = reqFor(`/tech/stream?ticket=${ticket}`, { headers: { authorization: 'Bearer x' } });
    await new StreamTicketMiddleware(svc).use(req2, {}, () => undefined);
    expect(req2.session).toBeUndefined();
    await expect(svc.redeem({ ticket, path: '/tech/stream' })).resolves.toBeTruthy();   // still unused
  });
  it('only the four stream endpoints accept a ticket', async () => {
    const { ticket } = await svc.issue({ claims: live(), sessionId: 'sess-1', now: new Date() });
    const req: any = reqFor(`/tech/queue?ticket=${ticket}`);
    await new StreamTicketMiddleware(svc).use(req, {}, () => undefined);
    expect(req.session).toBeUndefined();
    const post: any = { ...reqFor(`/tech/stream?ticket=${ticket}`), method: 'POST' };
    await new StreamTicketMiddleware(svc).use(post, {}, () => undefined);
    expect(post.session).toBeUndefined();
  });
});

// Found by the Phase 13 live proof: 'SessionStore' lives in AuthModule, which RealtimeModule does not import, so the
// stream factory's injected store was undefined in the running API and a signed-out session's stream never ended.
describe('stream factory: a revoked session ends the open stream even when SessionStore is only in another module', () => {
  it('resolves SessionStore from the container (ModuleRef, strict: false) and completes the stream on revocation', async () => {
    vi.useFakeTimers();
    try {
      const { RealtimeStreamFactory } = await import('./realtime-stream');
      const { InProcessEmitter } = await import('./realtime.gateway');
      const revoked = new Set<string>();
      const moduleRef: any = { get: (tok: string, o: any) => (tok === 'SessionStore' && o?.strict === false ? { isRevoked: async (id: string) => revoked.has(id) } : undefined) };
      const f = new RealtimeStreamFactory(new InProcessEmitter() as any, undefined, null, undefined, moduleRef);
      const req: any = { headers: {}, sessionId: 'sess-x', ctx: { userId: U, tenantId: T, branchId: B } };
      let completed = false;
      const sub = f.open(req, () => []).subscribe({ complete: () => { completed = true; } });
      await vi.advanceTimersByTimeAsync(16_000);
      expect(completed).toBe(false);
      revoked.add('sess-x');
      await vi.advanceTimersByTimeAsync(16_000);
      expect(completed).toBe(true);
      sub.unsubscribe();
    } finally { vi.useRealTimers(); }
  });
});
