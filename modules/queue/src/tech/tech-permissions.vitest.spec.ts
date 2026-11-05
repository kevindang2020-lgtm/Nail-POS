import { describe, it, expect } from 'vitest';
import { TechService } from './tech.service';
import { permissionsFor } from '@aipowersalon/permissions';
import type { TechDataPort, TechContext, TechTicketStatus } from './tech.repository';

// Verifies granular tech.* permission enforcement in TechService: the role grants the keys; a tech.*-aware session
// missing a key is blocked (403/forbidden); a legacy session with no tech.* keys is allowed (backward compatible).
function port(status: TechTicketStatus = 'assigned'): TechDataPort {
  let st = status;
  return {
    technicianAppEnabled: async () => true, listNotifications: async () => [], markNotificationsRead: async () => 0,
    resolveTechnicianId: async () => 'tech1',
    getTicket: async () => ({ ticketId: 'tk1', technicianId: 'tech1', status: st }),
    accept: async () => { st = 'accepted'; return true; },
    recordAudit: async () => {}, earningsTips: async () => 0, skills: async () => ({ specialties: [], services: [] }), workingHours: async () => [], requestableServices: async () => [], createSkillChangeRequest: async () => ({ id: 'r1', serviceId: 's1', serviceName: 'S', requestType: 'add' as const, note: null, status: 'pending' as const, createdAt: '', decidedAt: null }), listSkillChangeRequests: async () => [], listPendingSkillChangeRequests: async () => [], decideSkillChangeRequest: async () => ({ id: 'r1', serviceId: 's1', serviceName: 'S', requestType: 'add' as const, note: null, status: 'approved' as const, createdAt: '', decidedAt: '', technicianId: 't1', technicianName: 'T' }),
  } as unknown as TechDataPort;
}
const base = { tenantId: 'T', branchId: 'B', userId: 'U', role: 'TECHNICIAN' as any };

describe('tech granular permissions', () => {
  it('TECHNICIAN role grants the tech.* keys', () => {
    const perms = permissionsFor('TECHNICIAN') as string[];
    for (const k of ['tech.ticket.view', 'tech.ticket.accept', 'tech.service.start', 'tech.service.complete', 'tech.earnings.view', 'tech.break.start'])
      expect(perms).toContain(k);
  });

  it('full permission set → accept succeeds', async () => {
    const ctx: TechContext = { ...base, permissions: permissionsFor('TECHNICIAN') as string[] };
    const v = await new TechService(port('assigned')).accept(ctx, 'tk1');
    expect(v.status).toBe('accepted');
  });

  it('tech-aware session missing tech.ticket.accept → forbidden', async () => {
    const ctx: TechContext = { ...base, permissions: (permissionsFor('TECHNICIAN') as string[]).filter((p) => p !== 'tech.ticket.accept') };
    await expect(new TechService(port('assigned')).accept(ctx, 'tk1')).rejects.toMatchObject({ code: 'forbidden' });
  });

  // Re-pinned Oct 12 2026 (merge, workforce audit P0 #3): a legacy session with NO tech.* key no longer passes for free. Its
  // effective permissions are re-derived from the ROLE DEFAULTS — a TECHNICIAN role still accepts (the role grants it), but
  // a role that does not hold the key (CUSTOMER) is refused, and an unknown role has nothing.
  it('legacy session (no tech.* keys) → re-derived from role defaults, never fail-open', async () => {
    const tech: TechContext = { ...base, permissions: ['pos.login', 'dashboard.view'] };
    expect((await new TechService(port('assigned')).accept(tech, 'tk1')).status).toBe('accepted');
    const customer: TechContext = { ...base, role: 'CUSTOMER' as any, permissions: ['pos.login'] };
    await expect(new TechService(port('assigned')).accept(customer, 'tk1')).rejects.toMatchObject({ code: 'forbidden' });
    const noRole: TechContext = { ...base, role: undefined as any, permissions: [] };
    await expect(new TechService(port('assigned')).accept(noRole, 'tk1')).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('a technician_app_settings.app_enabled = false row blocks the technician (per-technician switch, P0 #3)', async () => {
    const off = { ...port('assigned'), technicianAppAccessEnabled: async () => false } as unknown as TechDataPort;
    await expect(new TechService(off).accept({ ...base, permissions: permissionsFor('TECHNICIAN') as string[] }, 'tk1'))
      .rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('turned off for your account') });
    const on = { ...port('assigned'), technicianAppAccessEnabled: async () => true } as unknown as TechDataPort;
    expect((await new TechService(on).accept({ ...base, permissions: permissionsFor('TECHNICIAN') as string[] }, 'tk1')).status).toBe('accepted');
  });
});

describe('§26 technician_app kill switch', () => {
  it('blocks every tech entry with the exact message when the platform flag is off', async () => {
    const off = { ...port('assigned'), technicianAppEnabled: async () => false } as unknown as TechDataPort;
    await expect(new TechService(off).accept({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'TECHNICIAN', permissions: [] } as any, 'tk1'))
      .rejects.toMatchObject({ message: 'The Technician App is not enabled for this salon.' });
  });
});
