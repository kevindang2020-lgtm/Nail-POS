// owner-branch-filter.vitest.spec.ts — Oct 12 2026 merge (other-chat workforce audit #95: "owner branch filter stripped
// by middleware — does nothing"). The Owner App's branch FILTER (?branchId / body.branchId on /owner/*) survives the
// tenant-key strip on /owner/* ONLY: every owner service method validates it (ensureBranch / resolveBranch — same tenant,
// inside the owner's allowed set, restricted roles pinned to their branch, denials audited). Everywhere else branchId is
// still stripped, and tenantId is never re-attached anywhere.
import { describe, it, expect } from 'vitest';
import { TenantContextMiddleware, isOwnerPath, branchFilterFrom } from './tenant-context.middleware';

const owner = { userId: 'u1', tenantId: 't1', branchId: 'b-session', role: 'OWNER', permissions: [] };
async function run(url: string, query: any, body?: any) {
  const mw = new TenantContextMiddleware(undefined);
  const req: any = { session: owner, headers: {}, originalUrl: url, query, body, method: 'GET' };
  await mw.use(req, {}, () => undefined);
  return req;
}

describe('owner branch filter', () => {
  it('re-attaches ?branchId on /owner/* after the strip; tenantId is never re-attached', async () => {
    const r = await run('/owner/staff/performance?branchId=b2', { branchId: 'b2', tenantId: 'evil', period: 'month' });
    expect(r.query).toEqual({ period: 'month', branchId: 'b2' });
    expect(r.ctx.tenantId).toBe('t1');
    expect(r.ctx.branchId).toBe('b-session');   // the SESSION branch is untouched — the filter is a view parameter, not scope
  });
  it('works under the /api/v1 alias too', async () => {
    const r = await run('/api/v1/owner/dashboard/state?branchId=b2', { branchId: 'b2' });
    expect(r.query.branchId).toBe('b2');
  });
  it('still strips branchId on every non-owner route', async () => {
    const r = await run('/pos/booking/state?branchId=b2', { branchId: 'b2' });
    expect(r.query.branchId).toBeUndefined();
    const t = await run('/tenant/overview?branchId=b2', { branchId: 'b2' });
    expect(t.query.branchId).toBeUndefined();
  });
  it('ignores non-id shapes and arrays; segment-boundary path match', () => {
    expect(branchFilterFrom({ branchId: ['b1', 'b2'] })).toBeUndefined();
    expect(branchFilterFrom({ branchId: "x' or 1=1" })).toBeUndefined();
    expect(branchFilterFrom({ branchId: 'b7600000-0000-4000-8000-0000000000b1' })).toBe('b7600000-0000-4000-8000-0000000000b1');
    expect(isOwnerPath('/owners-club/x')).toBe(false);
    expect(isOwnerPath('/owner')).toBe(true);
    expect(isOwnerPath('/api/v1/owner/x')).toBe(true);
  });
  it('body branchId (expenses, context select) survives on /owner/* too; tenant keys still stripped', async () => {
    const r = await run('/owner/context/select', {}, { mode: 'single', branchId: 'b3', tenant_id: 'evil', tenantId: 'evil' });
    expect(r.body).toEqual({ mode: 'single', branchId: 'b3' });
  });
  it('a Super Admin request is untouched (its own guard confines it)', async () => {
    const mw = new TenantContextMiddleware(undefined);
    const req: any = { session: { userId: 'sa', tenantId: null, branchId: null, role: 'SUPER_ADMIN', permissions: [] }, headers: {}, originalUrl: '/super-admin/overview?tenantId=t9', query: { tenantId: 't9' }, body: {}, method: 'GET' };
    await mw.use(req, {}, () => undefined);
    expect(req.query.tenantId).toBe('t9');
  });
});
