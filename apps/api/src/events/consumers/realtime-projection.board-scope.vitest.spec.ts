// realtime-projection.board-scope — 200-technician mandate §21/§22/§61 (M5 pilot, Oct 24 2026). An appointment change
// tells the Booking board WHICH technician and WHICH date it is about (ids and a date only, §95), so a board showing page 1
// of 17 — or another day — does not reload its 12-column grid for technician #150. An event whose domain fact does not
// state the technician says nothing (the client then reloads everything — it never guesses).
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { RealtimeProjectionConsumer } from './realtime-projection.consumer';

const T = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', TECH = '33333333-3333-4333-8333-333333333333';
function run(e: Record<string, unknown>) {
  const sent: Array<[string, string, unknown]> = [];
  const rt = {
    toTenant: (_scope: unknown, ev: string, p: unknown) => sent.push(['tenant', ev, p]),
    toOwner: (_t: string, ev: string, p: unknown) => sent.push(['owner', ev, p]),
    toTechnician: (_id: string, ev: string, p: unknown) => sent.push(['technician', ev, p]),
  };
  return new RealtimeProjectionConsumer(rt as never).handle({ tenantId: T, branchId: B, aggregateId: 'a1', payload: {}, ...e } as never).then(() => sent);
}

describe('appointment events carry the board scope (technician + date)', () => {
  it('appointment.created → appointmentCreated { appointmentId, technicianId, date } — no customer field', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.APPOINTMENT_CREATED, payload: { appointmentId: 'a1', technicianId: TECH, customerId: 'c1', date: '2026-10-25', startTime: '10:00', endTime: '10:45', source: 'manual', status: 'booked', serviceCount: 1 } });
    expect(sent.map((x) => [x[0], x[1]])).toEqual([['tenant', EVENTS.appointmentCreated]]);
    expect(sent[0][2]).toMatchObject({ appointmentId: 'a1', technicianId: TECH, date: '2026-10-25' });
    for (const k of ['customerId', 'startTime', 'source', 'customerName', 'customerPhone']) expect(k in (sent[0][2] as object)).toBe(false);
  });
  it('a first-available booking says technicianId: null (every column may change)', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.APPOINTMENT_CREATED, payload: { appointmentId: 'a1', technicianId: null, date: '2026-10-25' } });
    expect(sent[0][2]).toMatchObject({ appointmentId: 'a1', technicianId: null, date: '2026-10-25' });
  });
  it('a fact that does not state its technician carries no technician key at all', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.APPOINTMENT_CREATED, payload: { appointmentId: 'a1' } });
    expect(sent[0][2]).toMatchObject({ appointmentId: 'a1' });
    expect('date' in (sent[0][2] as object)).toBe(false);
    expect('technicianId' in (sent[0][2] as object)).toBe(false);
  });
  it('appointment.updated (an edit / an assign) carries its technician and date', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, payload: { appointmentId: 'a1', technicianId: TECH, date: '2026-10-25', changedFields: ['technicianId'] } });
    expect(sent.map((x) => x[1])).toEqual([EVENTS.appointmentUpdated]);
    expect(sent[0][2]).toMatchObject({ appointmentId: 'a1', technicianId: TECH, date: '2026-10-25' });
  });
  it('a reschedule names BOTH technicians and no single board date (it may leave the day)', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED, payload: { appointmentId: 'a1', fromDate: '2026-10-25', fromTechnicianId: TECH, toDate: '2026-10-26', toTechnicianId: null, toStartTime: '11:00' } });
    expect(sent.map((x) => x[1])).toEqual([EVENTS.appointmentUpdated]);
    expect(sent[0][2]).toMatchObject({ appointmentId: 'a1', toDate: '2026-10-26', technicianIds: [TECH, null] });
    expect('date' in (sent[0][2] as object)).toBe(false);
  });
  it('a status change (cancel / confirm / complete / no-show) carries the technician and date the repository read', async () => {
    for (const [type, ev] of [[DOMAIN_EVENTS.APPOINTMENT_CANCELED, EVENTS.appointmentCancelled], [DOMAIN_EVENTS.APPOINTMENT_CONFIRMED, EVENTS.appointmentUpdated], [DOMAIN_EVENTS.APPOINTMENT_COMPLETED, EVENTS.appointmentUpdated], [DOMAIN_EVENTS.APPOINTMENT_NO_SHOW, EVENTS.appointmentUpdated]] as const) {
      const sent = await run({ eventType: type, payload: { appointmentId: 'a1', previousStatus: 'booked', status: 'cancelled', technicianId: TECH, date: '2026-10-27' } });
      expect(sent.map((x) => x[1])).toEqual([ev]);
      expect(sent[0][2]).toMatchObject({ appointmentId: 'a1', technicianId: TECH, date: '2026-10-27' });
    }
  });
});
