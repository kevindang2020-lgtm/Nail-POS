import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerTicketDetail } from './owner.dto';

// Owner Ticket Oversight is read-only and ALWAYS tenant-scoped (server-derived). For an owner with a restricted branch
// subset, a passed branchId must be inside that subset, and ticket history for a ticket outside the owner's branches
// reads as not_found (the repo applies the branch scope).
const base: OwnerContext = { tenantId: 't1', userId: 'u_owner', role: 'OWNER', permissions: ['owner.dashboard.view'] } as any;
const fresh = () => ({ ...base });

const detail: OwnerTicketDetail = {
  ticketId: 'tk1', ticketNumber: '#3041', branchId: 'b1', status: 'paid', customerName: 'Grace Kim', technicianName: 'Mia',
  totalCents: 8000, version: 3, serviceDoneLocked: true, createdAt: '2026-06-01T00:00:00.000Z', paidAt: '2026-06-01T01:05:00.000Z', removedAt: null,
  subtotalCents: 7000, taxCents: 0, discountCents: 0, tipCents: 1000, servingStartedAt: null, serviceDoneAt: '2026-06-01T01:00:00.000Z',
};

class FakeRepo extends InMemoryOwnerRepository {
  constructor(private allowed: string[] | null, private ticket: OwnerTicketDetail | null) { super(); }
  async allowedBranchIds() { return this.allowed; }
  async ownerTicketsList(_ctx: OwnerContext, f: any) { return { tickets: this.ticket ? [this.ticket] : [], total: this.ticket ? 1 : 0, page: f.page, pageSize: f.pageSize }; }
  async ownerTicket() { return this.ticket; }
  async ownerTicketLines() { return [{ serviceName: 'Gel X', priceCents: 6000, lineTotalCents: 6000, technicianName: 'Mia', status: 'completed', isAddOn: false }]; }
  async ownerTicketRevisions() { return [{ version: 1, action: 'service_added', actorRole: 'TECH', summary: 'Added Gel X', createdAt: '2026-06-01T00:30:00.000Z' }]; }
}

describe('Owner Ticket Oversight — read-only, branch-scoped', () => {
  it('blocks a branch the restricted owner cannot access', async () => {
    const svc = new OwnerService(new FakeRepo(['b1'], null));
    await expect(svc.listTickets(fresh() as any, { branchId: 'b2' })).rejects.toThrow(/access to that branch/i);
  });

  it('lists tickets for an allowed branch and clamps pagination', async () => {
    const svc = new OwnerService(new FakeRepo(['b1'], detail));
    const out = await svc.listTickets(fresh() as any, { branchId: 'b1', pageSize: 9999 });
    expect(out.pageSize).toBe(100);          // clamped
    expect(out.tickets).toHaveLength(1);
    expect(out.tickets[0].serviceDoneLocked).toBe(true);
  });

  it('assembles history and returns not_found for a missing/foreign ticket', async () => {
    const ok = new OwnerService(new FakeRepo(null, detail));
    const out = await ok.ticketHistory(fresh() as any, 'tk1');
    expect(out.ticket.ticketNumber).toBe('#3041');
    expect(out.lines).toHaveLength(1);
    expect(out.revisions[0].action).toBe('service_added');

    const miss = new OwnerService(new FakeRepo(null, null));
    await expect(miss.ticketHistory(fresh() as any, 'tk1')).rejects.toThrow(/not found/i);
  });

  it('validates and forwards the created-date range to the repo', async () => {
    let captured: any = null;
    class CapRepo extends InMemoryOwnerRepository {
      async ownerTicketsList(_ctx: OwnerContext, f: any) { captured = f; return { tickets: [], total: 0, page: f.page, pageSize: f.pageSize }; }
    }
    const svc = new OwnerService(new CapRepo());
    await svc.listTickets(fresh() as any, { dateFrom: '2026-06-01', dateTo: '2026-06-30' });
    expect(captured.dateFrom).toBe('2026-06-01');
    expect(captured.dateTo).toBe('2026-06-30');
    expect(captured.tz).toBe('America/New_York');   // salon-local day boundaries
    await svc.listTickets(fresh() as any, { dateFrom: 'not-a-date', dateTo: '2026/06/30' });
    expect(captured.dateFrom).toBeUndefined();   // malformed dropped, never reaches SQL
    expect(captured.dateTo).toBeUndefined();
    expect(captured.tz).toBeUndefined();          // no valid date → no timezone lookup
  });
});
