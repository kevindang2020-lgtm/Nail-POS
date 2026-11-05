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
