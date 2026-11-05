// booking-slot-hold.ts — Round 2 H (Oct 12 2026): the ONE way a staff surface (the Reception Copilot) or the AI
// receptionist holds a slot while the customer decides, and the gate the staff booking engine reads holds through.
//
// Nothing new is modelled here. It is the existing hold model (`booking_holds`, BookingHoldService, the no-overlap
// exclusion constraint, the expiry sweep in booking-hold-sweep.scheduler.ts) plus the salon's own hold time
// (`booking_verification_settings.hold_seconds`, clamped to the platform's 120..900 s by clampHoldSeconds):
//   • place()          — hold an EXACT slot (date + start + the services' length, in the branch's zone) for a booking
//                        session; the same session re-asking refreshes / moves its one hold (decideHold);
//   • release()        — only the session that placed a hold may release it (a hold id alone is not enough);
//   • releaseSession() — the call ended / the receptionist walked away: free whatever that session holds;
//   • liveHolds() / convert() — the BookingHoldGate the staff engine uses (holds of other sessions block; the hold of
//                        the booking's own session is converted into the appointment).
// PERMISSION (decision, Oct 12 2026): holding is a WRITE. Callers gate it with the booking-create key
// `pos.booking.create` (staff) — the AI receptionist's principal already carries it (AI_RECEPTIONIST_PERMISSIONS).
import { sql } from 'kysely';
import { branchTimeZone, type AppDatabase } from '@aipowersalon/database';
import { localDateTimeToEpochMs, zonedParts } from '@aipowersalon/date-time';
import { BookingHoldService, KyselyHoldRepository, HoldSlotTakenError } from './booking-hold.kysely';
import { bookingHoldLockKey, type ActiveHold, type HoldRequest, type ReleaseReason } from './booking-hold-core';
import { pbDetectTechnicianConflict, type PBStatus } from '../booking/booking.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the staff booking engine needs from holds (BookingService's optional 6th dependency). */
export interface BookingHoldGate {
  liveHolds(tenantId: string, branchId: string, fromMs: number, toMs: number): Promise<Pick<ActiveHold, 'holdId' | 'technicianId' | 'startsAt' | 'endsAt' | 'bookingSessionId'>[]>;
  convert(tenantId: string, holdId: string, bookingSessionId: string, appointmentId: string): Promise<void>;
  /** Round 3 H2: release a session's own hold (a move used it up, or a lost conversion left it live). */
  release?(tenantId: string, holdId: string, bookingSessionId: string, reason?: ReleaseReason): Promise<boolean>;
}

export interface SlotHoldRequest {
  tenantId: string; branchId: string; date: string; startTime: string; serviceIds: string[];
  technicianId: string | null; bookingSessionId: string; channel: string; customerId?: string | null;
}
export interface PlacedHold { holdId: string; expiresAt: number; startsAt: number; endsAt: number; technicianId: string | null }

export class SlotHoldInvalidError extends Error { readonly code = 'VALIDATION_FAILED'; }

export class SlotHoldService implements BookingHoldGate {
  private readonly repo: KyselyHoldRepository;
  private readonly holds: BookingHoldService;
  constructor(private readonly db: AppDatabase) {
    this.repo = new KyselyHoldRepository(db);
    this.holds = new BookingHoldService(this.repo);
  }

  /** The instants a booking of these services at date+start covers, in the branch's zone (null = unknown services). */
  async slotFor(tenantId: string, branchId: string, i: { date: string; startTime: string; serviceIds: string[] }): Promise<{ startsAt: number; endsAt: number } | null> {
    const ids = (i.serviceIds ?? []).map(String).filter((s) => UUID.test(s));
    if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(String(i.date)) || !/^\d{2}:\d{2}$/.test(String(i.startTime))) return null;
    const r: any = await sql`SELECT coalesce(sum(duration_minutes), 0)::int AS m FROM services
      WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[])`.execute(this.db as any).catch(() => ({ rows: [] }));
    const minutes = Number(r.rows?.[0]?.m ?? 0);
    if (minutes <= 0) return null;
    const tz = await branchTimeZone(this.db, tenantId, branchId || null);
    const startsAt = localDateTimeToEpochMs(i.date, i.startTime, tz);
    return { startsAt, endsAt: startsAt + minutes * 60_000 };
  }

  /** The salon's (or branch's) hold time — the same setting the verified-booking flow holds for. */
  async holdSeconds(tenantId: string, branchId: string): Promise<number> {
    const r: any = await sql`SELECT hold_seconds FROM booking_verification_settings WHERE tenant_id = ${tenantId}
      AND (branch_id = ${branchId || null}::uuid OR branch_id IS NULL) ORDER BY branch_id NULLS LAST LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return Number(r.rows?.[0]?.hold_seconds ?? 600);
  }

  /** Hold an exact slot. Throws HoldSlotTakenError when another session holds an overlapping one. */
  async place(i: SlotHoldRequest, now = Date.now()): Promise<PlacedHold> {
    if (!UUID.test(String(i.bookingSessionId))) throw new SlotHoldInvalidError('bookingSessionId must be a uuid');
    if (i.technicianId != null && !UUID.test(String(i.technicianId))) throw new SlotHoldInvalidError('technicianId must be a uuid');
    const slot = await this.slotFor(i.tenantId, i.branchId, i);
    if (!slot) throw new SlotHoldInvalidError('a date, a start time (HH:MM) and bookable services are required');
    const h = await this.acquireLocked({
      tenantId: i.tenantId, branchId: i.branchId, technicianId: i.technicianId ?? null, startsAt: slot.startsAt, endsAt: slot.endsAt,
      bookingSessionId: i.bookingSessionId, channel: i.channel, customerId: i.customerId ?? null, serviceIds: i.serviceIds,
      holdSeconds: await this.holdSeconds(i.tenantId, i.branchId),
    }, now);
    return { holdId: h.holdId, expiresAt: h.expiresAt, startsAt: slot.startsAt, endsAt: slot.endsAt, technicianId: i.technicianId ?? null };
  }

  /**
   * Round 3 H2 (Oct 12 2026): acquire a hold UNDER THE SAME LOCK the staff booking engine takes for its hold re-check
   * (bookingHoldLockKey — the branch's local day), and re-check the technician's appointments there. Booking create /
   * reschedule hold that lock while they re-read holds and write, so a hold and a booking of the same slot racing in two
   * sessions serialise: whichever commits first wins, the other is refused (HoldSlotTakenError / 409 held). A hold with no
   * technician ("first available") blocks every technician and is not refused by one technician's appointment.
   * Also the optimizer's hold port (findOptions {hold}) — same signature as BookingHoldService.acquire.
   */
  async acquireLocked(req: HoldRequest & { channel: string; customerId?: string | null; serviceIds?: string[]; holdSeconds?: number }, now = Date.now()): Promise<{ holdId: string; expiresAt: number }> {
    const tz = await branchTimeZone(this.db, req.tenantId, req.branchId || null);
    const local = (ms: number) => { const p = zonedParts(new Date(ms), tz); return { date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, hhmm: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` }; };
    const start = local(req.startsAt), end = local(req.endsAt);
    const endHhmm = end.date === start.date ? end.hhmm : '24:00';
    return (this.db as any).transaction().execute(async (trx: any) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${bookingHoldLockKey(req.tenantId, req.branchId, start.date)}, 0))`.execute(trx);
      if (req.technicianId) {
        const r: any = await sql`SELECT id, technician_id, start_time, end_time, status FROM pos_tech_appointments
          WHERE tenant_id = ${req.tenantId} AND (branch_id = ${req.branchId} OR branch_id IS NULL)
            AND appt_date = ${start.date} AND technician_id = ${req.technicianId}`.execute(trx);
        const existing = (r.rows ?? []).map((a: any) => ({ appointmentId: String(a.id), technicianId: String(a.technician_id), startTime: String(a.start_time).slice(0, 5), endTime: String(a.end_time).slice(0, 5), status: a.status as PBStatus }));
        if (pbDetectTechnicianConflict(existing, req.technicianId, start.hhmm, endHhmm, 0).status === 'conflict') {
          throw new HoldSlotTakenError('That time is no longer available. Please choose another time.');
        }
      }
      return new BookingHoldService(new KyselyHoldRepository(trx)).acquire(req, now);
    });
  }

  /** Release a hold — only for the session that placed it, only in this salon. True when a live hold was released. */
  async release(tenantId: string, holdId: string, bookingSessionId: string, reason: ReleaseReason = 'customer_canceled'): Promise<boolean> {
    if (!UUID.test(String(holdId)) || !UUID.test(String(bookingSessionId))) return false;
    const h = await this.repo.get(tenantId, holdId);
    if (!h || h.tenantId !== tenantId || h.bookingSessionId !== bookingSessionId || h.released || h.convertedAppointmentId) return false;
    await this.repo.release(holdId, reason);
    return true;
  }

  /** Release whatever live hold this booking session has (a call ended, the desk moved on). Returns how many. */
  async releaseSession(tenantId: string, bookingSessionId: string, reason: ReleaseReason = 'customer_canceled'): Promise<number> {
    if (!UUID.test(String(bookingSessionId))) return 0;
    const h = await this.repo.bySession(tenantId, bookingSessionId);
    if (!h || h.released || h.convertedAppointmentId) return 0;
    await this.repo.release(h.holdId, reason);
    return 1;
  }

  liveHolds(tenantId: string, branchId: string, fromMs: number, toMs: number): Promise<ActiveHold[]> {
    return this.repo.liveHolds(tenantId, branchId, fromMs, toMs);
  }

  convert(tenantId: string, holdId: string, bookingSessionId: string, appointmentId: string): Promise<void> {
    return this.holds.convert(tenantId, holdId, bookingSessionId, appointmentId);
  }
}
