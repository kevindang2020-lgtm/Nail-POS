import { describe, it, expect } from 'vitest';
import { ServingService, ConflictError } from './serving.service';
import { InMemoryServingRepository, ServingContext } from './serving.repository';

// Owner context with the serving edit/assign permissions. The in-memory repo seeds sv_4001 (in_service) with
// l1 = Signature Manicure 5500 and l2 = Gel Add-on 1500, primary tech Mia.
const ctx = (over: Partial<ServingContext> = {}): ServingContext =>
  ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER',
    permissions: ['pos.serving.view', 'pos.serving.edit_services', 'pos.serving.assign_technician', 'pos.serving.assign_helper'], ...over });

describe('In-service revision timeline + optimistic concurrency (epic Req §5/§9)', () => {
  it('records a before→after revision and bumps the ticket version on a price edit', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    await svc.editService(ctx(), 'sv_4001', 'l1', { priceOverrideCents: 6000 });
    const { currentVersion, revisions } = await svc.getRevisions(ctx(), 'sv_4001');
    expect(currentVersion).toBe(1);
    expect(revisions.length).toBe(1);
    expect(revisions[0].action).toBe('service_updated');
    expect((revisions[0].before as any).priceCents).toBe(5500);
    expect((revisions[0].after as any).priceCents).toBe(6000);
    expect(revisions[0].version).toBe(1);
    expect(revisions[0].actorRole).toBe('OWNER');
    expect(revisions[0].summary).toContain('5500→6000');
  });

  it('records distinct entries for remove + reassign and increments the version each time', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    await svc.removeService(ctx(), 'sv_4001', { serviceLineId: 'l2' });   // remove Gel Add-on
    await svc.assignTechnician(ctx(), 'sv_4001', { technicianId: 'tech_ava' });             // reassign primary tech Mia → Ava
    const { currentVersion, revisions } = await svc.getRevisions(ctx(), 'sv_4001');
    expect(currentVersion).toBe(2);
    expect(revisions.map((r) => r.action)).toEqual(['service_removed', 'technician_assigned']);
    expect((revisions[0].before as any).serviceName).toBe('Gel Add-on');
    expect((revisions[1].before as any).technicianName).toBe('Mia');
    expect((revisions[1].after as any).technicianName).toBe('Ava');
  });

  it('rejects a stale edit when expectedVersion no longer matches (lost-update guard)', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    await svc.editService(ctx(), 'sv_4001', 'l1', { priceOverrideCents: 6000 });             // → v1
    await expect(svc.editService(ctx(), 'sv_4001', 'l1', { priceOverrideCents: 7000, expectedVersion: 0 } as any)).rejects.toThrow(ConflictError);
    await svc.editService(ctx(), 'sv_4001', 'l1', { priceOverrideCents: 7000, expectedVersion: 1 } as any);  // correct version passes
    expect((await svc.getRevisions(ctx(), 'sv_4001')).currentVersion).toBe(2);               // only the two applied edits bumped it
  });
});
