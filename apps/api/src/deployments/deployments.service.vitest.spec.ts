import { describe, it, expect } from 'vitest';
import { DeploymentsService, ForbiddenError, ValidationError, NotFoundError } from './deployments.service';
import { InMemoryDeploymentsRepository } from './deployments.repository';
import type { DeploymentsContext } from './deployments.dto';

const owner: DeploymentsContext = { tenantId: 'luxe001', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
const viewer: DeploymentsContext = { tenantId: 'luxe001', branchId: '', userId: 'u2', role: 'MANAGER', permissions: ['settings.view'] };
const noPerm: DeploymentsContext = { tenantId: 'luxe001', branchId: '', userId: 'u3', role: 'FRONT_DESK', permissions: [] };
const otherTenant: DeploymentsContext = { ...owner, tenantId: 't_other' };
const svc = () => new DeploymentsService(new InMemoryDeploymentsRepository());

describe('DeploymentsService', () => {
  it('returns the seeded state with a real pending count', async () => {
    const s = svc();
    const st = await s.getState(owner);
    expect(st.deployments.length).toBe(5);
    // 3 apps with updates available + pending (iPad, Tech, Kiosk) + firmware available = 4 pending; AI Receptionist up_to_date
    expect(st.summary.pending).toBe(4);
    expect(st.summary.upToDate).toBe(1);
    expect(st.deployments.find((d) => d.component.startsWith('AI Receptionist'))?.updateAvailable).toBe(false);
  });

  it('advances through the real lifecycle and never fakes completion', async () => {
    const s = svc();
    const st = await s.getState(owner);
    const id = st.deployments.find((d) => d.component.startsWith('iPad'))!.id;
    expect((await s.advance(owner, id, 'schedule')).status).toBe('scheduled');
    expect((await s.advance(owner, id, 'start')).status).toBe('in_progress');
    // cannot start again (duplicate-command protection)
    await expect(s.advance(owner, id, 'start')).rejects.toBeInstanceOf(ValidationError);
    // completion is an explicit transition, only valid from in_progress
    expect((await s.advance(owner, id, 'complete')).status).toBe('completed');
    // an available deployment cannot be completed directly
    const id2 = (await s.getState(owner)).deployments.find((d) => d.component.startsWith('Tech'))!.id;
    await expect(s.advance(owner, id2, 'complete')).rejects.toBeInstanceOf(ValidationError);
  });

  it('enforces permissions and tenant isolation', async () => {
    const s = svc();
    await expect(s.getState(noPerm)).rejects.toBeInstanceOf(ForbiddenError);
    const st = await s.getState(viewer); // view ok
    await expect(s.advance(viewer, st.deployments[0].id, 'schedule')).rejects.toBeInstanceOf(ForbiddenError); // manage denied
    expect((await s.getState(otherTenant)).deployments.length).toBe(0); // isolation
  });

  it('rejects an unknown deployment and an empty component', async () => {
    const s = svc();
    await expect(s.advance(owner, 'nope', 'start')).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.create(owner, { component: '  ' })).rejects.toBeInstanceOf(ValidationError);
    const created = await s.create(owner, { component: 'New Firmware', componentKind: 'firmware', latestVersion: 'fw-9', targetCount: 3 });
    expect(created.updateAvailable).toBe(true);
  });

  it('emits device logs on advance through the injected sink', async () => {
    const writes: any[] = [];
    const sink = { write: async (_c: any, e: any) => { writes.push(e); } };
    const s = new DeploymentsService(new InMemoryDeploymentsRepository(), undefined, sink);
    const st = await s.getState(owner);
    const id = st.deployments.find((d) => d.component.startsWith('iPad'))!.id;
    await s.advance(owner, id, 'schedule');
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes[writes.length - 1].category).toBe('device');
    expect(writes[writes.length - 1].source).toBe('deployment');
  });
it('dispatches a deployment.completed webhook event on completion', async () => {
    const events: any[] = [];
    const sink = { dispatch: async (_c: any, type: string, data: any) => { events.push({ type, data }); } };
    const s = new DeploymentsService(new InMemoryDeploymentsRepository(), undefined, undefined, sink);
    const st = await s.getState(owner);
    const id = st.deployments.find((d) => d.status === 'available' || d.status === 'scheduled')!.id;
    await s.advance(owner, id, 'start');
    await s.advance(owner, id, 'complete');
    expect(events.some((e) => e.type === 'deployment.completed')).toBe(true);
  });
});
