// session-fail-closed.vitest.spec.ts — Security Deep Scan C10: session revocation and the authorization re-check used to
// fail OPEN everywhere — a DB error, an unknown session id, or a token with no sid at all were all simply trusted.
// Now, with a durable (database) session store:
//   • a token without a sid is refused (every minting path carries one — session-sid-coverage pins it);
//   • a sid the database does not know is refused;
//   • a lookup ERROR still fails open for ordinary routes (a DB blip must not take the app down) but CLOSED (503) for
//     Super Admin sessions and payment / refund routes; the authorization re-check likewise.
// Each "refused" case below passed on the old middleware.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signSession, type SessionRevocationStatus } from '@aipowersalon/identity';
import { TenantContextMiddleware, requiresLiveSessionProof } from './tenant-context.middleware';

const SECRET = 'c10-session-secret-value-32-chars-long';
const STAFF = { userId: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222', branchId: null, role: 'MANAGER', permissions: ['customers.view'], subscriptionStatus: 'active' };
const SA = { userId: '33333333-3333-4333-8333-333333333333', tenantId: null, branchId: null, role: 'SUPER_ADMIN', permissions: [], subscriptionStatus: 'active' };
const tok = (claims: any) => signSession(claims, { secret: SECRET });
const req = (token: string, url: string) => ({ headers: { authorization: `Bearer ${token}` }, originalUrl: url, url, method: 'GET', body: {}, query: {} });
const durable = (status: SessionRevocationStatus | 'throw'): any => ({
  durable: true,
  async create() { return 's'; }, async revoke() { /* n/a */ },
  async isRevoked() { return status === 'revoked'; },
  async revocationStatus() { if (status === 'throw') throw new Error('unexpected'); return status; },
});
const run = async (mw: TenantContextMiddleware, r: any) => { let passed = false; await mw.use(r, { setHeader() { /* n/a */ } }, () => { passed = true; }); return passed; };

let prev: string | undefined;
beforeEach(() => { prev = process.env.AUTH_SESSION_SECRET; process.env.AUTH_SESSION_SECRET = SECRET; });
afterEach(() => { if (prev === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = prev; });

describe('C10 — which requests must prove their session live', () => {
  it.each([
    ['SUPER_ADMIN', '/auth/me', true], ['MANAGER', '/super-admin/tenants', true], ['MANAGER', '/pos/checkout/payments/p1/refund', true],
    ['MANAGER', '/mobile-checkout/payments/p1/void', true], ['OWNER', '/api/v1/pos/payments', true], ['MANAGER', '/pos/customers', false],
    ['MANAGER', '/owner/staff/performance', false], ['TECHNICIAN', '/tech/schedule?x=checkout', false],
  ])('%s %s → %s', (role, url, strict) => expect(requiresLiveSessionProof(role, url)).toBe(strict));
});

describe('C10 — a durable session store fails closed where it must', () => {
  it('a token WITHOUT a sid is refused (old: accepted as a "legacy" token, unrevocable)', async () => {
    await expect(run(new TenantContextMiddleware(durable('active')), req(tok(STAFF), '/pos/customers'))).rejects.toMatchObject({ status: 401 });
  });
  it('a sid the database does not know is refused (old: treated as not revoked)', async () => {
    await expect(run(new TenantContextMiddleware(durable('unknown')), req(tok({ ...STAFF, sid: 'gone' }), '/pos/customers'))).rejects.toMatchObject({ status: 401 });
  });
  it('a revoked session is refused, as before', async () => {
    await expect(run(new TenantContextMiddleware(durable('revoked')), req(tok({ ...STAFF, sid: 's1' }), '/pos/customers'))).rejects.toThrow(/revoked/i);
  });
  it('a live session passes', async () => {
    expect(await run(new TenantContextMiddleware(durable('active')), req(tok({ ...STAFF, sid: 's1' }), '/pos/customers'))).toBe(true);
  });
  it('a lookup ERROR on an ordinary staff route still passes (documented fail-open kept: a DB blip must not take the app down)', async () => {
    expect(await run(new TenantContextMiddleware(durable('error')), req(tok({ ...STAFF, sid: 's1' }), '/pos/customers'))).toBe(true);
  });
  it('a lookup ERROR for a Super Admin session is 503 (old: served)', async () => {
    await expect(run(new TenantContextMiddleware(durable('error')), req(tok({ ...SA, sid: 's1' }), '/super-admin/tenants'))).rejects.toMatchObject({ status: 503 });
  });
  it('a lookup ERROR on a refund route is 503 (old: served)', async () => {
    await expect(run(new TenantContextMiddleware(durable('error')), req(tok({ ...STAFF, sid: 's1' }), '/pos/checkout/payments/p1/refund'))).rejects.toMatchObject({ status: 503 });
  });
  it('the authorization re-check failing is 503 for a payment route, and still fails open for an ordinary one', async () => {
    const authz: any = { async get() { throw new Error('db down'); }, async revokeUserSessions() { return 0; } };
    const mw = new TenantContextMiddleware(durable('active'), undefined, undefined, undefined, undefined, authz);
    await expect(run(mw, req(tok({ ...STAFF, sid: 's1' }), '/pos/payments'))).rejects.toMatchObject({ status: 503 });
    expect(await run(mw, req(tok({ ...STAFF, sid: 's1' }), '/pos/customers'))).toBe(true);
  });
  it('a NON-durable store (no database: dev / tests) keeps the old behaviour for sid-less and unknown tokens', async () => {
    const mem: any = { durable: false, async create() { return 's'; }, async revoke() { /* n/a */ }, async isRevoked() { return false; }, async revocationStatus() { return 'unknown'; } };
    expect(await run(new TenantContextMiddleware(mem), req(tok(STAFF), '/pos/customers'))).toBe(true);
    expect(await run(new TenantContextMiddleware(mem), req(tok({ ...STAFF, sid: 'x' }), '/pos/customers'))).toBe(true);
  });
});
