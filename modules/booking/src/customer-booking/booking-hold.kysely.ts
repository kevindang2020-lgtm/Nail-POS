// booking-hold.kysely.ts — persisting a slot reservation while the customer verifies their phone.
//
// The DECISIONS are all in `booking-hold-core.ts` (pure): overlap, one-hold-per-session, expiry, and whether a
// hold may become an appointment. This file only fetches and writes.
//
// ── Two things are enforced by the DATABASE, not by this code ───────────────────────────────────────────
//   uq_booking_holds_live_session   — ONE live hold per booking session
//   uq_booking_holds_appointment    — a hold becomes an appointment exactly ONCE
//
// Both are partial unique indexes (migration 367). They are in the schema rather than in the service because a
// RACE BEATS ANY CHECK THE SERVICE COULD MAKE: two confirmations arriving together would both read "not yet
// converted", both pass, and both create an appointment. The database is the only place that can serialise that.
//
// ── Column names ────────────────────────────────────────────────────────────────────────────────────────
// `booking_holds` predates this feature (migration 009) and uses `start_time` / `end_time`. The pure core speaks
// `startsAt` / `endsAt`. The mapping lives here, once, rather than bending either side to the other.
// CROSS-TENANT BY DESIGN: the expiry sweep releases lapsed holds for EVERY tenant — that is the job.

import { sql } from 'kysely';
import { canMoveToSql, type AppDatabase } from '@aipowersalon/database';
import { BOOKING_HOLD } from './booking-hold-machine';
import {
  decideHold, canConvert, nextExpiry, clampHoldSeconds,
  type ActiveHold, type HoldRequest, type ReleaseReason,
} from './booking-hold-core';

const ms = (t: any): number => (t instanceof Date ? t.getTime() : t ? new Date(t).getTime() : 0);

export class HoldSlotTakenError extends Error {
  readonly code = 'SLOT_HELD';
  constructor(msg: string) { super(msg); }
}
export class HoldNotConvertibleError extends Error {
  readonly code = 'HOLD_NOT_CONVERTIBLE';
  constructor(msg: string, readonly reason: string) { super(msg); }
}

export interface HoldPort {
  /** Every LIVE hold for this tenant+branch that could overlap the requested window. */
  liveHolds(tenantId: string, branchId: string, fromMs: number, toMs: number): Promise<ActiveHold[]>;
  create(req: HoldRequest & { channel: string; expiresAt: number; customerId?: string | null; serviceIds?: string[] }): Promise<{ holdId: string }>;
  refresh(holdId: string, expiresAt: number): Promise<void>;
  release(holdId: string, reason: ReleaseReason): Promise<void>;
  get(tenantId: string, holdId: string): Promise<ActiveHold | null>;
  /** Convert atomically. Returns false if the hold was already converted — the unique index decides, not us. */
  convert(holdId: string, appointmentId: string): Promise<boolean>;
  /** Release everything that has lapsed. Returns how many. */
  sweepExpired(now: number, limit: number): Promise<number>;
  /** Phase 4: this booking session's hold (the latest), if any. */
  bySession?(tenantId: string, bookingSessionId: string): Promise<ActiveHold | null>;
}

const toHold = (r: any): ActiveHold => ({
  holdId: String(r.id),
  tenantId: String(r.tenant_id),
  branchId: String(r.branch_id),
  technicianId: r.technician_id ? String(r.technician_id) : null,
  startsAt: ms(r.start_time),
  endsAt: ms(r.end_time),
  expiresAt: ms(r.expires_at),
  bookingSessionId: String(r.booking_session_id ?? ''),
  released: !!r.released_at,
  convertedAppointmentId: r.converted_appointment_id ? String(r.converted_appointment_id) : null,
});

export class KyselyHoldRepository implements HoldPort {
  constructor(private readonly db: AppDatabase) {}

  async liveHolds(tenantId: string, branchId: string, fromMs: number, toMs: number): Promise<ActiveHold[]> {
    // TENANT + BRANCH scoped, always. A hold at another salon must never block — or be blocked by — this one.
    // The time filter is deliberately WIDER than the requested window (any hold that starts before the window
    // ends and ends after it starts), because a hold that merely OVERLAPS is a conflict; one that is merely
    // "inside" is not the only case.
    const res: any = await sql`
      SELECT id, tenant_id, branch_id, technician_id, start_time, end_time, expires_at,
             booking_session_id, released_at, converted_appointment_id
      FROM booking_holds
      WHERE tenant_id = ${tenantId}
        AND branch_id = ${branchId}
        AND released_at IS NULL
        AND converted_appointment_id IS NULL
        AND expires_at > now()
        AND start_time < to_timestamp(${toMs} / 1000.0)
        AND end_time   > to_timestamp(${fromMs} / 1000.0)
      LIMIT 200`.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map(toHold);
  }

  async create(req: HoldRequest & { channel: string; expiresAt: number; customerId?: string | null; serviceIds?: string[] }): Promise<{ holdId: string }> {
    const res: any = await sql`
      INSERT INTO booking_holds
        (tenant_id, branch_id, technician_id, customer_id, service_ids_json, start_time, end_time,
         expires_at, status, booking_session_id, channel)
      VALUES
        (${req.tenantId}, ${req.branchId}, ${req.technicianId}, ${req.customerId ?? null},
         ${JSON.stringify(req.serviceIds ?? [])}::jsonb,
         to_timestamp(${req.startsAt} / 1000.0), to_timestamp(${req.endsAt} / 1000.0),
         to_timestamp(${req.expiresAt} / 1000.0), 'held', ${req.bookingSessionId}, ${req.channel})
      RETURNING id`.execute(this.db as any).catch((e: any) => {
        // Phase 4 (found by the real-Postgres race lane): two sessions that both passed the overlap check at the same
        // instant meet the database's no-overlap guard. The loser gets the same refusal as a visible hold — never a
        // raw constraint error (a 500 that also names the constraint).
        if (e?.code === '23P01' || e?.code === '23505') throw new HoldSlotTakenError('That time is being held for another booking. Please choose another time.');
        throw e;
      });
    return { holdId: String(res.rows?.[0]?.id ?? '') };
  }

  async refresh(holdId: string, expiresAt: number): Promise<void> {
    // Only a hold that is still LIVE may be extended. Refreshing a released or converted hold would resurrect a
    // reservation the calendar has already moved on from.
    await sql`
      UPDATE booking_holds
      SET expires_at = to_timestamp(${expiresAt} / 1000.0), updated_at = now()
      WHERE id = ${holdId} AND released_at IS NULL AND converted_appointment_id IS NULL`
      .execute(this.db as any).catch(() => undefined);
  }

  async release(holdId: string, reason: ReleaseReason): Promise<void> {
    await sql`
      UPDATE booking_holds
      SET released_at = now(), release_reason = ${reason}, status = 'released', updated_at = now()
      WHERE id = ${holdId} AND released_at IS NULL AND converted_appointment_id IS NULL AND ${canMoveToSql(BOOKING_HOLD, 'released')}`
      .execute(this.db as any).catch(() => undefined);
  }

  async get(tenantId: string, holdId: string): Promise<ActiveHold | null> {
    const res: any = await sql`
      SELECT id, tenant_id, branch_id, technician_id, start_time, end_time, expires_at,
             booking_session_id, released_at, converted_appointment_id
      FROM booking_holds
      WHERE id = ${holdId} AND tenant_id = ${tenantId} LIMIT 1`
      .execute(this.db as any).catch(() => ({ rows: [] }));
    const r = res.rows?.[0];
    return r ? toHold(r) : null;
  }

  async bySession(tenantId: string, bookingSessionId: string): Promise<ActiveHold | null> {
    const res: any = await sql`
      SELECT id, tenant_id, branch_id, technician_id, start_time, end_time, expires_at,
             booking_session_id, released_at, converted_appointment_id
      FROM booking_holds
      WHERE tenant_id = ${tenantId} AND booking_session_id = ${bookingSessionId}
      ORDER BY created_at DESC LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    const r = res.rows?.[0];
    return r ? toHold(r) : null;
  }

  async convert(holdId: string, appointmentId: string): Promise<boolean> {
    // `converted_appointment_id IS NULL` in the WHERE clause, plus the unique index on the column, means a second
    // conversion updates ZERO rows and returns false. Two confirmations racing cannot both win.
    const res: any = await sql`
      UPDATE booking_holds
      SET converted_appointment_id = ${appointmentId}, status = 'converted',
          release_reason = 'converted', updated_at = now()
      WHERE id = ${holdId}
        AND converted_appointment_id IS NULL
        AND released_at IS NULL
        AND ${canMoveToSql(BOOKING_HOLD, 'converted')}
      RETURNING id`.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows?.length ?? 0) > 0;
  }

  async sweepExpired(now: number, limit: number): Promise<number> {
    // Lapsed holds must return the slot to the calendar. Without this a crashed or abandoned booking flow parks
    // a prime slot until someone notices — which is a denial-of-service on the salon's own diary, arriving quietly.
    const res: any = await sql`
      UPDATE booking_holds
      SET released_at = now(), release_reason = 'hold_expired', status = 'expired', updated_at = now()
      WHERE id IN (
        SELECT id FROM booking_holds
        WHERE released_at IS NULL
          AND converted_appointment_id IS NULL
          AND ${canMoveToSql(BOOKING_HOLD, 'expired')}
          AND expires_at <= to_timestamp(${now} / 1000.0)
        ORDER BY expires_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`.execute(this.db as any).catch(() => ({ rows: [] }));
    return res.rows?.length ?? 0;
  }
}

// ── the service ─────────────────────────────────────────────────────────────────────────────────────────
export class BookingHoldService {
  constructor(private readonly repo: HoldPort) {}

  /**
   * Reserve the slot, BEFORE the verification code is sent.
   *
   * The order is the point. Sending a code for a slot that is then taken while the customer types six digits is
   * a Twilio charge for a booking that can never happen, and a customer who verifies and is then told "sorry,
   * gone". Hold first, then send.
   */
  async acquire(
    req: HoldRequest & { channel: string; customerId?: string | null; serviceIds?: string[]; holdSeconds?: number },
    now = Date.now(),
  ): Promise<{ holdId: string; expiresAt: number }> {
    const existing = await this.repo.liveHolds(req.tenantId, req.branchId, req.startsAt, req.endsAt);
    // Round 2 H (found by the AI-receptionist hold test): the session's OWN hold must be in the picture even when it does
    // not overlap the new time — otherwise moving to a different hour reads as "create", the insert meets the
    // one-live-hold-per-session index, and the caller is told their new time is "taken" (by themselves).
    const own = req.bookingSessionId && this.repo.bySession ? await this.repo.bySession(req.tenantId, req.bookingSessionId) : null;
    if (own && !existing.some((h) => h.holdId === own.holdId)) existing.push(own);
    const decision = decideHold(existing, req, now);

    if (decision.action === 'rejected') {
      // The message never says WHO holds the slot — that would confirm another customer's booking exists.
      throw new HoldSlotTakenError(decision.message);
    }

    const expiresAt = nextExpiry(now, clampHoldSeconds(req.holdSeconds));

    if (decision.action === 'refresh') {
      await this.repo.refresh(decision.holdId, expiresAt);
      return { holdId: decision.holdId, expiresAt };
    }

    if (decision.action === 'replace') {
      // The customer moved to a different slot. Release the old hold FIRST — one session, one hold, so an
      // abandoned flow can never leave a trail of parked slots behind it.
      await this.repo.release(decision.releaseHoldId, 'superseded');
    }

    const created = await this.repo.create({ ...req, expiresAt });
    return { holdId: created.holdId, expiresAt };
  }

  /** Give the slot back. Called when verification fails, expires, or the customer walks away. */
  async release(tenantId: string, holdId: string, reason: ReleaseReason): Promise<void> {
    const h = await this.repo.get(tenantId, holdId);
    // Tenant-checked before writing. A hold id is a guessable-ish uuid, and releasing another salon's hold would
    // hand their slot to whoever asked.
    if (!h || h.tenantId !== tenantId) return;
    await this.repo.release(holdId, reason);
  }

  /**
   * Turn a hold into an appointment. The LAST gate before the appointment exists.
   *
   * `canConvert` (pure) refuses an expired, released, already-converted, wrong-session or wrong-tenant hold. The
   * wrong-session case is the replay: verify one booking, then present that verified session against somebody
   * else's hold. The database's unique index then refuses a second conversion even if two requests race.
   */
  async convert(
    tenantId: string,
    holdId: string,
    bookingSessionId: string,
    appointmentId: string,
    now = Date.now(),
  ): Promise<void> {
    const hold = await this.repo.get(tenantId, holdId);
    const check = canConvert(hold, { bookingSessionId, tenantId }, now);
    if (!check.ok) throw new HoldNotConvertibleError(check.message, check.reason);

    const ok = await this.repo.convert(holdId, appointmentId);
    if (!ok) {
      // We passed the pure check but the UPDATE matched nothing — another request converted this hold between
      // our read and our write. The database won, correctly. Reporting it as already-converted is the truth.
      throw new HoldNotConvertibleError('This booking has already been confirmed.', 'already_converted');
    }
  }

  /** The expiry sweep. Runs on a schedule; returns how many slots it handed back to the calendar. */
  async sweep(now = Date.now(), limit = 500): Promise<number> {
    return this.repo.sweepExpired(now, limit);
  }
}
