// customer-booking-reschedule-23p01 — merge Oct 12 2026: the customer app's rescheduleAtomic maps the no-overlap EXCLUDE
// refusal (SQLSTATE 23P01, migration 426/482 — the database's last line when a pooling proxy defeats the advisory lock) to
// `{ ok: false }` exactly as insertBookingAtomic has since 426, instead of surfacing a 500. Any other failure still throws.
// A Kysely stand-in whose transaction executor throws the given error is enough — the mapping is the subject.
import { describe, it, expect } from 'vitest';
import { KyselyCustomerBookingRepository } from './customer-booking.kysely.repository';

function repoThatThrows(err: unknown) {
  const db: any = { transaction: () => ({ execute: async () => { throw err; } }) };
  return new KyselyCustomerBookingRepository(db);
}
const input: any = { tenantId: 't', customerId: 'c', appointmentId: 'a', technicianId: 'tech', date: '2999-01-01', startTime: '10:00', endTime: '11:00', bufferMinutes: 0 };

describe('rescheduleAtomic maps the EXCLUDE refusal to a lost race', () => {
  it('SQLSTATE 23P01 → { ok: false } (a conflict for the customer, never a 500)', async () => {
    const e: any = new Error('conflicting key value violates exclusion constraint "pos_tech_appointments_no_overlap"'); e.code = '23P01';
    expect(await repoThatThrows(e).rescheduleAtomic(input)).toEqual({ ok: false, conflictingAppointmentId: undefined });
  });
  it('a message naming the constraint without the code is mapped the same way', async () => {
    expect((await repoThatThrows(new Error('pos_tech_appointments_no_overlap')).rescheduleAtomic(input)).ok).toBe(false);
  });
  it('any other database failure still throws', async () => {
    const e: any = new Error('connection terminated'); e.code = '57P01';
    await expect(repoThatThrows(e).rescheduleAtomic(input)).rejects.toThrow('connection terminated');
  });
});
