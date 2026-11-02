// outbox-writer.test.ts — 200-technician mandate §65: writeAll is ONE multi-row insert (per 500), validates every envelope
// before inserting anything, and keeps the per-event path for an instance whose write() was replaced (test seam).
import { describe, it, expect } from 'vitest';
import { createDomainEvent, DOMAIN_EVENTS } from './event-contract';
import { OutboxWriter, InvalidDomainEventError } from './outbox-writer';

const ev = (i: number) => createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: 't-1', branchId: 'b-1', aggregateType: 'appointment', aggregateId: 'a-' + i, actorType: 'user', actorId: 'u-1', payload: { appointmentId: 'a-' + i, technicianId: 'tech-1' } });
const fakeTrx = () => { const inserts: number[] = []; return { inserts, trx: { insertInto: (t: string) => ({ values: (rows: any[]) => ({ execute: async () => { expect(t).toBe('outbox_events'); inserts.push(rows.length); } }) }) } as any }; };

describe('OutboxWriter.writeAll', () => {
  it('200 events → one insert; 1,200 → three (500 a statement)', async () => {
    const a = fakeTrx(); await new OutboxWriter().writeAll(a.trx, Array.from({ length: 200 }, (_, i) => ev(i)));
    expect(a.inserts).toEqual([200]);
    const b = fakeTrx(); await new OutboxWriter().writeAll(b.trx, Array.from({ length: 1200 }, (_, i) => ev(i)));
    expect(b.inserts).toEqual([500, 500, 200]);
  });
  it('one malformed envelope refuses the whole batch before anything is inserted', async () => {
    const a = fakeTrx(); const bad = { ...ev(2), aggregateId: '' } as any;
    await expect(new OutboxWriter().writeAll(a.trx, [ev(1), bad, ev(3)])).rejects.toBeInstanceOf(InvalidDomainEventError);
    expect(a.inserts).toEqual([]);
  });
  it('write() is a one-row insert; an instance with a replaced write() keeps per-event semantics', async () => {
    const a = fakeTrx(); await new OutboxWriter().write(a.trx, ev(1)); expect(a.inserts).toEqual([1]);
    const w = new OutboxWriter(); const seen: string[] = []; w.write = async (_t: any, e: any) => { seen.push(e.aggregateId); };
    await w.writeAll(fakeTrx().trx, [ev(1), ev(2)]); expect(seen).toEqual(['a-1', 'a-2']);
  });
});
