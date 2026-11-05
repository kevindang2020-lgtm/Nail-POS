// booking-hold-locked-check.ts — the ONE in-transaction "is another session holding this slot?" check (Smooth Refresh /
// Booking Concurrency spec §13, §73). Every appointment writer that can put a technician on a slot calls it INSIDE its
// write transaction, after the technician+day advisory lock (the one lock order: technician-day, then branch-day hold):
//   • the staff engine (booking.kysely.repository create / reschedule — Round 3 H2, moved here Oct 13 2026);
//   • the customer app (customer-booking.kysely.repository insertBookingAtomic / rescheduleAtomic — Wave 3, Oct 13 2026:
//     they had no in-transaction hold check at all, so a slot the AI receptionist was holding could be booked from the app).
// SlotHoldService.place takes the same branch-day lock and reads appointments under it, so a hold and a booking of the
// same slot can never both win. A "first available" hold (technician NULL) blocks every technician at that time; the
// booking's OWN session's hold never blocks it (that hold is converted into the appointment).
import { sql, type Kysely } from 'kysely';
import { branchTimeZone } from '@aipowersalon/database';
import { localDateTimeToEpochMs } from '@aipowersalon/date-time';
import { bookingHoldLockKey } from './booking-hold-core';

/** The instants a write covers and the session whose hold it may convert (null: none). */
export interface LockedHoldGuard { fromMs: number; toMs: number; ownSessionId: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The guard for a branch-local date + HH:MM range (the branch's own zone). An unusable session id is treated as none. */
export async function holdGuardFor(db: Kysely<any>, tenantId: string, branchId: string, date: string, startTime: string, endTime: string, ownSessionId?: string | null): Promise<LockedHoldGuard> {
  const tz = await branchTimeZone(db as any, tenantId, branchId);
  return { fromMs: localDateTimeToEpochMs(date, startTime, tz), toMs: localDateTimeToEpochMs(date, endTime, tz), ownSessionId: ownSessionId && UUID.test(ownSessionId) ? ownSessionId : null };
}

/** Takes the branch-day hold lock, then returns the id of another session's live hold overlapping the guard on this
 *  technician (or a first-available hold), or null. MUST run inside the write's transaction (`trx`). */
export async function lockedForeignHold(trx: Kysely<any>, tenantId: string, branchId: string, technicianId: string | null, date: string, guard: LockedHoldGuard): Promise<string | null> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${bookingHoldLockKey(tenantId, branchId, date)}, 0))`.execute(trx);
  const r: any = await sql`SELECT id FROM booking_holds
    WHERE tenant_id = ${tenantId} AND branch_id = ${branchId}
      AND released_at IS NULL AND converted_appointment_id IS NULL AND expires_at > now()
      AND start_time < to_timestamp(${guard.toMs} / 1000.0) AND end_time > to_timestamp(${guard.fromMs} / 1000.0)
      AND (technician_id IS NULL OR technician_id::text = ${technicianId ?? ''})
      AND booking_session_id IS DISTINCT FROM ${guard.ownSessionId ?? null}::uuid
    LIMIT 1`.execute(trx);
  return r.rows?.length ? String(r.rows[0].id) : null;
}
