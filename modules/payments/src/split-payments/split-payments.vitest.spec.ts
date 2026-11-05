import { describe, it, expect } from 'vitest';
import { buildSplitTickets, buildSplitSummary, type RawPayment } from './split-payments.dto';
import { InMemorySplitPaymentsRepository } from './split-payments.repository';
import { SplitPaymentsService, SplitPaymentsForbiddenError } from './split-payments.service';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.checkout.view'] };
const p = (o: Partial<RawPayment>): RawPayment => ({ id: 'p', ticketId: 'T1', ticketNumber: '1001', customerName: 'Ana', method: 'card', amountCents: 1000, status: 'approved', createdAt: '2026-07-07T10:00:00Z', ...o });

describe('split-payments — pure builder', () => {
  it('groups a ticket paid with two tenders into one split ticket', () => {
    const rows = [
      p({ id: 'a', method: 'cash', amountCents: 3000, createdAt: '2026-07-07T10:00:00Z' }),
      p({ id: 'b', method: 'card', amountCents: 2000, createdAt: '2026-07-07T10:01:00Z' }),
    ];
    const tickets = buildSplitTickets(rows);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].tenderCount).toBe(2);
    expect(tickets[0].totalCents).toBe(5000);
    expect(tickets[0].methods).toEqual(['cash', 'card']);
  });
  it('excludes single-tender tickets and non-revenue statuses', () => {
    const rows = [
      p({ id: 's', ticketId: 'SOLO', amountCents: 4000 }),                                   // single tender -> not split
      p({ id: 'r1', ticketId: 'REF', status: 'refunded', method: 'card' }),
      p({ id: 'r2', ticketId: 'REF', status: 'voided', method: 'cash' }),                     // both non-revenue -> excluded
    ];
    expect(buildSplitTickets(rows)).toHaveLength(0);
  });
  it('summary counts split tickets, total, and average tenders', () => {
    const tickets = buildSplitTickets([
      p({ id: 'a', ticketId: 'T1', method: 'cash', amountCents: 3000 }),
      p({ id: 'b', ticketId: 'T1', method: 'card', amountCents: 2000, createdAt: '2026-07-07T10:01:00Z' }),
      p({ id: 'c', ticketId: 'T2', method: 'cash', amountCents: 1000 }),
      p({ id: 'd', ticketId: 'T2', method: 'gift', amountCents: 500, createdAt: '2026-07-07T11:01:00Z' }),
      p({ id: 'e', ticketId: 'T2', method: 'card', amountCents: 500, createdAt: '2026-07-07T11:02:00Z' }),
    ]);
    const s = buildSplitSummary(tickets);
    expect(s.splitTicketCount).toBe(2); expect(s.totalSplitCents).toBe(7000); expect(s.averageTenders).toBe(2.5);
  });
});

describe('split-payments — service', () => {
  it('returns split state; rejects unauthenticated', async () => {
    const repo = new InMemorySplitPaymentsRepository([
      p({ id: 'a', method: 'cash', amountCents: 3000 }),
      p({ id: 'b', method: 'card', amountCents: 2000, createdAt: '2026-07-07T10:01:00Z' }),
    ]);
    const svc = new SplitPaymentsService(repo);
    const st = await svc.getState(ctx);
    expect(st.tickets).toHaveLength(1); expect(st.kpis.splitTicketCount).toBe(1);
    await expect(svc.getState({ tenantId: '', userId: '' } as any)).rejects.toBeInstanceOf(SplitPaymentsForbiddenError);
  });
});
