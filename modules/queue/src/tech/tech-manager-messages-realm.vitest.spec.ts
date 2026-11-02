// tech-manager-messages-realm.vitest.spec.ts — Oct 12 2026 merge (other-chat workforce audit P0 #13):
//   GET /tech/manager-messages: a technician sees ONLY their own; a manager (technicians.edit, non-technician role)
//   sees the salon inbox; resolve is MANAGER/OWNER only — a technician cannot close their own request, even one handed
//   technicians.edit by a per-salon override.
import { describe, it, expect } from 'vitest';
import { TechService } from './tech.service';
import { permissionsFor } from '@aipowersalon/permissions';
import type { TechDataPort } from './tech.repository';

function port() {
  const calls: any[] = [];
  const p = {
    technicianAppEnabled: async () => true, resolveTechnicianId: async () => 'tech1', recordAudit: async () => {},
    dashboardRaw: async () => ({ technician: { fullName: 'Riley' } }),
    saveManagerMessage: async () => 'm1',
    getManagerMessages: async (_ctx: any, technicianId?: string) => { calls.push(['get', technicianId]); return []; },
    resolveManagerMessage: async (_ctx: any, id: string) => { calls.push(['resolve', id]); },
  } as unknown as TechDataPort;
  return { p, calls };
}
const tech = { tenantId: 'T', branchId: 'B', userId: 'U', role: 'TECHNICIAN' as any, permissions: permissionsFor('TECHNICIAN') as string[] };
const mgr = { tenantId: 'T', branchId: 'B', userId: 'M', role: 'MANAGER' as any, permissions: permissionsFor('MANAGER') as string[] };
const desk = { tenantId: 'T', branchId: 'B', userId: 'D', role: 'FRONT_DESK' as any, permissions: permissionsFor('FRONT_DESK') as string[] };

describe('manager messages', () => {
  it('a technician reads only their own messages', async () => {
    const { p, calls } = port();
    await new TechService(p).getManagerMessages(tech);
    expect(calls).toEqual([['get', 'tech1']]);
  });
  it('a manager reads the salon inbox', async () => {
    const { p, calls } = port();
    await new TechService(p).getManagerMessages(mgr);
    expect(calls).toEqual([['get', undefined]]);
  });
  it('the front desk reads the salon inbox too (it is not a technician) — and cannot resolve', async () => {
    // wave 4 UI sweep: the POS envelope polled this for the front desk and got 403 "No technician profile is linked"
    // on EVERY screen — the desk was treated as a technician because it lacks technicians.edit
    const { p, calls } = port();
    (p as any).resolveTechnicianId = async () => null;
    await new TechService(p).getManagerMessages(desk);
    expect(calls).toEqual([['get', undefined]]);
    await expect(new TechService(p).resolveManagerMessage(desk, 'm1')).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('resolve is refused for a technician — even one handed technicians.edit by an override — and works for a manager', async () => {
    const { p, calls } = port();
    await expect(new TechService(p).resolveManagerMessage(tech, 'm1')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(new TechService(p).resolveManagerMessage({ ...tech, permissions: [...tech.permissions, 'technicians.edit'] }, 'm1')).rejects.toMatchObject({ code: 'forbidden' });
    expect(calls).toEqual([]);
    expect(await new TechService(p).resolveManagerMessage(mgr, 'm1')).toEqual({ ok: true });
    expect(calls).toEqual([['resolve', 'm1']]);
  });
});
