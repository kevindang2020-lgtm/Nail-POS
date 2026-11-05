// booking-verification-remote.ts — the verified-booking flow for the channels that book THROUGH the staff engine
// (BookingService): the public booking link, the AI receptionist and the kiosk (BUILD_PLAN Phase 4).
//
// The customer app inserts its own appointment and wires VerifiedBookingFlow directly (customerAppAdmission). These
// three channels instead hand a date, a start time and services to BookingService, so this adapter does the parts
// they share and must not each re-invent:
//   • the SLOT: the branch's time zone and the services' length turn "2026-10-20 10:00, gel + art" into the instants
//     a hold covers (a hold in the wrong zone guards the wrong hour);
//   • the BOOKING SESSION: it leaves as a token sealed for this salon and THIS principal (the link it was issued on,
//     the voice line, the kiosk). A token from another link, salon or device opens to nothing;
//   • the refusal: "verify first" carries that sealed token, the masked number and when the hold ends — never the raw
//     session id, never the number.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { branchTimeZone } from '@aipowersalon/database';
import { localDateTimeToEpochMs } from '@aipowersalon/date-time';
import { BookingPhoneNotVerifiedError, type GuardCtx } from './booking-verification-guard';
import { VerifiedBookingFlow, type Admission, type BookingSlot } from './booking-verification-flow';
import { openBookingSession, sealBookingSession } from './booking-session-token';
import type { BookingChannel } from './booking-verification-policy';

/** "Verify this number first." Everything a channel needs to ask for the code, and nothing it must not show. */
export class RemoteVerificationRequiredError extends Error {
  readonly code = 'PHONE_VERIFICATION_REQUIRED';
  constructor(message: string, readonly bookingSessionToken: string, readonly maskedPhone: string, readonly policyReason: string, readonly holdExpiresAt: number | null) { super(message); }
}

export interface RemoteAdmitInput {
  phone: string | null | undefined;
  /** What the booking session is bound to: `link:<jti>`, `voice:<line>`, `kiosk:<device>`. */
  principal: string;
  bookingSessionToken?: string | null;
  date: string; startTime: string; serviceIds: string[]; technicianId?: string | null;
  customerId?: string | null; deviceId?: string | null; requestIp?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RemoteBookingAdmission {
  constructor(private readonly flow: VerifiedBookingFlow, private readonly db: AppDatabase) {}

  /** Seal / open a booking session for this salon and principal (the only form it ever leaves the server in). */
  seal(tenantId: string, principal: string, bookingSessionId: string): string { return sealBookingSession(bookingSessionId, { tenantId, customerId: principal }); }
  open(tenantId: string, principal: string, token: unknown): string | null { return openBookingSession(token, { tenantId, customerId: principal }); }

  /** The instants the requested appointment covers, in the branch's zone. Null when the services have no length. */
  async slotFor(tenantId: string, branchId: string, i: { date: string; startTime: string; serviceIds: string[]; technicianId?: string | null }): Promise<BookingSlot | null> {
    const ids = (i.serviceIds ?? []).map(String).filter((s) => UUID.test(s));
    if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(String(i.date)) || !/^\d{2}:\d{2}$/.test(String(i.startTime))) return null;
    const r: any = await sql`SELECT coalesce(sum(duration_minutes), 0)::int AS m FROM services
      WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[])`.execute(this.db as any).catch(() => ({ rows: [] }));
    const minutes = Number(r.rows?.[0]?.m ?? 0);
    if (minutes <= 0) return null;
    const tz = await branchTimeZone(this.db, tenantId, branchId || null);
    const startsAt = localDateTimeToEpochMs(i.date, i.startTime, tz);
    return { technicianId: i.technicianId ?? null, startsAt, endsAt: startsAt + minutes * 60_000, serviceIds: ids };
  }

  /** Throws unless this booking may be created now; see VerifiedBookingFlow.admit. */
  async admit(ctx: GuardCtx & { channel: BookingChannel }, i: RemoteAdmitInput): Promise<Admission> {
    const session = i.bookingSessionToken ? this.open(ctx.tenantId, i.principal, i.bookingSessionToken) : null;
    const slot = await this.slotFor(ctx.tenantId, ctx.branchId, i);
    try {
      return await this.flow.admit(ctx, { phone: i.phone, bookingSessionId: session, slot, customerId: i.customerId ?? null, deviceId: i.deviceId ?? null, requestIp: i.requestIp ?? null });
    } catch (e) {
      if (e instanceof BookingPhoneNotVerifiedError) {
        throw new RemoteVerificationRequiredError(e.message, e.bookingSessionId ? this.seal(ctx.tenantId, i.principal, e.bookingSessionId) : '', e.maskedPhone, e.policyReason, e.holdExpiresAt ?? null);
      }
      throw e;
    }
  }

  complete(ctx: GuardCtx, a: Admission, appointmentId: string): Promise<void> { return this.flow.complete(ctx, a, appointmentId); }
  abandon(a: Admission | null): Promise<void> { return this.flow.abandon(a); }
}
