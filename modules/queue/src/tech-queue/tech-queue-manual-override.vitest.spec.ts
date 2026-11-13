// round 10 (Tech Queue 45) — Manual Override: moving a ticket off the technician the queue gave it to (a Fair Turn correction)
// needs the reassign permission and a reason, an unavailable technician additionally needs pos.booking.override_conflict, skills
// are never overridable, and the act is audited with the reason and whether an override was used.
import { describe, it, expect } from 'vitest';
import { InMemoryTechQueueRepository, type TechQueueContext } from './tech-queue.repository';
import { TechQueueService, ForbiddenError, ValidationError } from './tech-queue.service';

const PERMS = ['pos.booking.override_conflict', 'pos.tech_queue.view', 'pos.tech_queue.reassign', 'pos.serving.view', 'pos.technicians.view'];
const ctx = (over: Partial<TechQueueContext> = {}): TechQueueContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ForbiddenError ? 'FORBIDDEN' : e instanceof ValidationError ? 'VALIDATION: ' + (e as Error).message : (e as Error).message; } };

describe('Tech Queue manual override', () => {
  it('permission, reason, override permission, never skills; audited with the reason', async () => {
    const s = new TechQueueService(new InMemoryTechQueueRepository());
    expect(await code(s.reassign(ctx({ permissions: PERMS.filter((p) => p !== 'pos.tech_queue.reassign') }), 'tq_6003', { technicianId: 'tech_mia', reason: 'Balancing load' }))).toBe('FORBIDDEN');
    expect(await code(s.reassign(ctx(), 'tq_6003', { technicianId: 'tech_mia', reason: '  ' }))).toBe('VALIDATION: Reassignment requires a reason');
    expect(await code(s.reassign(ctx({ permissions: PERMS.filter((p) => p !== 'pos.booking.override_conflict') }), 'tq_6003', { technicianId: 'tech_ava', reason: 'x', managerOverride: true }))).toBe('FORBIDDEN');
    expect(await code(s.reassign(ctx(), 'tq_6002', { technicianId: 'tech_mia', reason: 'x', managerOverride: true }))).toBe('VALIDATION: Technician is not skilled for the requested services');
    const d = await s.reassign(ctx(), 'tq_6003', { technicianId: 'tech_mia', reason: 'Balancing load' });
    expect(d.assignedTechnicianName).toBe('Mia');
    const row = s.auditLog().find((l) => l.actionType === 'pos_tech_queue_technician_reassigned');
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).toContain('Balancing load');
  });
});
