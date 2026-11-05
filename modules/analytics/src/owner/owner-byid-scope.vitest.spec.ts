import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerAppointmentDetail } from './owner.dto';

// Single-resource "by id" reads must enforce branch scope, not just tenant scope — matching their list endpoints. A
// restricted manager must not pull a foreign-branch appointment's customer PII or a foreign-branch technician's data by
// id. The fake repo simulates the repo's bScope existence check (driven by __allowedBranchIds) so the service↔repo
// authorization contract is exercised without live Postgres.
const ctx = (perms: string[], role = 'MANAGER'): OwnerContext => ({ tenantId: 't1', userId: 'u1', role, permissions: perms } as any);

class ByIdRepo extends InMemoryOwnerRepository {
  seenAllowed: string[] | null | undefined = undefined;
  constructor(private allowed: string[] | null, private resourceBranch: string) { super(); }
  async allowedBranchIds() { return this.allowed; }
  async userHomeBranch() { return this.allowed ? this.allowed[0] : null; }
  private inScope(c: OwnerContext): boolean {
    const allowed = (c as unknown as { __allowedBranchIds?: string[] | null }).__allowedBranchIds;
    this.seenAllowed = allowed;
    return !(allowed && allowed.length && !allowed.includes(this.resourceBranch));
  }
  async getAppointmentDetail(c: OwnerContext, id: string): Promise<OwnerAppointmentDetail | null> {
    if (!this.inScope(c)) return null;
    return { appointmentId: id, customerName: 'Jane', branchId: this.resourceBranch, technicianId: 't9', apptDate: '2026-06-27', startTime: '10:00', endTime: '11:00', status: 'booked', source: 'app', customerPhone: '555', durationMinutes: 60, depositStatus: 'none', isVip: false, notes: null, services: [] } as any;
  }
  async validateTechnician(c: OwnerContext) { return this.inScope(c); }
}

describe('Owner by-id reads — branch authorization', () => {
  it('blocks a restricted manager from a foreign-branch appointment', async () => {
    const svc = new OwnerService(new ByIdRepo(['b1'], 'b2'));
    await expect(svc.getAppointment(ctx(['owner.bookings.details']), 'ap1')).rejects.toThrow(/not found/i);
  });

  it('returns an appointment within the manager’s branch', async () => {
    const svc = new OwnerService(new ByIdRepo(['b1'], 'b1'));
    const d = await svc.getAppointment(ctx(['owner.bookings.details']), 'ap1');
    expect(d.appointmentId).toBe('ap1');
    expect(d.customerName).toBe('Jane');
  });

  it('lets a full owner read any branch’s appointment', async () => {
    const svc = new OwnerService(new ByIdRepo(null, 'b9'));
    const d = await svc.getAppointment(ctx(['owner.bookings.details'], 'OWNER'), 'ap1');
    expect(d.branchId).toBe('b9');
  });

  it('blocks a restricted manager from a foreign-branch technician (performance)', async () => {
    const svc = new OwnerService(new ByIdRepo(['b1'], 'b2'));
    await expect(svc.getTechnicianDetail(ctx(['owner.staff.performance.view']), 't9', 'month')).rejects.toThrow(/not found/i);
  });

  it('blocks a restricted manager from a foreign-branch technician (earnings)', async () => {
    const svc = new OwnerService(new ByIdRepo(['b1'], 'b2'));
    await expect(svc.getTechnicianEarnings(ctx(['owner.staff.earnings.view']), 't9', 'month')).rejects.toThrow(/not found/i);
  });

  it('resolves the allowed set before the by-id fetch runs', async () => {
    const repo = new ByIdRepo(['b1'], 'b2');
    await expect(new OwnerService(repo).getAppointment(ctx(['owner.bookings.details']), 'ap1')).rejects.toThrow();
    expect(repo.seenAllowed).toEqual(['b1']);
  });
});
