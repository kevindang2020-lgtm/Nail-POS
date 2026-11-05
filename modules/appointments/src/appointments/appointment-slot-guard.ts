// appointment-slot-guard.ts — the ONE way a surface writes a technician's time on pos_tech_appointments (merge Oct 12 2026,
// carried from the other chat's booking-concurrency build; Smooth Refresh / Booking Concurrency spec §7–§16).
//
// The 15 s POS sync and the 20 s server reconciliation never prevent double booking. The database does, at the moment a
// booking is created, MOVED, re-assigned or lengthened:
//   1. pg_advisory_xact_lock on `${tenant}|${technician}|${date}` — the SAME key the Booking board (booking.kysely.repository)
//      and the customer app (customer-booking.kysely.repository) take, so the POS, the Technician Appointments screen, the
//      live schedule, the Tech App and the customer app all serialize against each other;
//   2. an in-transaction re-read of committed rows + the shared conflict detector (honours the salon buffer);
//   3. migration 426/482's EXCLUDE constraint as the last line of defense (SQLSTATE 23P01) — e.g. behind a transaction-
//      pooling proxy that defeats the advisory lock. 23P01 maps to AppointmentSlotConflict; nothing is swallowed, so a
//      move that lost the race can never report success.
//
// Overbooking is an explicit, flagged act (migration 482): when the salon's policy allows it or an authorised manager
// overrides, the row is written with overbook_ok = true + overbook_reason + overbook_by_user_id — the ONLY rows the
// constraint exempts. Ordinary bookings stay protected even on a salon that allows overbooking.
//
// Optimistic concurrency (§14–§16): pos_tech_appointments.version is bumped by migration 483's trigger on every UPDATE;
// a caller that passes expectedVersion gets AppointmentVersionConflict instead of last-write-wins.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { CHAIR_HOLDING_STATUSES } from '@aipowersalon/api-contracts';   // Decision 38: the one shared chair-holding list

export class AppointmentSlotConflict extends Error {
  readonly code = 'APPOINTMENT_CONFLICT';
  constructor(public conflictingAppointmentId?: string, message = 'Technician is double-booked at that time') { super(message); this.name = 'AppointmentSlotConflict'; }
}
export class AppointmentVersionConflict extends Error {
  readonly code = 'VERSION_CONFLICT';
  constructor(public currentVersion: number | null) { super('This appointment was changed on another device. The schedule has been refreshed.'); this.name = 'AppointmentVersionConflict'; }
}

/** The technician-day lock key — identical to booking.kysely.repository and customer-booking.kysely.repository. */
export function techDayLockKey(tenantId: string, technicianId: string, date: string): string {
  return `${tenantId}|${technicianId}|${date}`;
}

/** SQLSTATE 23P01 (exclusion_violation) from the no-overlap constraint. */
export function isOverlapViolation(e: unknown): boolean {
  const x = e as any;
  return !!x && (x.code === '23P01' || /pos_tech_appointments_no_overlap|exclusion constraint/i.test(String(x.message || '')));
}

const minutesOf = (t: string) => { const [h, m] = String(t || '0:0').split(':').map((v) => parseInt(v, 10) || 0); return h * 60 + m; };

/** Pure overlap check on the rows read INSIDE the transaction (half-open ranges, salon buffer, chair-holding statuses only). */
export function detectSlotConflict(
  rows: { id: string; technician_id: string | null; start_time: string; end_time: string; status: string }[],
  technicianId: string, startTime: string, endTime: string, bufferMinutes: number, ignoreAppointmentId?: string,
): { status: 'none' | 'conflict'; conflictingAppointmentId?: string } {
  const s = minutesOf(startTime) - bufferMinutes, e = minutesOf(endTime) + bufferMinutes;
  for (const a of rows) {
    if (a.id === ignoreAppointmentId) continue;
    if ((a.technician_id || undefined) !== technicianId) continue;
    if ((CHAIR_HOLDING_STATUSES as readonly string[]).indexOf(a.status) === -1) continue;
    if (minutesOf(a.start_time) < e && minutesOf(a.end_time) > s) return { status: 'conflict', conflictingAppointmentId: a.id };
  }
  return { status: 'none' };
}

export interface SlotOverlap { overlaps: boolean; conflictingAppointmentId?: string }

export interface SlotWrite<T> {
  tenantId: string;
  /** the technician whose day is written; null/undefined = no technician time is touched (only the version check runs) */
  technicianId: string | null | undefined;
  date: string;
  startTime: string;
  endTime: string;
  /** the appointment being moved/edited (excluded from its own conflict check); undefined on create */
  appointmentId?: string;
  bufferMinutes?: number;
  /** salon policy allows overbooking or an authorised manager override — the row is flagged instead of refused */
  allowOverbook?: boolean;
  /** optimistic concurrency: refuse if the row's version moved since the client read it */
  expectedVersion?: number | null;
  /** performs the INSERT/UPDATE on the transaction; told whether the write overlaps (→ write the overbook flag) */
  write: (trx: Kysely<DB>, overlap: SlotOverlap) => Promise<T>;
}

/** Lock the technician-day, re-check committed rows, write. Throws AppointmentSlotConflict / AppointmentVersionConflict. */
export async function writeAppointmentSlot<T>(db: Kysely<DB>, w: SlotWrite<T>): Promise<T> {
  try {
    return await db.transaction().execute(async (trx) => {
      const k = trx as unknown as Kysely<DB>;
      if (w.appointmentId && w.expectedVersion != null) {
        const cur: any = await k.selectFrom('pos_tech_appointments').select(['version'])
          .where('tenant_id', '=', w.tenantId).where('id', '=', w.appointmentId).forUpdate().executeTakeFirst();
        const v = cur ? Number(cur.version ?? 1) : null;
        if (cur && v !== Number(w.expectedVersion)) throw new AppointmentVersionConflict(v);
      }
      let overlap: SlotOverlap = { overlaps: false };
      if (w.technicianId) {
        await sql`select pg_advisory_xact_lock(hashtextextended(${techDayLockKey(w.tenantId, w.technicianId, w.date)}, 0))`.execute(trx);
        const rows = await k.selectFrom('pos_tech_appointments')
          .select(['id', 'technician_id', 'start_time', 'end_time', 'status'])
          .where('tenant_id', '=', w.tenantId).where('technician_id', '=', w.technicianId).where('appt_date', '=', w.date as any).execute();
        const conf = detectSlotConflict(rows as any[], w.technicianId, w.startTime, w.endTime, w.bufferMinutes ?? 0, w.appointmentId);
        if (conf.status === 'conflict') {
          if (!w.allowOverbook) throw new AppointmentSlotConflict(conf.conflictingAppointmentId);
          overlap = { overlaps: true, conflictingAppointmentId: conf.conflictingAppointmentId };
        }
      }
      return w.write(k, overlap);
    });
  } catch (e) {
    if (isOverlapViolation(e)) throw new AppointmentSlotConflict(undefined);
    throw e;
  }
}

/** The overbook columns (migration 482) for a write that overlaps, or the cleared columns for a clean slot. */
export function overbookColumns(overlap: SlotOverlap, reason: string | null | undefined, userId: string | null | undefined): { overbook_ok: boolean; overbook_reason: string | null; overbook_by_user_id: string | null } {
  return overlap.overlaps
    ? { overbook_ok: true, overbook_reason: String(reason || 'manager_override').slice(0, 300), overbook_by_user_id: userId || null }
    : { overbook_ok: false, overbook_reason: null, overbook_by_user_id: null };
}
