// ai-calendar-center.ts — AI Calendar Complete Build Guide (Oct 2026). A READ layer over the canonical Booking engine:
// appointments come from pos_tech_appointments (the same rows POS Booking shows), availability and the technician roster
// come from BookingService itself (dayGrid / technicianPage), and holds come from booking_holds. AI Calendar never keeps
// its own copy of an appointment and never writes one: every consequential change is a PROPOSAL that opens the Reception
// Copilot's prepare → confirm → verify path (sealed review token, claim-before-run ledger, canonical BookingService).
//
// Screenshot root cause (Oct 30 2026, "0 / 0 / 114 / 3"), from code:
//   • Open Slots 114 = 3 technician columns × 38 start times: 15-minute starts where the DEFAULT 45-minute service (+5 min
//     buffer) fits inside 09:00–19:00. Those hours are the engine's hard-coded defaults (saved salon hours are not mapped
//     into the booking engine — see Business Setup), past minutes of TODAY were still counted, and live booking holds
//     were not subtracted. This center reports the engine number AND a hold-aware, past-aware number with its definition.
//   • Technicians On 3 = technician records with available=true (active), NOT people scheduled today. This center reports
//     Scheduled today (active + a working window today), Clocked in (open punch in technician_shifts) and Free now.
//   • AI-Created used a substring heuristic on `source`; it is now the canonical source 'ai', with tool-ledger lineage
//     shown separately. Requested / pending verification is never counted as an appointment.
//   • The default day came from the browser in UTC (toISOString); it is now the branch's own clock.
import { sql, type Kysely } from 'kysely';
import { utcDate } from '@aipowersalon/date-time';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { hasPermission } from '@aipowersalon/permissions';
import { pbComputeAvailabilityInWindows, pbOpenRanges, type BookingService, type BookingContext, type PBStatus } from '@aipowersalon/booking';
import type { BookingTechnicianQuery, AiCalendarPendingQueue } from '@aipowersalon/api-contracts/tenant';

export const AI_CALENDAR_CENTER = Symbol('AI_CALENDAR_CENTER');
export const AIC_PACKAGE = 'ai_phone_call_assistant';
export const AIC_VIEWS = ['day', 'week', 'month', 'list'] as const;
export const AIC_PERIODS = ['today', 'week', 'month', 'year', 'custom'] as const;
export const AIC_BASES = ['service', 'created', 'updated', 'cancelled', 'ai_created'] as const;
export const AIC_SORTS = ['created', 'scheduled', 'updated'] as const;
export const AIC_SOURCES = ['walk_in', 'phone', 'online', 'google', 'ai', 'customer_app', 'manual'] as const;
export const AIC_STATUSES = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'] as const;
export const AIC_PAGE_SIZES = [10, 20, 50] as const;
export const AIC_TECH_PAGE = 12;   // the existing Booking convention: 12 technician columns per page
const HEALTH_GAP_SECONDS = 30;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** an appointment that counts on the calendar: everything except cancelled / no-show (documented in summary.definitions) */
const NOT_COUNTED = ['cancelled', 'no_show'];
const CHAIR = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'];

type Row = Record<string, any>;
export interface AicCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export type AicState = 'READY' | 'WARNING' | 'FAILED' | 'NOT_CONFIGURED' | 'DISABLED' | 'UNKNOWN';
export interface AicCheck { id: string; group: string; label: string; state: AicState; detail: string; evidence: string; remedy: string | null; source: string; checkedAt: string }
type Booking = Pick<BookingService, 'dayGrid' | 'technicianPage'>;
type Busy = { startTime: string; endTime: string; status: PBStatus };
const busy = (startTime: string, endTime: string, status: string): Busy => ({ startTime, endTime, status: status as PBStatus });

export class AiCalendarError extends Error {
  readonly code: string; readonly status: number;
  constructor(message: string, code: string, status = 400) { super(message); this.code = code; this.status = status; }
}

const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const maskPhone = (p?: string | null) => (p ? '•••' + String(p).replace(/\D/g, '').slice(-4) : null);
const maskEmail = (e?: string | null) => { if (!e) return null; const [u, d] = String(e).split('@'); return d ? `${u.slice(0, 1)}•••@${d}` : '•••'; };
const like = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
/** the branch column per table alias — constants only (check:raw-sql-inputs) */
const BRANCH_COL = { a: sql.ref('a.branch_id'), h: sql.ref('h.branch_id'), s: sql.ref('s.branch_id'), x: sql.ref('x.branch_id') } as const;
const rank: Record<AicState, number> = { FAILED: 5, NOT_CONFIGURED: 4, DISABLED: 3, WARNING: 2, UNKNOWN: 1, READY: 0 };
const minOf = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** salon-local calendar arithmetic on plain YYYY-MM-DD strings (never the browser's or the server's zone) */
export function addDays(d: string, k: number): string { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return utcDate(t); }
export function dowOf(d: string): number { return new Date(d + 'T12:00:00Z').getUTCDay(); }
export function localToday(tz: string, now = new Date()): { today: string; minute: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { today: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}
/** Today / This Week (Mon–Sun) / This Month / This Year / Custom — inclusive salon-local dates */
export function periodRange(period: string | undefined, today: string, from?: string, to?: string): { from: string; to: string } {
  if (period === 'custom' || (!period && from && to)) {
    if (!from || !to || !DATE.test(from) || !DATE.test(to)) throw new AiCalendarError('Pick both a From date and a To date.', 'AI_CALENDAR_INVALID_FILTER');
    if (from > to) throw new AiCalendarError('The From date must be on or before the To date.', 'AI_CALENDAR_INVALID_FILTER');
    return { from, to };
  }
  if (period === 'week') { const back = (dowOf(today) + 6) % 7; const s = addDays(today, -back); return { from: s, to: addDays(s, 6) }; }
  if (period === 'month') { const s = today.slice(0, 8) + '01'; const nx = new Date(s + 'T12:00:00Z'); nx.setUTCMonth(nx.getUTCMonth() + 1); return { from: s, to: addDays(utcDate(nx), -1) }; }
  if (period === 'year') return { from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31' };
  if (period === 'today' || !period) return { from: today, to: today };
  throw new AiCalendarError('Unknown period.', 'AI_CALENDAR_INVALID_FILTER');
}
export function pageArgs(page: unknown, size: unknown) {
  const ps = (AIC_PAGE_SIZES as readonly number[]).includes(Number(size)) ? Number(size) : 20;
  const p = Math.max(1, Math.min(10_000, Math.trunc(Number(page)) || 1));
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}
/** E.164-ish digits for phone search: punctuation and a leading country code are tolerated ("(609) 555-0142", "+1 609…") */
export function phoneDigits(q: string): string | null { const d = q.replace(/\D/g, ''); return d.length >= 4 ? (d.length === 11 && d.startsWith('1') ? d.slice(1) : d) : null; }

export class AiCalendarCenter {
  private readonly db: Kysely<any>; private readonly booking: Booking | null;
  constructor(db: Kysely<any>, booking: Booking | null) { this.db = db; this.booking = booking; }

  private branch(ctx: AicCtx) { return ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null; }
  private bctx(ctx: AicCtx): BookingContext { return { tenantId: ctx.tenantId, branchId: this.branch(ctx) ?? '', userId: ctx.userId, role: ctx.role, permissions: ctx.permissions } as BookingContext; }
  private can(ctx: AicCtx, perm: string) { return hasPermission(ctx as Parameters<typeof hasPermission>[0], perm); }
  async clock(ctx: AicCtx) { const tz = await branchTimeZone(this.db, ctx.tenantId, this.branch(ctx)); return { tz, ...localToday(tz) }; }   // no silent America/New_York (Nov 3 audit)
  /** same branch scope as KyselyBookingRepository.scoped(): this branch's rows plus branch-less rows */
  private scope(ctx: AicCtx, alias: keyof typeof BRANCH_COL = 'a') { const b = this.branch(ctx); const col = BRANCH_COL[alias]; return b ? sql`(${col} = ${b} or ${col} is null)` : sql`true`; }
  private day(d: unknown, today: string) { if (d == null || d === '') return today; if (!DATE.test(String(d))) throw new AiCalendarError('Dates are YYYY-MM-DD.', 'AI_CALENDAR_INVALID_FILTER'); return String(d); }

  /** live, not-converted, not-expired slot holds for a salon-local day (booking_holds is the one hold store) */
  private async holds(ctx: AicCtx, date: string, tz: string) {
    return (await sql<Row>`select id, technician_id, to_char(start_time at time zone ${tz}, 'HH24:MI') s, to_char(end_time at time zone ${tz}, 'HH24:MI') e, expires_at, booking_session_id, channel
      from booking_holds h where h.tenant_id = ${ctx.tenantId} and ${this.scope(ctx, 'h')} and h.kind = 'slot' and h.released_at is null and h.converted_appointment_id is null
        and h.expires_at > now() and (h.start_time at time zone ${tz})::date = ${date}::date order by h.start_time, h.id limit 500`.execute(this.db)).rows;
  }

  /** Pending Verification Queue (Extras · AI Calendar 04): every live slot hold (not released, not converted, not expired),
   *  soonest to expire first — the ones waiting for the customer's code and the ones about to lapse. Read-only: a retry or a
   *  release stays a staff action in Booking with its own permission. */
  async pendingQueue(ctx: AicCtx): Promise<AiCalendarPendingQueue> {
    const clk = await this.clock(ctx); const tz = clk.tz;
    const rows = (await sql<Row>`select h.id, h.technician_id, t.full_name tech_name, to_char(h.start_time at time zone ${tz}, 'YYYY-MM-DD') d,
        to_char(h.start_time at time zone ${tz}, 'HH24:MI') s, to_char(h.end_time at time zone ${tz}, 'HH24:MI') e, h.expires_at, h.channel,
        h.booking_session_id is not null pending_code, extract(epoch from (h.expires_at - now()))::int secs
      from booking_holds h left join technicians t on t.id = h.technician_id and t.tenant_id = h.tenant_id
      where h.tenant_id = ${ctx.tenantId} and ${this.scope(ctx, 'h')} and h.kind = 'slot' and h.released_at is null and h.converted_appointment_id is null and h.expires_at > now()
      order by h.expires_at asc, h.id asc limit 200`.execute(this.db)).rows;
    const items = rows.map((r) => ({ id: String(r.id), technicianId: r.technician_id ?? null, technicianName: r.tech_name ?? null, date: String(r.d), start: String(r.s), end: String(r.e),
      expiresAt: iso(r.expires_at)!, minutesLeft: Math.max(0, Math.floor(n(r.secs) / 60)), channel: r.channel ?? null, pendingCode: !!r.pending_code, expiringSoon: n(r.secs) <= 600 }));
    return { asOf: new Date().toISOString(), timeZone: tz, pendingCode: items.filter((x) => x.pendingCode).length, expiringSoon: items.filter((x) => x.expiringSoon).length, items };
  }

  // ── four KPI cards + reconciliation (P1 metric integrity) ────────────────────────────────────────────────────────
  async summary(ctx: AicCtx, dateArg?: string) {
    const T = ctx.tenantId; const clk = await this.clock(ctx); const date = this.day(dateArg, clk.today);
    const a = (await sql<Row>`select count(*) filter (where a.status <> all(${NOT_COUNTED}::text[]))::int active,
        count(*) filter (where a.status <> all(${NOT_COUNTED}::text[]) and a.source = 'ai')::int ai,
        count(*) filter (where a.status = 'cancelled')::int cancelled, count(*) filter (where a.status = 'no_show')::int no_show,
        count(*) filter (where a.status <> all(${NOT_COUNTED}::text[]) and a.technician_id is null)::int unassigned
      from pos_tech_appointments a where a.tenant_id = ${T} and ${this.scope(ctx)} and a.appt_date = ${date}::date`.execute(this.db)).rows[0];
    const linked = n((await sql<Row>`select count(distinct a.id)::int c from pos_tech_appointments a join voice_tool_executions x on x.tenant_id = a.tenant_id and x.related_type = 'appointment' and x.related_id = a.id::text and x.status = 'succeeded'
      where a.tenant_id = ${T} and ${this.scope(ctx)} and a.appt_date = ${date}::date and a.source = 'ai' and a.status <> all(${NOT_COUNTED}::text[])`.execute(this.db).catch(() => ({ rows: [{ c: null }] }))).rows[0]?.c);
    const holds = await this.holds(ctx, date, clk.tz);
    const pendingVerification = holds.filter((h) => h.booking_session_id).length;
    const open = await this.openSlots(ctx, date, clk, holds);
    const techs = await this.techniciansOn(ctx, date, clk);
    return {
      date, timeZone: clk.tz, today: clk.today, branchScope: this.branch(ctx) ? 'branch' : 'all_branches', computedAt: new Date().toISOString(),
      appointments: n(a?.active), aiCreated: n(a?.ai), aiLinkedToCall: linked, cancelled: n(a?.cancelled), noShow: n(a?.no_show), unassigned: n(a?.unassigned),
      pendingVerification, liveHolds: holds.length,
      openSlots: open, technicians: techs,
      definitions: {
        appointments: 'Unique appointments in POS Booking for this day and branch (plus branch-less rows, as Booking shows them). Cancelled and no-show are not counted; they are listed separately.',
        aiCreated: 'Of those, appointments whose canonical booking source is "ai". A booking the AI only looked at, proposed or started (still waiting for the six-digit code) is never counted.',
        openSlots: open.definition,
        technicians: 'Scheduled today = active technicians with a working window today. Clocked in = an open time-clock punch. Free now = today only: inside a working window with no appointment at this minute.',
      },
    };
  }

  /** hold-aware, past-aware bookable start times for the default service — plus the engine's own (raw) number */
  private async openSlots(ctx: AicCtx, date: string, clk: { today: string; minute: number }, holds: Row[]) {
    if (!this.booking) return { value: null as number | null, engineValue: null as number | null, state: 'unknown', definition: 'Booking is not available here.', reconciliation: [] as string[] };
    const g: Row = await this.booking.dayGrid(this.bctx(ctx), date);
    const interval = n(g.slotIntervalMinutes), dur = n(g.defaultServiceDurationMinutes), buf = n(g.bufferMinutes);
    const notBefore = date === clk.today ? Math.ceil(clk.minute / interval) * interval : null;
    // A11 Nov 6 (owner decision, Kevin "pick best"): the open-slot COUNT honours the branch's saved opening hours
    // (tenant_location_hours, Business Setup) — the booking engine itself is unchanged. No saved hours → the engine's hours.
    const saved = await this.savedHours(ctx, date);
    let value = 0; let pastExcluded = 0; let holdExcluded = 0; let columns = 0; let hoursExcluded = 0;
    for (const c of (g.columns ?? []) as Row[]) {
      if (!c.available || !(c.windows ?? []).length) continue;
      columns++;
      const allWin = c.windows as { start: number; end: number }[];
      const win = saved === null ? allWin : saved.closed ? [] : allWin.map((w) => ({ start: Math.max(w.start, saved.open), end: Math.min(w.end, saved.close) })).filter((w) => w.end > w.start);
      if (saved !== null) {
        const mineAll = ((g.appointments ?? []) as Row[]).filter((x) => x.technicianId === c.technicianId).map((x) => busy(x.startTime, x.endTime, x.status));
        hoursExcluded += pbComputeAvailabilityInWindows(allWin, interval, dur, buf, mineAll).length - pbComputeAvailabilityInWindows(win, interval, dur, buf, mineAll).length;
      }
      c.windows = win;
      const mine = ((g.appointments ?? []) as Row[]).filter((x) => x.technicianId === c.technicianId).map((x) => busy(x.startTime, x.endTime, x.status));
      const held = holds.filter((h) => h.technician_id === c.technicianId).map((h) => busy(h.s, h.e, 'booked'));
      const base = pbComputeAvailabilityInWindows(c.windows, interval, dur, buf, mine);
      const withHolds = pbComputeAvailabilityInWindows(c.windows, interval, dur, buf, [...mine, ...held]);
      const future = withHolds.filter((s) => notBefore == null || minOf(s) >= notBefore);
      holdExcluded += base.length - withHolds.length; pastExcluded += withHolds.length - future.length; value += future.length;
    }
    const engineValue = n(g.totalOpenSlots);
    return {
      value, engineValue, state: 'computed', columnsCounted: columns, savedHours: saved === null ? null : saved.closed ? 'closed' : `${hhmm(saved.open)}–${hhmm(saved.close)}`, hoursExcluded, slotIntervalMinutes: interval, serviceMinutes: dur, bufferMinutes: buf, hours: `${g.openTime}–${g.closeTime}`,
      definition: `Bookable start times for a ${dur}-minute service (Booking's default duration, ${buf}-minute buffer) on the ${interval}-minute grid, summed over ${columns} technician column(s) with working hours ${g.openTime}–${g.closeTime}. Excludes appointments, blocked times, live holds${notBefore != null ? ' and times already past today' : ''}. A grid estimate — a longer service fits fewer starts.`,
      reconciliation: [
        `POS Booking engine total: ${engineValue} (counts every active column, does not subtract live holds or past times).`,
        holdExcluded ? `${holdExcluded} start time(s) removed because a live booking hold covers them.` : 'No live booking holds on this day.',
        notBefore != null ? `${pastExcluded} start time(s) removed because they are already past (${hhmm(clk.minute)} salon time).` : 'Not today: no past-time adjustment.',
        saved === null ? `Hours ${g.openTime}–${g.closeTime} come from Booking's settings (this branch has no saved opening hours in Business Setup).`
          : saved.closed ? `The branch's saved hours say it is closed this day, so no start times are counted (Booking's own grid still shows ${g.openTime}–${g.closeTime}).`
          : `Counted inside the branch's saved hours ${hhmm(saved.open)}–${hhmm(saved.close)}${hoursExcluded ? `; ${hoursExcluded} start time(s) of Booking's ${g.openTime}–${g.closeTime} grid fall outside them` : ''}. Booking itself still uses its own hours.`,
      ],
    };
  }

  /** the branch's saved opening hours for the date's weekday (effective-dated rows win), in minutes; null = none saved */
  private async savedHours(ctx: AicCtx, date: string): Promise<{ closed: boolean; open: number; close: number } | null> {
    const b = this.branch(ctx); if (!b) return null;
    const r: Row | undefined = (await sql<Row>`select h.opens_at, h.closes_at, h.is_closed from tenant_location_hours h
      where h.tenant_id = ${ctx.tenantId} and h.location_id = ${b} and h.day_of_week = extract(dow from ${date}::date)::int
        and (h.effective_from is null or h.effective_from <= ${date}::date) and (h.effective_to is null or h.effective_to >= ${date}::date)
      order by (h.effective_from is not null) desc, h.effective_from desc nulls last, h.updated_at desc limit 1`.execute(this.db)).rows[0];
    if (!r) return null;
    if (r.is_closed) return { closed: true, open: 0, close: 0 };
    const m = (v: unknown) => { const x = /^(\d{1,2}):(\d{2})/.exec(String(v ?? '')); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
    const o = m(r.opens_at), c = m(r.closes_at);
    return o === null || c === null || c <= o ? null : { closed: false, open: o, close: c };
  }

  private async techniciansOn(ctx: AicCtx, date: string, clk: { today: string }) {
    const out = { activeRoster: null as number | null, scheduledToday: null as number | null, clockedIn: null as number | null, freeNow: null as number | null, legacyAvailableColumns: null as number | null };
    if (this.booking) {
      const p: Row = await this.booking.technicianPage(this.bctx(ctx), { date, pageSize: 1, status: 'active' } satisfies BookingTechnicianQuery);
      out.activeRoster = n(p.total); out.scheduledToday = n(p.workingCount); out.freeNow = date === clk.today && p.availableNowCount != null ? n(p.availableNowCount) : null;
      out.legacyAvailableColumns = n(p.total);
    }
    if (date === clk.today) {
      out.clockedIn = n((await sql<Row>`select count(distinct s.technician_id)::int c from technician_shifts s join technicians t on t.id = s.technician_id and t.tenant_id = s.tenant_id
        where s.tenant_id = ${ctx.tenantId} and s.end_time is null and s.status = 'active' and ${this.scope(ctx, 's')}`.execute(this.db).catch(() => ({ rows: [{ c: null }] }))).rows[0]?.c);
    }
    return { ...out, metric: 'scheduled_today', value: out.scheduledToday };
  }

  // ── Day view: technician columns (12 per page, Booking's convention) + appointments in service-time order ─────────
  async dayView(ctx: AicCtx, f: { date?: string; techPage?: unknown }) {
    if (!this.booking) throw new AiCalendarError('Booking is not available here.', 'AI_CALENDAR_UNAVAILABLE', 503);
    const clk = await this.clock(ctx); const date = this.day(f.date, clk.today);
    const tp: Row = await this.booking.technicianPage(this.bctx(ctx), { date, pageSize: AIC_TECH_PAGE, page: Math.max(1, Math.trunc(Number(f.techPage)) || 1) } satisfies BookingTechnicianQuery);
    const ids: string[] = (tp.technicians ?? []).map((t: Row) => t.technicianId);
    const g: Row = await this.booking.dayGrid(this.bctx(ctx), date, ids.length ? ids : undefined);
    const holds = await this.holds(ctx, date, clk.tz);
    const appts = ((g.appointments ?? []) as Row[]).slice().sort((x, y) => String(x.startTime).localeCompare(String(y.startTime)) || String(x.appointmentId).localeCompare(String(y.appointmentId)));
    const first = (tp.page - 1) * tp.pageSize + 1;
    return {
      date, timeZone: clk.tz, hours: { open: g.openTime, close: g.closeTime }, slotIntervalMinutes: g.slotIntervalMinutes,
      technicians: (tp.technicians ?? []).map((t: Row) => { const col = ((g.columns ?? []) as Row[]).find((c) => c.technicianId === t.technicianId); return { id: t.technicianId, name: t.name, rosterNumber: t.rosterNumber, workingToday: !!t.workingToday, windows: (col?.windows ?? []).map((w: Row) => ({ start: hhmm(w.start), end: hhmm(w.end) })), blocked: col?.blocked ?? [] }; }),
      techPaging: { page: tp.page, pageSize: tp.pageSize, total: tp.total, totalPages: tp.totalPages, label: tp.total ? `${first}–${Math.min(first + tp.pageSize - 1, tp.total)} of ${tp.total}` : '0 of 0' },
      appointments: appts.map((x) => ({ id: x.appointmentId, technicianId: x.technicianId ?? null, technicianName: x.technicianName ?? null, customerName: x.customerName || null,
        start: x.startTime, end: x.endTime, status: x.status, source: x.source, aiCreated: x.source === 'ai', services: (x.services ?? []).map((s: Row) => s.serviceName).filter(Boolean), createdAt: x.createdAt ?? null })),
      holds: holds.map((h) => ({ id: h.id, technicianId: h.technician_id, start: h.s, end: h.e, expiresAt: iso(h.expires_at), pendingVerification: !!h.booking_session_id, channel: h.channel ?? null })),
    };
  }

  // ── Week / Month: per-day totals in salon-local dates (chronological) ──────────────────────────────────────────────
  async rangeView(ctx: AicCtx, f: { view?: string; date?: string }) {
    const clk = await this.clock(ctx); const date = this.day(f.date, clk.today);
    let from: string, to: string;
    if (f.view === 'week') { const back = (dowOf(date) + 6) % 7; from = addDays(date, -back); to = addDays(from, 6); }
    else if (f.view === 'month') { ({ from, to } = periodRange('month', date)); }
    else throw new AiCalendarError('View must be week or month.', 'AI_CALENDAR_INVALID_FILTER');
    const rows = (await sql<Row>`select a.appt_date::text d, count(*) filter (where a.status <> all(${NOT_COUNTED}::text[]))::int active,
        count(*) filter (where a.status <> all(${NOT_COUNTED}::text[]) and a.source = 'ai')::int ai, count(*) filter (where a.status = 'cancelled')::int cancelled,
        min(a.start_time) filter (where a.status <> all(${NOT_COUNTED}::text[])) first_start
      from pos_tech_appointments a where a.tenant_id = ${ctx.tenantId} and ${this.scope(ctx)} and a.appt_date between ${from}::date and ${to}::date group by a.appt_date`.execute(this.db)).rows;
    const by = new Map(rows.map((r) => [r.d, r]));
    const days: Row[] = []; for (let d = from; d <= to; d = addDays(d, 1)) { const r = by.get(d); days.push({ date: d, dow: dowOf(d), appointments: n(r?.active), aiCreated: n(r?.ai), cancelled: n(r?.cancelled), firstStart: r?.first_start ?? null, isToday: d === clk.today }); }
    return { view: f.view, from, to, timeZone: clk.tz, today: clk.today, days, totals: { appointments: days.reduce((s, d) => s + d.appointments, 0), aiCreated: days.reduce((s, d) => s + d.aiCreated, 0) } };
  }

  // ── List view: server-side search, filters, date basis, numbered pages (newest created first) ─────────────────────
  async list(ctx: AicCtx, f: { q?: string; status?: string; source?: string; aiOnly?: unknown; technicianId?: string; basis?: string; period?: string; from?: string; to?: string; sort?: string; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const clk = await this.clock(ctx); const tz = clk.tz;
    const { from, to } = periodRange(f.period, clk.today, f.from, f.to);
    const { page, pageSize, offset } = pageArgs(f.page, f.pageSize);
    if (f.status && !(AIC_STATUSES as readonly string[]).includes(f.status)) throw new AiCalendarError('Unknown status.', 'AI_CALENDAR_INVALID_FILTER');
    if (f.source && !(AIC_SOURCES as readonly string[]).includes(f.source)) throw new AiCalendarError('Unknown booking source.', 'AI_CALENDAR_INVALID_FILTER');
    const basis = f.basis && (AIC_BASES as readonly string[]).includes(f.basis) ? f.basis : 'service';
    const sort = f.sort && (AIC_SORTS as readonly string[]).includes(f.sort) ? f.sort : 'created';
    if (f.technicianId && !UUID.test(f.technicianId)) throw new AiCalendarError('Unknown technician.', 'AI_CALENDAR_INVALID_FILTER');
    // inclusive salon-local From/To → unambiguous instants [from 00:00, to+1 00:00) in the salon zone
    const lo = sql`(${from}::date::timestamp at time zone ${tz})`, hi = sql`((${to}::date + 1)::timestamp at time zone ${tz})`;
    const dateCond = basis === 'service' ? sql`a.appt_date between ${from}::date and ${to}::date`
      : basis === 'created' ? sql`a.created_at >= ${lo} and a.created_at < ${hi}`
      : basis === 'updated' ? sql`a.updated_at >= ${lo} and a.updated_at < ${hi}`
      : basis === 'cancelled' ? sql`a.status = 'cancelled' and a.updated_at >= ${lo} and a.updated_at < ${hi}`
      : sql`a.source = 'ai' and a.created_at >= ${lo} and a.created_at < ${hi}`;
    const q = String(f.q ?? '').trim().slice(0, 100);
    let qCond = sql`true`;
    if (q) {
      const digits = phoneDigits(q);
      qCond = sql`(a.customer_name ilike ${like(q)} or c.full_name ilike ${like(q)} or lower(c.email) = lower(${q})
        or ${UUID.test(q)} and a.id::text = lower(${q})
        or t.full_name ilike ${like(q)} or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) s where s->>'serviceName' ilike ${like(q)} or s->>'serviceId' = ${q})
        ${digits ? sql`or regexp_replace(coalesce(a.customer_phone, c.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits}` : sql``})`;
    }
    const where = sql`a.tenant_id = ${T} and ${this.scope(ctx)} and ${dateCond} and ${qCond}
      ${f.status ? sql`and a.status = ${f.status}` : sql``} ${f.source ? sql`and a.source = ${f.source}` : sql``}
      ${f.aiOnly === true || f.aiOnly === 'true' ? sql`and a.source = 'ai'` : sql``} ${f.technicianId ? sql`and a.technician_id = ${f.technicianId}` : sql``}`;
    const from_ = sql`from pos_tech_appointments a left join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id left join technicians t on t.id = a.technician_id and t.tenant_id = a.tenant_id`;
    const order = sort === 'scheduled' ? sql`a.appt_date asc, a.start_time asc, a.id asc` : sort === 'updated' ? sql`a.updated_at desc, a.id desc` : sql`a.created_at desc, a.id desc`;
    const total = n((await sql<Row>`select count(*)::int c ${from_} where ${where}`.execute(this.db)).rows[0]?.c);
    const rows = (await sql<Row>`select a.id, a.appt_date::text appt_date, a.start_time, a.end_time, a.status, a.source, a.created_at, a.updated_at, a.services, a.phone_verification,
        coalesce(c.full_name, a.customer_name) customer_name, coalesce(a.customer_phone, c.normalized_phone) phone, a.customer_id, a.technician_id, t.full_name tech_name, a.branch_id
      ${from_} where ${where} order by ${order} limit ${pageSize} offset ${offset}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({ id: r.id, date: r.appt_date, start: r.start_time, end: r.end_time, status: r.status, source: r.source, aiCreated: r.source === 'ai',
        customerName: r.customer_name ?? null, phone: maskPhone(r.phone), customerId: r.customer_id ?? null, technicianId: r.technician_id ?? null, technicianName: r.tech_name ?? null,
        services: (Array.isArray(r.services) ? r.services : []).map((s: Row) => s.serviceName).filter(Boolean), verification: r.phone_verification ?? 'not_required',
        createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) })),
      page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), basis, sort, from, to, timeZone: tz,
    };
  }

  // ── Appointment & Customer History overlay (the view itself is audited; contact masked unless permitted) ──────────
  async detail(ctx: AicCtx, id: string) {
    const unreadable = new Set<string>();   // Nov 3 audit: a section that could not be read is reported, never shown as an empty tab
    if (!UUID.test(String(id))) throw new AiCalendarError('That appointment was not found.', 'AI_CALENDAR_NOT_FOUND', 404);
    const T = ctx.tenantId; const clk = await this.clock(ctx);
    const a = (await sql<Row>`select a.id, a.branch_id, a.technician_id, a.customer_id, a.customer_name, a.customer_phone, a.source, a.services, a.start_time, a.end_time, a.duration_minutes, a.status, a.deposit_status,
        a.phone_verification, a.version, a.created_at, a.updated_at, a.appt_date::text appt_day, t.full_name tech_name from pos_tech_appointments a left join technicians t on t.id = a.technician_id and t.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.id = ${id} and ${this.scope(ctx)}`.execute(this.db)).rows[0];
    if (!a) throw new AiCalendarError('That appointment was not found for this salon.', 'AI_CALENDAR_NOT_FOUND', 404);
    // full contact only for roles that may already export customer PII (no separate contact permission exists in the policy)
    const fullContact = this.can(ctx, 'customers.export') || this.can(ctx, 'pos.customers.export');
    const c = a.customer_id ? (await sql<Row>`select id, full_name, normalized_phone, email, phone_verified_at, created_at from customers where tenant_id = ${T} and id = ${a.customer_id}`.execute(this.db)).rows[0] : null;
    const tools = (await sql<Row>`select tool_name, status, provider_call_id, requested_at, finished_at, error_category from voice_tool_executions where tenant_id = ${T} and related_type = 'appointment' and related_id = ${id}
      order by requested_at asc, id asc limit 20`.execute(this.db).catch(() => { unreadable.add('ai_activity'); return { rows: [] as Row[] }; })).rows;
    const copilot = (await sql<Row>`select action_type, state, summary, created_at from reception_copilot_action_ledger where tenant_id = ${T} and resource_id = ${id} order by created_at desc, id desc limit 20`.execute(this.db).catch(() => { unreadable.add('copilot'); return { rows: [] as Row[] }; })).rows;
    const holds = (await sql<Row>`select id, status, channel, expires_at, released_at, release_reason, booking_session_id is not null pending_code, created_at from booking_holds where tenant_id = ${T} and converted_appointment_id = ${id}
      order by created_at desc limit 10`.execute(this.db)).rows;
    const reminders = (await sql<Row>`select state, channel, intended_send_at, appt_start_at, created_at from appointment_reminders_sent where tenant_id = ${T} and appointment_id = ${id} order by created_at desc limit 10`.execute(this.db).catch(() => { unreadable.add('messages'); return { rows: [] as Row[] }; })).rows;
    const msgs = c ? (await sql<Row>`select channel, status, provider_status, purpose, created_at, delivered_at from notifications where tenant_id = ${T} and customer_id = ${c.id} order by created_at desc, id desc limit 10`.execute(this.db).catch(() => { unreadable.add('messages'); return { rows: [] as Row[] }; })).rows : [];
    const audit = (await sql<Row>`select action, summary, occurred_at, module from audit_events where tenant_id = ${T} and resource_id = ${id} order by occurred_at desc limit 25`.execute(this.db).catch(() => { unreadable.add('audit'); return { rows: [] as Row[] }; })).rows;
    // AI Calendar extras #02 Verified Appointment Timeline: only steps with a stored row (id + time); never a code, a phone or a provider id
    const verif = holds.length ? (await sql<Row>`select v.id, v.booking_hold_id, v.status, v.channel, v.last_sent_at, v.verified_at, v.updated_at, v.attempt_count from booking_verification_sessions v
      where v.tenant_id = ${T} and v.booking_hold_id = any(${holds.map((h) => String(h.id))}::uuid[]) order by v.created_at asc, v.id asc limit 20`.execute(this.db)).rows : [];
    const changes = (await sql<Row>`select cl.id, cl.change_type, cl.field, cl.old_value, cl.new_value, cl.actor_type, cl.source, cl.created_at from appointment_change_log cl
      where cl.tenant_id = ${T} and cl.appointment_id = ${id} and (cl.field = 'status' or cl.change_type = 'cancelled') order by cl.created_at asc, cl.id asc limit 50`.execute(this.db)).rows;
    const history = c ? (await sql<Row>`select id, appt_date::text d, start_time, status, source from pos_tech_appointments where tenant_id = ${T} and customer_id = ${c.id} and id <> ${id} order by appt_date desc, start_time desc, id desc limit 10`.execute(this.db)).rows : [];
    await recordAuditStrict(this.db, { tenantId: T, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role }, {
      module: 'ai_calendar', action: 'appointment_overlay.viewed', resourceType: 'appointment', resourceId: id, summary: 'Appointment details viewed in AI Calendar',
    });
    const services = Array.isArray(a.services) ? a.services : [];
    return {
      overview: { id: a.id, date: a.appt_day, start: a.start_time, end: a.end_time, durationMinutes: a.duration_minutes, status: a.status, source: a.source, aiCreated: a.source === 'ai',
        aiEvidence: a.source === 'ai' ? (tools.some((x) => x.status === 'succeeded') ? 'Booking source "ai", linked to an AI call through a recorded tool result.' : 'Booking source "ai"; no call link recorded.') : 'Not AI-created (booking source is not "ai").',
        branchId: a.branch_id ?? null, timeZone: clk.tz, createdAt: iso(a.created_at), updatedAt: iso(a.updated_at), version: a.version ?? null, verification: a.phone_verification ?? 'not_required', depositStatus: a.deposit_status ?? null },
      customer: c ? { id: c.id, name: c.full_name, phone: fullContact ? c.normalized_phone : maskPhone(c.normalized_phone), email: fullContact ? c.email : maskEmail(c.email), phoneVerified: !!c.phone_verified_at, since: iso(c.created_at), contactMasked: !fullContact }
        : { id: null, name: a.customer_name ?? null, phone: maskPhone(a.customer_phone), email: null, phoneVerified: false, since: null, contactMasked: true },
      services: services.map((s: Row) => ({ name: s.serviceName ?? null, minutes: s.durationMinutes ?? null, priceCents: s.priceCents ?? null, technicianId: s.technicianId ?? a.technician_id ?? null })),
      technician: a.technician_id ? { id: a.technician_id, name: a.tech_name ?? null } : null,
      bookingHistory: history.map((h) => ({ id: h.id, date: h.d, start: h.start_time, status: h.status, source: h.source })),
      unreadable: [...unreadable],
      aiActivity: { toolResults: tools.map((x) => ({ tool: x.tool_name, status: x.status, callRef: x.provider_call_id ? String(x.provider_call_id).slice(-6) : null, at: iso(x.requested_at), error: x.error_category ?? null })),
        copilotActions: copilot.map((x) => ({ type: x.action_type, state: x.state, summary: x.summary, at: iso(x.created_at) })) },
      verificationAndHolds: holds.map((h) => ({ id: h.id, status: h.status, channel: h.channel, expiresAt: iso(h.expires_at), releasedAt: iso(h.released_at), releaseReason: h.release_reason ?? null, codeWasRequired: !!h.pending_code })),
      communications: { reminders: reminders.map((r) => ({ state: r.state, channel: r.channel, intendedAt: iso(r.intended_send_at), forStart: iso(r.appt_start_at) })),
        messages: msgs.map((m) => ({ channel: m.channel, purpose: m.purpose ?? null, state: m.status === 'failed' ? 'failed' : m.delivered_at ? 'delivered' : m.provider_status ? 'provider_accepted' : 'unknown', at: iso(m.created_at) })) },
      auditTrail: audit.map((x) => ({ module: x.module, action: x.action, summary: x.summary, at: iso(x.occurred_at) })),
      timeline: buildAppointmentTimeline({ id: String(a.id), createdAt: a.created_at, source: a.source ?? null, status: a.status ?? null }, holds, verif, changes),
      links: { openBooking: `/booking?date=${a.appt_day}&appointmentId=${a.id}`, customer: c ? `/tenant/customers/profiles?customerId=${c.id}` : null, technicianSchedule: a.technician_id ? `/booking?date=${a.appt_day}&technicianId=${a.technician_id}` : null },
    };
  }

  // ── Check Calendar System (observational; recorded; 30-second rate limit per salon) ──────────────────────────────
  async health(ctx: AicCtx, dateArg?: string) {
    const T = ctx.tenantId, b = this.branch(ctx);
    return this.db.transaction().execute(async (trx) => {
      // one run per salon at a time: concurrent clicks serialise here and the second sees the first's run
      await sql`select pg_advisory_xact_lock(hashtext('ai-calendar-health:' || ${T} || ':' || coalesce(${b}::text, '')))`.execute(trx);
      const recent = (await sql<Row>`select id, overall, checks, created_at, calendar_date::text d from ai_calendar_health_runs where tenant_id = ${T} and branch_id is not distinct from ${b} and created_at > now() - make_interval(secs => ${HEALTH_GAP_SECONDS})
        order by created_at desc limit 1`.execute(trx)).rows[0];
      if (recent) return { runId: recent.id, overall: recent.overall, checks: recent.checks, checkedAt: iso(recent.created_at), date: recent.d, rateLimited: true };
      const clk = await this.clock(ctx); const date = this.day(dateArg, clk.today);
      const at = new Date().toISOString(); const out: AicCheck[] = [];
      const add = (id: string, group: string, label: string, state: AicState, detail: string, evidence: string, remedy: string | null, source: string) => out.push({ id, group, label, state, detail, evidence, remedy, source, checkedAt: at });
      const guard = async (id: string, group: string, label: string, source: string, fn: () => Promise<void>) => {
        // one savepoint per check: a failed read used to abort the whole transaction, so every later check read
        // "transaction aborted" and the run could not be recorded (Nov 3 audit)
        await sql`savepoint health_check`.execute(trx);
        try { await fn(); await sql`release savepoint health_check`.execute(trx); } catch (e) {
          // reviewed: a failed rollback leaves nothing more to report — the check is marked UNKNOWN right here
          await sql`rollback to savepoint health_check`.execute(trx).catch(() => undefined);
          add(id, group, label, 'UNKNOWN', 'This could not be checked right now.', `read failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`, 'Run the check again; if it repeats, contact support with the run time.', source); }
      };
      await guard('booking', 'Canonical Booking', 'Booking rows and parity', 'pos_tech_appointments + BookingService.dayGrid', async () => {
        const mine = n((await sql<Row>`select count(*)::int c from pos_tech_appointments a where a.tenant_id = ${T} and ${this.scope(ctx)} and a.appt_date = ${date}::date and a.status <> all(${NOT_COUNTED}::text[])`.execute(trx)).rows[0]?.c);
        if (!this.booking) { add('booking', 'Canonical Booking', 'Booking rows and parity', 'UNKNOWN', `${mine} appointment(s) in the canonical table; Booking itself is not available here.`, `rows ${mine}`, null, 'pos_tech_appointments'); return; }
        const g: Row = await this.booking.dayGrid(this.bctx(ctx), date);
        const theirs = ((g.appointments ?? []) as Row[]).filter((x) => !NOT_COUNTED.includes(x.status)).length;
        add('booking', 'Canonical Booking', 'Booking rows and parity', mine === theirs ? 'READY' : 'FAILED', mine === theirs ? `AI Calendar and POS Booking both show ${mine} appointment(s) on ${date}.` : `AI Calendar counts ${mine} but POS Booking shows ${theirs} on ${date}.`,
          `canonical rows ${mine}; Booking day grid ${theirs}; same tenant/branch scope`, mine === theirs ? null : 'Report the date and branch to support; the two reads must use the same scope.', 'pos_tech_appointments + BookingService.dayGrid');
      });
      await guard('schedule', 'Technician Schedule', 'Shifts and working hours', 'BookingService.technicianPage', async () => {
        if (!this.booking) { add('schedule', 'Technician Schedule', 'Shifts and working hours', 'UNKNOWN', 'Booking is not available here.', 'no booking service', null, 'BookingService'); return; }
        const p: Row = await this.booking.technicianPage(this.bctx(ctx), { date, pageSize: 1 } satisfies BookingTechnicianQuery);
        const st: AicState = !n(p.total) ? 'NOT_CONFIGURED' : !n(p.workingCount) ? 'WARNING' : 'READY';
        add('schedule', 'Technician Schedule', 'Shifts and working hours', st, !n(p.total) ? 'No active technicians.' : `${n(p.workingCount)} of ${n(p.total)} active technician(s) have working hours on ${date}.`,
          `active ${n(p.total)}; scheduled ${n(p.workingCount)}; free now ${p.availableNowCount ?? 'n/a'}`, !n(p.total) ? 'Add technicians in Team.' : !n(p.workingCount) ? 'Set technician schedules or confirm the salon is closed.' : null, 'BookingService.technicianPage');
      });
      await guard('holds', 'Holds & OTP', 'Holds and six-digit codes', 'booking_holds', async () => {
        const h = (await sql<Row>`select count(*) filter (where kind = 'slot' and released_at is null and converted_appointment_id is null and expires_at > now())::int live,
            count(*) filter (where kind = 'slot' and released_at is null and converted_appointment_id is null and expires_at <= now() and status in ('held', 'active', 'locked', 'pending', 'sent'))::int stale,
            count(*) filter (where kind = 'slot' and booking_session_id is not null and released_at is null and converted_appointment_id is null and expires_at > now())::int pending_code
          from booking_holds h where h.tenant_id = ${T} and ${this.scope(ctx, 'h')}`.execute(trx)).rows[0];
        add('holds', 'Holds & OTP', 'Holds and six-digit codes', n(h?.stale) ? 'WARNING' : 'READY', `${n(h?.live)} live hold(s), ${n(h?.pending_code)} waiting for a six-digit code (never shown as confirmed).${n(h?.stale) ? ` ${n(h?.stale)} expired hold(s) not yet swept.` : ''}`,
          `live ${n(h?.live)}; pending code ${n(h?.pending_code)}; expired unswept ${n(h?.stale)}`, n(h?.stale) ? 'Expired holds no longer block slots here; the one-minute sweep releases them — if this stays, check the worker.' : null, 'booking_holds');
      });
      await guard('provenance', 'AI provenance', 'AI-created lineage', 'pos_tech_appointments.source + voice_tool_executions', async () => {
        const r = (await sql<Row>`select count(*) filter (where a.source = 'ai')::int ai,
            count(*) filter (where a.source = 'ai' and exists (select 1 from voice_tool_executions x where x.tenant_id = a.tenant_id and x.related_type = 'appointment' and x.related_id = a.id::text and x.status = 'succeeded'))::int linked
          from pos_tech_appointments a where a.tenant_id = ${T} and ${this.scope(ctx)} and a.created_at > now() - interval '30 days'`.execute(trx)).rows[0];
        const failed = n((await sql<Row>`select count(*)::int c from voice_tool_executions where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and status = 'failed' and requested_at > now() - interval '30 days'`.execute(trx)).rows[0]?.c);
        const unlinked = n(r?.ai) - n(r?.linked);
        add('provenance', 'AI provenance', 'AI-created lineage', unlinked ? 'WARNING' : 'READY', `${n(r?.ai)} AI-created appointment(s) in 30 days; ${n(r?.linked)} linked to a recorded AI call. Failed AI attempts (${failed}) are never counted as appointments.`,
          `source='ai' ${n(r?.ai)}; tool-linked ${n(r?.linked)}; failed tool calls ${failed}`, unlinked ? 'Unlinked ones came from a path that does not record a call link (older calls or the booking assistant); they still carry the canonical source "ai".' : null, 'pos_tech_appointments.source + voice_tool_executions');
      });
      await guard('realtime', 'Realtime events', 'Updates and freshness', 'pos_tech_appointments.updated_at', async () => {
        const r = (await sql<Row>`select max(updated_at) last from pos_tech_appointments a where a.tenant_id = ${T} and ${this.scope(ctx)}`.execute(trx)).rows[0];
        add('realtime', 'Realtime events', 'Updates and freshness', 'WARNING', 'Booking publishes appointment changes to open screens; this page also refreshes every 45 seconds and on demand. The server cannot see a browser’s live connection, so freshness is shown by the "as of" time instead.',
          `last appointment change ${iso(r?.last) ?? 'none'}; fallback refresh 45 s`, 'If the "as of" time looks old, press Refresh.', 'pos_tech_appointments.updated_at');
      });
      await guard('metrics', 'Metrics', 'Counter definitions', 'AiCalendarCenter.summary', async () => {
        const s = await this.summary(ctx, date);
        const diff = s.openSlots.engineValue != null && s.openSlots.value != null ? s.openSlots.engineValue - s.openSlots.value : null;
        add('metrics', 'Metrics', 'Counter definitions', s.openSlots.value == null || (diff != null && diff < 0) ? 'WARNING' : 'READY', `Appointments ${s.appointments}, AI-Created ${s.aiCreated}, Open start times ${s.openSlots.value ?? '—'} (Booking's raw grid total ${s.openSlots.engineValue ?? '—'}), Scheduled technicians ${s.technicians.scheduledToday ?? '—'} (active roster ${s.technicians.activeRoster ?? '—'}).`,
          `open-slot difference ${diff ?? 'n/a'} = holds + past times; date ${date}; branch scope ${s.branchScope}`, null, 'AiCalendarCenter.summary');
      });
      await guard('conflicts', 'Conflicts', 'Overlaps and durations', 'pos_tech_appointments', async () => {
        const r = (await sql<Row>`select count(*)::int c from pos_tech_appointments x join pos_tech_appointments y on y.tenant_id = x.tenant_id and y.technician_id = x.technician_id and y.appt_date = x.appt_date and y.id > x.id
            and y.start_time < x.end_time and y.end_time > x.start_time and y.status = any(${CHAIR}::text[])
          where x.tenant_id = ${T} and ${this.scope(ctx, 'x')} and x.appt_date between ${date}::date and ${date}::date + 7 and x.status = any(${CHAIR}::text[]) and x.technician_id is not null
            and not coalesce(x.overbook_ok, false) and not coalesce(y.overbook_ok, false)`.execute(trx)).rows[0];
        const bad = n((await sql<Row>`select count(*)::int c from pos_tech_appointments a where a.tenant_id = ${T} and ${this.scope(ctx)} and a.appt_date between ${date}::date and ${date}::date + 7
            and a.status = any(${CHAIR}::text[]) and a.duration_minutes is not null and a.duration_minutes <> ((split_part(a.end_time, ':', 1)::int * 60 + split_part(a.end_time, ':', 2)::int) - (split_part(a.start_time, ':', 1)::int * 60 + split_part(a.start_time, ':', 2)::int))`.execute(trx)).rows[0]?.c);
        add('conflicts', 'Conflicts', 'Overlaps and durations', n(r?.c) ? 'FAILED' : bad ? 'WARNING' : 'READY', `${n(r?.c)} technician overlap(s) without an approved overbook and ${bad} appointment(s) whose stored duration differs from start–end, over the next 7 days.`,
          `unapproved overlaps ${n(r?.c)} (the database refuses new ones: pos_tech_appointments_no_overlap); duration mismatches ${bad}; technician qualifications are enforced by Booking at create/move time`, n(r?.c) ? 'Open the Scheduling Assistant to inspect each overlap and move one appointment (staff confirmation required).' : null, 'pos_tech_appointments');
      });
      await guard('access', 'Permission & audit', 'Your access and audit', 'session + audit_events', async () => {
        const v = n((await sql<Row>`select count(*)::int c from audit_events where tenant_id = ${T} and module = 'ai_calendar' and occurred_at > now() - interval '7 days'`.execute(trx)).rows[0]?.c);
        const contact = this.can(ctx, 'customers.export') || this.can(ctx, 'pos.customers.export');
        add('access', 'Permission & audit', 'Your access and audit', 'READY', `Reads are limited to this salon${b ? ' and branch' : ''}. ${contact ? 'Your role sees full contact details.' : 'Contact details are masked for your role.'} ${v} appointment view(s) audited this week.`,
          `tenant ${T.slice(0, 8)}…; branch ${b ? b.slice(0, 8) + '…' : 'all'}; overlay views audited 7d ${v}`, null, 'session + audit_events');
      });
      const overall = out.reduce<AicState>((w, c) => (rank[c.state] > rank[w] ? c.state : w), 'READY');
      const runId = randomUUID();
      await sql`insert into ai_calendar_health_runs (id, tenant_id, branch_id, actor_user_id, calendar_date, overall, checks) values (${runId}, ${T}, ${b}, ${UUID.test(ctx.userId) ? ctx.userId : null}, ${date}::date, ${overall}, ${JSON.stringify(out)}::jsonb)`.execute(trx);
      return { runId, overall, checks: out, checkedAt: at, date, rateLimited: false };
    });
  }

  // ── Smart AI Scheduling & Availability Assistant (evidence-backed suggestions; nothing changes by itself) ─────────
  async assistant(ctx: AicCtx, dateArg?: string) {
    const T = ctx.tenantId; const clk = await this.clock(ctx); const date = this.day(dateArg, clk.today);
    const cards: Row[] = []; const checkedAt = new Date().toISOString();
    if (this.booking) {
      const g: Row = await this.booking.dayGrid(this.bctx(ctx), date);
      const holds = await this.holds(ctx, date, clk.tz);
      const notBefore = date === clk.today ? Math.ceil(clk.minute / n(g.slotIntervalMinutes)) * n(g.slotIntervalMinutes) : null;
      const dur = n(g.defaultServiceDurationMinutes);
      const free: { tech: string; name: string; start: number; end: number; minutes: number }[] = [];
      for (const c of (g.columns ?? []) as Row[]) {
        if (!c.available || !(c.windows ?? []).length) continue;
        const taken: Busy[] = [...((g.appointments ?? []) as Row[]).filter((x) => x.technicianId === c.technicianId).map((x) => busy(x.startTime, x.endTime, x.status)),
          ...holds.filter((h) => h.technician_id === c.technicianId).map((h) => busy(h.s, h.e, 'booked'))];
        for (const r of pbOpenRanges(c.windows, n(g.bufferMinutes), taken, notBefore)) if (r.minutes >= dur) free.push({ tech: c.technicianId, name: c.name, start: r.start, end: r.end, minutes: r.minutes });
      }
      free.sort((x, y) => x.start - y.start || x.name.localeCompare(y.name));
      if (free.length) {
        const after = free.filter((f) => f.start >= minOf('14:00')); const pick = (after.length >= 2 ? after : free).slice(0, 3);
        cards.push({ kind: 'verified_openings', severity: 'info', title: `${new Set(pick.map((p) => p.tech)).size} technician(s) have uninterrupted ${dur}-minute openings on ${date}`,
          evidence: pick.map((p) => `${p.name}: ${hhmm(p.start)}–${hhmm(p.end)} (${p.minutes} min free)`), scope: { date, serviceMinutes: dur, branch: this.branch(ctx) ? 'branch' : 'all' },
          note: `Checked ${checkedAt} against Booking's working hours, appointments, blocked times and live holds for the default ${dur}-minute service. Not a booking.`, proposal: { type: 'open_booking', date, technicianId: pick[0].tech, startTime: hhmm(pick[0].start) } });
      }
      const idle = free.filter((f) => f.minutes >= Math.max(90, dur * 2)).slice(0, 2);
      for (const g2 of idle) cards.push({ kind: 'idle_gap', severity: 'info', title: `${g2.name} has a ${g2.minutes}-minute gap at ${hhmm(g2.start)}`, evidence: [`${date} ${hhmm(g2.start)}–${hhmm(g2.end)}`],
        note: 'A suggestion to fill an idle gap — not a booked appointment and not guaranteed revenue.', proposal: { type: 'open_booking', date, technicianId: g2.tech, startTime: hhmm(g2.start) } });
    }
    const soon = (await sql<Row>`select id, expires_at, channel, extract(epoch from (expires_at - now()))::int secs from booking_holds h where h.tenant_id = ${T} and ${this.scope(ctx, 'h')} and h.kind = 'slot' and h.booking_session_id is not null
        and h.released_at is null and h.converted_appointment_id is null and h.expires_at > now() and h.expires_at < now() + interval '5 minutes' order by h.expires_at limit 5`.execute(this.db)).rows;
    for (const h of soon) cards.push({ kind: 'verification_expiring', severity: 'warning', title: 'A booking waiting for its six-digit code expires soon', evidence: [`hold ${String(h.id).slice(0, 8)} · ${Math.max(0, n(h.secs))} s left · ${h.channel ?? 'online'}`],
      note: 'This is a pending hold, not an appointment. The code itself is never shown here.', proposal: null });
    const overlaps = (await sql<Row>`select x.id a, y.id b, x.appt_date::text d, x.start_time xs, x.end_time xe, y.start_time ys, y.end_time ye, t.full_name tech from pos_tech_appointments x
        join pos_tech_appointments y on y.tenant_id = x.tenant_id and y.technician_id = x.technician_id and y.appt_date = x.appt_date and y.id > x.id and y.start_time < x.end_time and y.end_time > x.start_time and y.status = any(${CHAIR}::text[])
        left join technicians t on t.id = x.technician_id and t.tenant_id = x.tenant_id
      where x.tenant_id = ${T} and ${this.scope(ctx, 'x')} and x.appt_date = ${date}::date and x.status = any(${CHAIR}::text[]) and not coalesce(x.overbook_ok, false) and not coalesce(y.overbook_ok, false)
      order by x.start_time, x.id limit 5`.execute(this.db)).rows;
    for (const o of overlaps) cards.push({ kind: 'staff_conflict', severity: 'critical', title: `Potential staff conflict for ${o.tech ?? 'a technician'}`, evidence: [`${o.d} ${o.xs}–${o.xe} (appointment ${String(o.a).slice(0, 8)})`, `${o.d} ${o.ys}–${o.ye} (appointment ${String(o.b).slice(0, 8)})`],
      note: 'Inspect both appointments. Moving one goes through Review → Confirm with the canonical Booking rules; nothing moves by itself.', proposal: { type: 'reschedule_review', appointmentId: o.b, date: o.d } });
    return { date, timeZone: clk.tz, checkedAt, cards, guarantee: 'Suggestions only. Every change is reviewed and confirmed by staff and executed by POS Booking.' };
  }
}

/** AI Calendar extras #02 — one auditable step of an appointment's verified timeline; `ref` = the stored row it comes from */
export interface AicTimelineStep { step: string; at: string | null; ref: { table: 'booking_holds' | 'booking_verification_sessions' | 'pos_tech_appointments' | 'appointment_change_log'; id: string }; detail: string | null }
/** Pure: held → code sent → code verified (or failed / expired / locked / canceled) → booked → each recorded status change, oldest first.
 *  A step appears only when its row and time exist (no inferred "confirmed" without a recorded change); codes are never read. */
export type AicTimelineRow = Record<string, any>;
export function buildAppointmentTimeline(a: { id: string; createdAt: unknown; source: string | null; status: string | null }, holds: AicTimelineRow[], verif: AicTimelineRow[], changes: AicTimelineRow[]): AicTimelineStep[] {
  const at = (v: unknown) => (v ? iso(v) : null);
  const out: AicTimelineStep[] = [];
  for (const h of holds) {
    out.push({ step: 'held', at: at(h.created_at), ref: { table: 'booking_holds', id: String(h.id) }, detail: h.channel ?? null });
    if (h.released_at) out.push({ step: 'hold_released', at: at(h.released_at), ref: { table: 'booking_holds', id: String(h.id) }, detail: h.release_reason ?? null });
  }
  for (const v of verif) {
    const ref = { table: 'booking_verification_sessions' as const, id: String(v.id) };
    if (v.last_sent_at) out.push({ step: 'otp_sent', at: at(v.last_sent_at), ref, detail: v.channel ?? null });
    if (v.verified_at) out.push({ step: 'otp_verified', at: at(v.verified_at), ref, detail: null });
    else if (['failed', 'expired', 'locked', 'canceled'].includes(String(v.status))) out.push({ step: 'otp_' + String(v.status), at: at(v.updated_at), ref, detail: v.attempt_count != null ? `attempts ${Number(v.attempt_count)}` : null });
  }
  out.push({ step: 'booked', at: at(a.createdAt), ref: { table: 'pos_tech_appointments', id: a.id }, detail: a.source });
  for (const ch of changes) {
    const to = ch.change_type === 'cancelled' && ch.field !== 'status' ? 'cancelled' : String(ch.new_value ?? '');
    if (!to) continue;
    out.push({ step: 'status:' + to, at: at(ch.created_at), ref: { table: 'appointment_change_log', id: String(ch.id) }, detail: ch.old_value != null ? `from ${String(ch.old_value)}` : null });
  }
  const rank = (st: string) => ['held', 'otp_sent', 'otp_verified', 'otp_failed', 'otp_expired', 'otp_locked', 'otp_canceled', 'hold_released', 'booked'].indexOf(st);
  return out.map((x, i) => ({ x, i })).sort((p, q) => {
    const ta = p.x.at ? Date.parse(p.x.at) : Number.POSITIVE_INFINITY, tb = q.x.at ? Date.parse(q.x.at) : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    const ra = rank(p.x.step), rb = rank(q.x.step);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || p.i - q.i;
  }).map((y) => y.x);
}
