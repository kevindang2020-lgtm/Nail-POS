import { describe, it, expect } from 'vitest';
import { TicketHistoryService, TicketHistoryError, type TicketHistoryRepo, type TicketHistoryCtx } from './ticket-history.service';

const ctx: TicketHistoryCtx = { tenantId: 'T', branchId: 'B', userId: 'U', role: 'OWNER', permissions: [] };

const repoWith = (ticket: any, lines: any[] = [], revisions: any[] = []): TicketHistoryRepo => ({
  getTicket: async () => ticket,
  getLines: async () => lines,
  getRevisions: async () => revisions,
});

describe('TicketHistoryService — permanent, status-agnostic ticket history (epic Req §9)', () => {
  it('returns a PAID ticket with its full revision timeline (history survives past serving)', async () => {
    const paid = {
      ticketId: 'tk1', ticketNumber: '#3041', status: 'paid', customerName: 'Grace Kim', technicianName: 'Mia',
      subtotalCents: 7000, taxCents: 0, discountCents: 0, tipCents: 1000, totalCents: 8000, version: 4,
      createdAt: '2026-06-01T00:00:00.000Z', servingStartedAt: null, serviceDoneAt: '2026-06-01T01:00:00.000Z', paidAt: '2026-06-01T01:05:00.000Z',
      serviceDoneLock: { lockedAt: '2026-06-01T01:00:00.000Z', lockedByUserId: 'u_mgr', lockedTotalCents: 7000 },
    };
    const revisions = [
      { version: 1, action: 'service_added', serviceLineId: 'l1', actorUserId: 'u', actorRole: 'TECH', before: null, after: { serviceName: 'Gel Add-on' }, summary: 'Added Gel Add-on', createdAt: '2026-06-01T00:30:00.000Z' },
      { version: 2, action: 'service_done_locked', serviceLineId: null, actorUserId: 'u_mgr', actorRole: 'OWNER', before: null, after: { lockedTotalCents: 7000 }, summary: 'Locked at Service Done (subtotal 7000¢)', createdAt: '2026-06-01T01:00:00.000Z' },
    ];
    const svc = new TicketHistoryService(repoWith(paid, [{ serviceName: 'Signature Manicure', priceCents: 5500, lineTotalCents: 5500, technicianName: 'Mia', status: 'completed', isAddOn: false }], revisions));
    const out = await svc.getHistory(ctx, 'tk1');
    expect(out.ticket.status).toBe('paid');                       // a terminal status is still retrievable
    expect(out.ticket.serviceDoneLock?.lockedTotalCents).toBe(7000);
    expect(out.lines.length).toBe(1);
    expect(out.revisions.map((r) => r.action)).toEqual(['service_added', 'service_done_locked']);
  });

  it('throws when the ticket id is blank', async () => {
    const svc = new TicketHistoryService(repoWith(null));
    await expect(svc.getHistory(ctx, '  ')).rejects.toThrow(TicketHistoryError);
  });

  it('throws "Ticket not found" when the repo returns null', async () => {
    const svc = new TicketHistoryService(repoWith(null));
    await expect(svc.getHistory(ctx, 'nope')).rejects.toThrow(/not found/i);
  });
});
