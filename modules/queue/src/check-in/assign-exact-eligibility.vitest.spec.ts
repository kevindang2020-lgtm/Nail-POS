// assign-exact-eligibility.vitest.spec.ts — B-82 (Oct 23 2026): check-in "assign technician" and tech-queue "reassign"
// are WRITE paths and accepted a technician by service CATEGORY. With the workforce eligibility authority bound they ask
// it for the EXACT services (+ certification, branch, employment); the category stays only as the fallback without it.
import { describe, it, expect } from 'vitest';
import { TechnicianEligibilityError } from '@aipowersalon/workforce';
import { InMemoryCheckInRepository, type CheckInContext } from './check-in.repository';
import { CheckInService, ValidationError as CheckInValidation } from './check-in.service';
import { InMemoryTechQueueRepository, type TechQueueContext } from '../tech-queue/tech-queue.repository';
import { TechQueueService, ValidationError as TQValidation } from '../tech-queue/tech-queue.service';

const authority = (refuse: string[]) => ({ asked: [] as any[], async assert(i: any) { this.asked.push(i); if (refuse.includes(i.technicianId)) throw new TechnicianEligibilityError('TECHNICIAN_NOT_SKILLED', 'not approved', {}); return {} as any; } });
const ciCtx: CheckInContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.check_in.view', 'pos.check_in.assign_technician', 'pos.check_in.edit'] };
const tqCtx: TechQueueContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.tech_queue.view', 'pos.tech_queue.reassign'] };

describe('check-in assign technician — the exact service', () => {
  it('control: without the authority the category rule assigns Mia', async () => {
    expect((await new CheckInService(new InMemoryCheckInRepository()).assignTechnician(ciCtx, 'ci_6001', { technicianId: 'tech_mia' })).technicianName).toBe('Mia');
  });
  it('the authority says Mia is not approved for the service → refused, nothing assigned', async () => {
    const repo = new InMemoryCheckInRepository(); const svc = new CheckInService(repo);
    const el = authority(['tech_mia']); svc.eligibility = el;
    await expect(svc.assignTechnician(ciCtx, 'ci_6001', { technicianId: 'tech_mia' })).rejects.toBeInstanceOf(CheckInValidation);
    expect(el.asked[0]).toMatchObject({ tenantId: 'luxe001', branchId: 'br_cherryhill', technicianId: 'tech_mia', serviceIds: ['svc_mani'] });
    expect((await repo.detailRow(ciCtx, 'ci_6001'))?.technicianId ?? null).not.toBe('tech_mia');
  });
  it('approved → assigned', async () => {
    const svc = new CheckInService(new InMemoryCheckInRepository()); svc.eligibility = authority([]);
    expect((await svc.assignTechnician(ciCtx, 'ci_6001', { technicianId: 'tech_mia' })).technicianName).toBe('Mia');
  });
});

describe('tech-queue reassign — the exact service, never overridable', () => {
  it('control: without the authority the category rule reassigns to Mia', async () => {
    expect((await new TechQueueService(new InMemoryTechQueueRepository()).reassign(tqCtx, 'tq_6003', { technicianId: 'tech_mia', reason: 'Balancing load' })).assignedTechnicianName).toBe('Mia');
  });
  it('the authority says not approved → refused (a manager override does not bypass it)', async () => {
    const svc = new TechQueueService(new InMemoryTechQueueRepository());
    const el = authority(['tech_mia']); svc.eligibility = el;
    await expect(svc.reassign({ ...tqCtx, permissions: [...tqCtx.permissions, 'pos.booking.override_conflict'] }, 'tq_6003', { technicianId: 'tech_mia', reason: 'x', managerOverride: true } as any)).rejects.toThrow(/not skilled/);
    expect(el.asked[0]).toMatchObject({ technicianId: 'tech_mia', serviceIds: ['svc_mani'] });
  });
  it('approved → reassigned', async () => {
    const svc = new TechQueueService(new InMemoryTechQueueRepository()); svc.eligibility = authority([]);
    expect((await svc.reassign(tqCtx, 'tq_6003', { technicianId: 'tech_mia', reason: 'Balancing load' })).assignedTechnicianName).toBe('Mia');
  });
});
