// tenant-status-realtime.vitest.spec — Constitution 9 §246: tenant_status_updated was declared, versioned and routed
// to dashboard/overview, and nothing emitted it. A tenant paused or reactivated by Super Admin left every open POS
// and Owner App showing the old state. §43 already ENDS a stream for a non-active tenant, so this matters most on
// REACTIVATION — the moment a salon is allowed back in and its devices are still connected.
import { describe, it, expect } from 'vitest';
import { SuperAdminTenantsService } from './super-admin-tenants.service';
import { InMemorySuperAdminTenantsRepo } from './super-admin-tenants.repository';
import { EVENTS } from '@aipowersalon/realtime-contracts';

function spy() {
  const pushes: Array<{ scope: any; event: string; payload: any }> = [];
  return { pushes, emitter: { toTenant: (scope: any, event: string, payload: any) => pushes.push({ scope, event, payload }), toTechnician: () => {}, toTicket: () => {}, toCustomerDisplay: () => {}, toOwner: () => {}, toCustomer: () => {}, toPlatform: () => {} } as never };
}
async function firstTenantId(svc: SuperAdminTenantsService): Promise<string> {
  const state = await svc.getState({ page: 1, pageSize: 50 });
  return state.tenants[0].id;
}

describe('§246 tenant_status_updated', () => {
  it('a status change emits the registry event scoped to THAT tenant, carrying the new status', async () => {
    const { pushes, emitter } = spy();
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo(), undefined, emitter);
    const id = await firstTenantId(svc);
    const r: any = await svc.changeStatus(id, 'paused', 'billing hold for review', { userId: 'sa-1' }, 'BILLING');
    expect(r.ok).toBe(true);
    const hit = pushes.find((p) => p.event === EVENTS.tenantStatusUpdated);
    expect(hit, `emitted: ${pushes.map((p) => p.event).join(', ') || 'nothing'}`).toBeTruthy();
    expect(hit!.scope.tenantId).toBe(id);                       // §13: scoped to the tenant whose status changed
    // The payload carries the PERSISTED status (`t.to`), not the requested target: 'paused' is a Super Admin verb
    // that stores as 'suspended'. Clients refetch on this event, so the stored truth is the right thing to send.
    expect(hit!.payload.status).toBe('suspended');
  });

  it('reactivation emits too — the case that matters, since a suspended tenant\'s streams are already gone (§43)', async () => {
    const { pushes, emitter } = spy();
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo(), undefined, emitter);
    const id = await firstTenantId(svc);
    await svc.changeStatus(id, 'paused', 'billing hold for review', { userId: 'sa-1' }, 'BILLING');
    pushes.length = 0;
    const r: any = await svc.changeStatus(id, 'active', 'billing resolved, reactivating', { userId: 'sa-1' });
    expect(r.ok).toBe(true);
    expect(pushes.find((p) => p.event === EVENTS.tenantStatusUpdated)?.payload.status).toBe('active');
  });

  it('a REJECTED change emits nothing — no event for something that did not happen', async () => {
    const { pushes, emitter } = spy();
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo(), undefined, emitter);
    const r: any = await svc.changeStatus('no-such-tenant', 'paused', 'x', { userId: 'sa-1' });
    expect(r.ok).toBe(false);
    expect(pushes).toEqual([]);
  });

  it('the gateway is optional: no emitter configured must not break a status change', async () => {
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());
    const id = await firstTenantId(svc);
    expect((await svc.changeStatus(id, 'paused', 'billing hold for review', { userId: 'sa-1' }, 'BILLING') as any).ok).toBe(true);
  });
});
