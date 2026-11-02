// booking-drafts.ts — B-22 (Oct 22 2026, Kevin: "use the recommended"): the POS "Save Draft" makes a REAL draft.
//
// Before: the button booked a real appointment with "[DRAFT]" in the notes — it took the technician's slot, sent the
// guest a reminder and counted in the booking KPIs. A draft is now a booking_holds row of kind 'draft' (migration 676):
// the whole New Booking form travels in draft_payload, it names NO technician (the no-overlap exclusion and the live-hold
// gate ignore it — a draft blocks nothing), it expires on its own (7 days, the hold sweep already running every minute)
// and it is converted by being booked normally from the POS, which then discards it. Tenant + branch scoped, always.
import { randomUUID } from 'node:crypto';
import { utcDate } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import { canMoveToSql, type DB } from '@aipowersalon/database';
import { BOOKING_HOLD } from '../customer-booking/booking-hold-machine';
import type { BookingContext } from './booking.repository';
import type { BookingDraftView } from '@aipowersalon/api-contracts';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;
export const DRAFT_MAX_PAYLOAD_BYTES = 64 * 1024;

/** The wire shape is the contract's (api-contracts BookingDraftView) — one definition, served as-is. */
export type BookingDraft = BookingDraftView;

export class BookingDraftError extends Error { constructor(public readonly code: 'invalid' | 'not_found', message: string) { super(message); this.name = 'BookingDraftError'; } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;

/** What a draft row carries, derived from the New Booking payload (never trusted for anything but display + resume). */
export function draftFields(payload: Record<string, unknown>) {
  const p = payload || {};
  const serviceIds = (Array.isArray(p.serviceIds) ? p.serviceIds : []).map(String).filter((s) => UUID.test(s));
  const lines = Array.isArray(p.serviceLines) ? (p.serviceLines as any[]) : [];
  const minutes = lines.reduce((a, l) => a + (Number(l?.durationMinutes) || 0), 0) || 30;
  const date = DATE.test(String(p.date ?? '')) ? String(p.date) : null;
  const startTime = TIME.test(String(p.startTime ?? '')) ? String(p.startTime) : null;
  const customerId = UUID.test(String(p.customerId ?? '')) ? String(p.customerId) : null;
  const title = String(p.customerName ?? '').trim() || (lines[0]?.name ? String(lines[0].name) : null);
  const notes = String(p.notes ?? '').replace(/^\[DRAFT\]\s*/i, '').trim() || null;
  return { serviceIds, minutes, date, startTime, customerId, title, notes };
}

export class KyselyBookingDraftRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async save(ctx: BookingContext, payload: Record<string, unknown>): Promise<BookingDraft> {
    const json = JSON.stringify(payload ?? {});
    if (Buffer.byteLength(json) > DRAFT_MAX_PAYLOAD_BYTES) throw withCode(new BookingDraftError('invalid', 'This draft is too large to save.'), 'DRAFT_TOO_LARGE');
    if (!ctx.branchId) throw withCode(new BookingDraftError('invalid', 'Pick a branch before saving a draft.'), 'DRAFT_BRANCH_REQUIRED');
    const f = draftFields(payload);
    // the slot the draft is about (for the list and for "resume"); midnight when no time was picked yet
    const startExpr = f.date ? sql`(${f.date}::date + ${f.startTime ?? '00:00'}::time)` : sql`now()`;
    const res: any = await sql`
      INSERT INTO booking_holds (tenant_id, branch_id, technician_id, customer_id, service_ids_json, start_time, end_time, expires_at, status,
                                 booking_session_id, channel, kind, draft_payload, notes, draft_title, created_by_user_id)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, NULL, ${f.customerId}, ${JSON.stringify(f.serviceIds)}::jsonb,
              ${startExpr}, ${startExpr} + make_interval(mins => ${f.minutes}), now() + make_interval(secs => ${DRAFT_TTL_MS / 1000}), 'held',
              ${randomUUID()}, 'pos_draft', 'draft', ${json}::jsonb, ${f.notes}, ${f.title}, ${ctx.userId || null})
      RETURNING id`.execute(this.db);
    const d = await this.get(ctx, String(res.rows?.[0]?.id ?? ''));
    if (!d) throw withCode(new BookingDraftError('invalid', 'The draft could not be saved.'), 'DRAFT_INVALID');
    return d;
  }

  async list(ctx: BookingContext, limit = 50): Promise<BookingDraft[]> {
    if (!ctx.branchId) return [];
    const res: any = await sql`${this.select(ctx.tenantId)} AND branch_id = ${ctx.branchId} ORDER BY created_at DESC LIMIT ${Math.min(200, Math.max(1, limit))}`.execute(this.db);
    return (res.rows ?? []).map(toDraft);
  }

  async get(ctx: BookingContext, draftId: string): Promise<BookingDraft | null> {
    if (!UUID.test(draftId) || !ctx.branchId) return null;
    // Security Deep Scan §75: a draft belongs to ONE location — another location's session finds nothing (live IDOR branch row)
    const res: any = await sql`${this.select(ctx.tenantId)} AND branch_id = ${ctx.branchId} AND id = ${draftId}`.execute(this.db);
    return res.rows?.[0] ? toDraft(res.rows[0]) : null;
  }

  /** Discarding is a release (release_reason 'draft_discarded' / 'converted' when booked) — the row stays, like every hold. */
  async discard(ctx: BookingContext, draftId: string, reason: 'draft_discarded' | 'converted' = 'draft_discarded'): Promise<boolean> {
    if (!UUID.test(draftId) || !ctx.branchId) return false;
    // the hold state machine decides the move (held → released); a draft already released / converted / expired moves nowhere
    const res: any = await sql`UPDATE booking_holds SET released_at = now(), release_reason = ${reason}, status = 'released', updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND id = ${draftId} AND kind = 'draft' AND released_at IS NULL AND ${canMoveToSql(BOOKING_HOLD, 'released')} RETURNING id`.execute(this.db);
    return (res.rows?.length ?? 0) > 0;
  }

  /** the live drafts of ONE salon — tenant scoped in the fragment itself, never appended by a caller */
  private select(tenantId: string) {
    return sql`SELECT id, draft_title, notes, start_time, service_ids_json, customer_id, draft_payload, created_at, expires_at, created_by_user_id
      FROM booking_holds WHERE tenant_id = ${tenantId} AND kind = 'draft' AND released_at IS NULL AND converted_appointment_id IS NULL AND expires_at > now()`;
  }
}

function toDraft(r: any): BookingDraft {
  const p = (r.draft_payload && typeof r.draft_payload === 'object') ? r.draft_payload : {};
  const start = r.start_time ? new Date(r.start_time) : null;
  return {
    draftId: String(r.id), title: r.draft_title ?? null, notes: r.notes ?? null,
    date: typeof p.date === 'string' ? p.date : start ? utcDate(start) : null,
    startTime: typeof p.startTime === 'string' ? p.startTime : null,
    serviceIds: Array.isArray(r.service_ids_json) ? r.service_ids_json.map(String) : [],
    customerId: r.customer_id ? String(r.customer_id) : null, payload: p,
    createdAt: new Date(r.created_at).toISOString(), expiresAt: new Date(r.expires_at).toISOString(), createdByUserId: r.created_by_user_id ? String(r.created_by_user_id) : null,
  };
}
