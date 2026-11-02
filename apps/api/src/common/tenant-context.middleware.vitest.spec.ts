import { describe, it, expect } from 'vitest';
import { TenantContextMiddleware } from './tenant-context.middleware';

// Locks in the scope-selector fix: SUPER_ADMIN (the only cross-tenant role) may carry a client `tenantId` so the
// Overview/Live-Operations scope selector works on the live HTTP path; every tenant-scoped role still has client
// tenant/branch keys stripped. A regression here silently breaks Super Admin scoping (caught only end-to-end).
function run(role: string) {
  const mw = new TenantContextMiddleware();
  const req: any = {
    session: { role, tenantId: role === 'SUPER_ADMIN' ? null : 't-self', branchId: null, userId: 'u1', permissions: [] },
    query: { range: 'month', tenantId: 't-target' },
    body: { name: 'x', tenantId: 't-target' },
  };
  let called = false;
  mw.use(req, {}, () => { called = true; });
  return { req, called };
}

describe('TenantContextMiddleware — client tenant-key strip is role-gated', () => {
  it('keeps tenantId in query/body for SUPER_ADMIN (scope selector)', () => {
    const { req, called } = run('SUPER_ADMIN');
    expect(called).toBe(true);
    expect(req.query.tenantId).toBe('t-target');
    expect(req.query.range).toBe('month');
    expect(req.body.tenantId).toBe('t-target');
  });

  it('strips tenantId from query/body for a tenant-scoped role (OWNER)', () => {
    const { req, called } = run('OWNER');
    expect(called).toBe(true);
    expect(req.query.tenantId).toBeUndefined();
    expect(req.query.range).toBe('month'); // non-tenant keys survive
    expect(req.body.tenantId).toBeUndefined();
    expect(req.body.name).toBe('x');
  });
});

describe('Security Deep Scan §36: the trusted context carries the realm and the session\'s device', () => {
  const runWith = async (role: string, sessions?: any) => {
    const mw = new TenantContextMiddleware(sessions);
    const req: any = { session: { role, tenantId: role === 'SUPER_ADMIN' ? null : 't1', branchId: null, userId: 'u1', permissions: [], sid: 's-1' }, query: {}, body: {} };
    await mw.use(req, {}, () => undefined);
    return req.ctx;
  };
  it('realm comes from the verified role', async () => {
    expect((await runWith('OWNER')).realm).toBe('EMPLOYEE');
    expect((await runWith('TECHNICIAN')).realm).toBe('EMPLOYEE');
    expect((await runWith('SUPER_ADMIN')).realm).toBe('PLATFORM');
    expect((await runWith('CUSTOMER')).realm).toBe('CUSTOMER');
  });
  it('deviceId is the session row\'s device (from the store), never a client value; null without one', async () => {
    const store = { durable: false, revocationStatus: async () => 'active', isRevoked: async () => false, deviceOf: (sid: string) => (sid === 's-1' ? 'dev-42' : null) };
    expect((await runWith('OWNER', store)).deviceId).toBe('dev-42');
    expect((await runWith('OWNER')).deviceId).toBeNull();
  });
});
