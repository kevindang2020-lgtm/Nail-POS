import { describe, it, expect } from 'vitest';
import { SuperAdminTenantsService } from './super-admin-tenants.service';
import { InMemorySuperAdminTenantsRepo } from './super-admin-tenants.repository';

async function activeIds(svc: SuperAdminTenantsService): Promise<string[]> {
  const state = await svc.getState({ page: 1, pageSize: 50 });
  return state.tenants.filter((r) => r.status === 'healthy').map((r) => r.id);
}

describe('SuperAdminTenantsService.bulkChangeStatus (§27)', () => {
  it('rejects an empty selection', async () => {
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());
    const r = await svc.bulkChangeStatus([], 'paused', 'cleanup');
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toMatch(/at least one/i);
  });

  it('requires a reason for a dangerous target (pause) and applies nothing without one', async () => {
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());
    const ids = await activeIds(svc);
    expect(ids.length).toBeGreaterThan(0);
    const r = await svc.bulkChangeStatus(ids, 'paused', '   ');
    expect(r.ok).toBe(false);
    expect(r.succeeded).toBe(0);
    expect(r.errors?.[0]).toMatch(/reason is required/i);
    // nothing changed
    const after = await activeIds(svc);
    expect(after.length).toBe(ids.length);
  });

  it('pauses the selected active tenants with a reason and reports per-tenant results', async () => {
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());
    const ids = await activeIds(svc);
    const r = await svc.bulkChangeStatus(ids, 'paused', 'billing review pending', { userId: 'admin1' }, 'BILLING');
    expect(r.ok).toBe(true);
    expect(r.total).toBe(ids.length);
    expect(r.succeeded).toBe(ids.length);
    expect(r.results.every((x) => x.ok)).toBe(true);
  });

  it('is idempotent in effect: re-pausing already-paused tenants fails per tenant, not the batch', async () => {
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());
    const ids = await activeIds(svc);
    await svc.bulkChangeStatus(ids, 'paused', 'first pass of review', {}, 'BILLING');
    const again = await svc.bulkChangeStatus(ids, 'paused', 'second pass of review', {}, 'BILLING');
    expect(again.succeeded).toBe(0);                 // already paused — no duplicate change
    expect(again.failed).toBe(ids.length);
    expect(again.results.every((x) => !x.ok && !!x.error)).toBe(true);
  });

  it('dedupes repeated ids in the request', async () => {
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());
    const ids = await activeIds(svc);
    const dup = [ids[0], ids[0], ids[0]];
    const r = await svc.bulkChangeStatus(dup, 'paused', 'dedupe check run', { userId: 'a' }, 'PLATFORM_OPERATION');
    expect(r.total).toBe(1);
  });

  it('writes an audit row per changed tenant (reuses the single-tenant audited path)', async () => {
    const repo = new InMemorySuperAdminTenantsRepo();
    const svc = new SuperAdminTenantsService(repo);
    const ids = (await activeIds(svc)).slice(0, 2);
    await svc.bulkChangeStatus(ids, 'paused', 'audit check run', { userId: 'admin1' }, 'PLATFORM_OPERATION');
    for (const id of ids) {
      const audit = await repo.getAudit(id);
      expect(audit.length).toBeGreaterThan(0);
    }
  });
  it('Constitution 7 §18: a bulk suspension without a reason CODE changes nothing and says why for each tenant', async () => {
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());
    const ids = await activeIds(svc);
    const r = await svc.bulkChangeStatus(ids, 'paused', 'billing review pending', { userId: 'admin1' });
    expect(r.succeeded).toBe(0);
    expect(r.results.every((x: any) => /suspension reason/.test(x.error))).toBe(true);
  });
});
