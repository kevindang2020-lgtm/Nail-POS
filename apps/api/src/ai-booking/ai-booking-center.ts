// ai-booking-center.ts — A7 AI Booking Assistant guide (Nov 4 2026): the salon's operations center for the add-on, over the
// EXISTING records only (guide §2 — no parallel customer / appointment / SMS / usage store):
//   ai_booking_conversion_events   the assistant's funnel; one REQUEST = one correlation id (intent → options → verify → book)
//   pos_tech_appointments          the authoritative appointment (pending "booked" vs "confirmed" are different facts, §6)
//   booking_holds                  slot holds (live / converted / released / expired)
//   booking_verification_sessions  the six-digit phone proof (state only — never a code)
//   voice_tool_executions          the AI's tool calls (name, outcome, sanitized error)
// Parts: overview (§3 operations counts with their definitions), activity (§4 search / filters / date basis / numbered
// pages, newest first), detail (§8 overlay tabs), health (§9 Check AI Booking System — read-only, recorded) and recovery
// (§10 cases staff can act on; the AI never sends, books or charges by itself — Dismiss is recorded with who and why).
// Every query is scoped to the caller's salon, and to their location when the session has one.
import { sql, type Kysely } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';

/** a stored JSON list (array column or JSON text); anything else is an empty list, said in the log */
function jsonList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string' || !v.trim()) return [];
  try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { console.warn(`not a JSON list: ${(e as Error)?.message ?? e}`); return [] as unknown[]; }
}
export type BkHealthStatus = 'READY' | 'ATTENTION_REQUIRED' | 'FAILED' | 'DISABLED' | 'NOT_CONFIGURED' | 'UNKNOWN';
export interface BkHealthCheck { key: string; status: BkHealthStatus; evidence: string; failure: string | null; fix: string | null; owner: string; facts: Record<string, string | number>; checkedAt: string }
export interface BkCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export class AiBookingCenterError extends Error { constructor(message: string, readonly code: string, readonly status = 400) { super(message); this.name = 'AiBookingCenterError'; } }

export const BK_STATUSES = ['requested', 'prepared', 'pending_verification', 'pending_confirmation', 'confirmed', 'failed', 'cancelled', 'abandoned', 'handed_off'] as const;
export const BK_SOURCES = ['AI_PHONE_RECEPTIONIST', 'FRONT_DESK_POS', 'CUSTOMER_MOBILE_APP', 'ONLINE_BOOKING', 'PARTNER_BOOKING_LINK', 'WALK_IN_CONVERSION', 'SUPER_ADMIN_SUPPORT_MODE'] as const;
export const BK_BASES = ['requested', 'appointment', 'updated'] as const;
export const BK_PRESETS = ['all', 'today', 'week', 'month', 'year', 'custom'] as const;
const PACKAGE = 'ai_booking_assistant';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v ? new Date(v as string | number | Date).toISOString() : null);
const ymd = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const like = (q: string) => q.replace(/[\\%_]/g, (m) => '\\' + m);
const mask = (p: unknown) => { const d = String(p ?? '').replace(/[^0-9]/g, ''); return d.length >= 4 ? '••• ' + d.slice(-4) : null; };
const SEVERITY: BkHealthStatus[] = ['FAILED', 'UNKNOWN', 'ATTENTION_REQUIRED', 'NOT_CONFIGURED', 'DISABLED', 'READY'];
const todayIn = (tz: string, now: number) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); } catch { return new Date(now).toISOString().slice(0, 10); } };
const addDays = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
export function bkPeriod(preset: string | undefined, today: string, from?: string, to?: string): { preset: string; from: string | null; to: string | null } {
  const p = (BK_PRESETS as readonly string[]).includes(String(preset)) ? String(preset) : (from || to ? 'custom' : 'month');
  if (p === 'today') return { preset: p, from: today, to: today };
  if (p === 'week') { const dow = new Date(today + 'T00:00:00Z').getUTCDay(); const f = addDays(today, -((dow + 6) % 7)); return { preset: p, from: f, to: addDays(f, 6) }; }
  if (p === 'month') { const last = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate(); return { preset: p, from: today.slice(0, 8) + '01', to: today.slice(0, 8) + String(last).padStart(2, '0') }; }
  if (p === 'year') return { preset: p, from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31' };
  if (p === 'custom') return { preset: p, from: from || null, to: to || null };
  return { preset: 'all', from: null, to: null };
}

export class AiBookingCenter {
  constructor(private readonly db: Kysely<any>, private readonly env: Record<string, string | undefined> = process.env, private readonly now: () => number = Date.now,
    /** the salon audit trail (modules/audit AuditService.record) — the API binds it; tests may leave it out */
    private readonly audit?: (ctx: { tenantId: string; branchId: string | null; userId: string | null; role: string | null }, input: { module: string; action: string; resourceType: string; resourceId: string; metadata: Record<string, unknown> }) => Promise<unknown>) {}

  private need(ctx: BkCtx, perm: string) {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBookingCenterError('Not signed in.', 'PERMISSION_DENIED', 403);
    if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new AiBookingCenterError(`You need the "${perm}" permission for this.`, 'PERMISSION_DENIED', 403);
  }
  private async zone(ctx: BkCtx): Promise<string> {
    const r = (await sql<any>`select timezone from branches where tenant_id = ${ctx.tenantId} and (${ctx.branchId}::uuid is null or id = ${ctx.branchId}) and timezone is not null
      order by (id = ${ctx.branchId}) desc nulls last, created_at asc limit 1`.execute(this.db)).rows[0];
    return String(r?.timezone ?? 'America/New_York');
  }
  /** one row per request (correlation id), with its derived status and the authoritative appointment beside it */
  private requests(ctx: BkCtx) {
    const branch = ctx.branchId ? sql`and e.branch_id = ${ctx.branchId}` : sql``;
    return sql`(
      with ev as (select coalesce(e.correlation_id, e.id::text) cid, e.* from ai_booking_conversion_events e where e.tenant_id = ${ctx.tenantId} ${branch}),
      rq as (select cid, min(created_at) created_at, max(created_at) updated_at, (array_agg(source order by created_at))[1] source, (array_agg(branch_id order by created_at desc))[1] branch_id,
          bool_or(stage = 'BOOKING_SUCCEEDED') ok, bool_or(stage = 'BOOKING_FAILED' or outcome = 'failed') failed, bool_or(stage = 'CANCEL_SUCCEEDED') cancelled,
          bool_or(stage = 'CONFIRMATION_REQUESTED') conf_req, bool_or(stage = 'CUSTOMER_VERIFIED') verified, bool_or(stage in ('OPTIONS_PRESENTED','OPTION_SELECTED')) prepared,
          bool_or(stage = 'ABANDONED' or outcome = 'abandoned') abandoned, bool_or(stage = 'HUMAN_HANDOFF') handoff, count(*) filter (where stage = 'BOOKING_ATTEMPTED')::int attempts,
          max(appointment_id) appointment_id, (array_agg(failure_reason order by created_at desc) filter (where failure_reason is not null))[1] failure_reason, count(*)::int events
        from ev group by cid)
      select rq.*, a.id as appt_id, a.appt_date, a.start_time, a.status as appt_status, a.customer_id, a.customer_name, a.customer_phone, a.services, a.technician_id,
        coalesce(t.full_name, nullif(trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), '')) as tech_name, c.email, c.normalized_phone,
        case when rq.cancelled or a.status = 'cancelled' then 'cancelled'
             when a.status in ('confirmed','checked_in','waiting','in_service','completed','no_show') then 'confirmed'
             when a.status = 'booked' then 'pending_confirmation'
             when rq.failed then 'failed' when rq.handoff then 'handed_off' when rq.abandoned then 'abandoned'
             when rq.conf_req and not rq.verified then 'pending_verification'
             when rq.prepared or rq.conf_req then 'prepared' else 'requested' end as status
      from rq
      left join pos_tech_appointments a on a.tenant_id = ${ctx.tenantId} and a.id::text = rq.appointment_id
      left join technicians t on t.tenant_id = a.tenant_id and t.id = a.technician_id
      left join customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
    ) r`;
  }

  // ── §3 operations counts ──────────────────────────────────────────────────────────────────────────────────────────
  async overview(ctx: BkCtx, f: { preset?: string; from?: string; to?: string }) {
    this.need(ctx, 'ai_booking.view');
    const tz = await this.zone(ctx); const today = todayIn(tz, this.now());
    const p = bkPeriod(f.preset, today, f.from, f.to); this.checkRange(p);
    const inP = (col: any) => (p.from && p.to ? sql`${col} >= (${p.from}::date)::timestamp at time zone ${tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${tz}` : sql`true`);
    const r = (await sql<any>`select count(*)::int requests,
        count(*) filter (where status in ('prepared','pending_verification','pending_confirmation','confirmed'))::int prepared,
        count(*) filter (where status = 'pending_verification')::int pending_verification, count(*) filter (where status = 'pending_confirmation')::int pending_confirmation,
        count(*) filter (where status = 'confirmed')::int confirmed, count(*) filter (where status = 'failed')::int failed
      from ${this.requests(ctx)} where ${inP(sql`r.created_at`)}`.execute(this.db)).rows[0];
    const hb = ctx.branchId ? sql`and branch_id = ${ctx.branchId}` : sql``;
    const h = (await sql<any>`select count(*) filter (where released_at is null and converted_appointment_id is null and expires_at > now() and status in ('held','active','pending','locked','sent','started'))::int live,
        count(*) filter (where (status = 'expired' or (released_at is null and converted_appointment_id is null and expires_at <= now())) and ${inP(sql`expires_at`)})::int expired
      from booking_holds where tenant_id = ${ctx.tenantId} ${hb} and channel = 'ai_receptionist'`.execute(this.db)).rows[0];
    return { period: { ...p, tz, today }, requests: N(r.requests), prepared: N(r.prepared), pendingVerification: N(r.pending_verification), pendingConfirmation: N(r.pending_confirmation),
      confirmed: N(r.confirmed), failed: N(r.failed), liveHolds: N(h.live), expiredHolds: N(h.expired),
      // the denominators, so a number is never read as something else (§3 "source-based metrics with defined denominators")
      definitions: { requests: 'booking requests started in the period (one per assistant session)', confirmed: 'requests whose appointment is confirmed in POS Booking', holds: 'AI receptionist slot holds' } };
  }
  private checkRange(p: { from: string | null; to: string | null }) {
    if (p.from && !DAY.test(p.from)) throw new AiBookingCenterError('Choose a valid From date.', 'VALIDATION_FAILED');
    if (p.to && !DAY.test(p.to)) throw new AiBookingCenterError('Choose a valid To date.', 'VALIDATION_FAILED');
    if (p.from && p.to && p.to < p.from) throw new AiBookingCenterError('The To date is before the From date.', 'DATE_RANGE_INVALID');
  }

  // ── §4 activity: search · filters · date basis · numbered pages ──────────────────────────────────────────────────────
  async activity(ctx: BkCtx, f: { q?: string; status?: string; source?: string; technicianId?: string; basis?: string; preset?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }) {
    this.need(ctx, 'ai_booking.view');
    const tz = await this.zone(ctx); const today = todayIn(tz, this.now());
    const p = bkPeriod(f.preset ?? 'all', today, f.from, f.to); this.checkRange(p);
    const size = [10, 20, 50].includes(Number(f.pageSize)) ? Number(f.pageSize) : 20;
    const page = Math.max(1, Math.min(10_000, Math.floor(Number(f.page) || 1)));
    const basis = (BK_BASES as readonly string[]).includes(String(f.basis)) ? String(f.basis) : 'requested';
    const conds = [sql`true`];
    if (p.from && p.to) {
      if (basis === 'appointment') conds.push(sql`r.appt_date between ${p.from}::date and ${p.to}::date`);
      else { const col = basis === 'updated' ? sql`r.updated_at` : sql`r.created_at`; conds.push(sql`${col} >= (${p.from}::date)::timestamp at time zone ${tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${tz}`); }
    }
    if (f.status && (BK_STATUSES as readonly string[]).includes(f.status)) conds.push(sql`r.status = ${f.status}`);
    if (f.source && (BK_SOURCES as readonly string[]).includes(f.source)) conds.push(sql`r.source = ${f.source}`);
    if (f.technicianId && UUID.test(f.technicianId)) conds.push(sql`r.technician_id = ${f.technicianId}`);
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q) {
      const digits = q.replace(/[^0-9]/g, '');
      const words = q.split(/\s+/).filter((w) => /\p{L}/u.test(w)).slice(0, 6);
      const ors = [sql`r.cid ilike ${like(q) + '%'}`, sql`coalesce(r.appt_id::text, '') ilike ${like(q) + '%'}`, sql`coalesce(r.customer_id::text, '') ilike ${like(q) + '%'}`];
      if (words.length) {
        const all = (col: any) => sql.join(words.map((w) => sql`vi_fold(coalesce(${col}, '')) like '%' || vi_fold(${like(w)}) || '%'`), sql` and `);
        ors.push(sql`(${all(sql`r.customer_name`)})`, sql`(${all(sql`r.tech_name`)})`, sql`(${all(sql`r.services::text`)})`);
      }
      if (q.includes('@')) ors.push(sql`lower(coalesce(r.email, '')) like ${'%' + like(q.toLowerCase()) + '%'}`);
      if (digits.length >= 4) ors.push(sql`regexp_replace(coalesce(r.customer_phone, '') || ' ' || coalesce(r.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}`);
      conds.push(sql`(${sql.join(ors, sql` or `)})`);
    }
    const where = sql.join(conds, sql` and `);
    const total = N((await sql<any>`select count(*)::int n from ${this.requests(ctx)} where ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select * from ${this.requests(ctx)} where ${where} order by r.created_at desc, r.cid desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return { period: { ...p, tz, today }, basis, page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)), order: 'newest' as const, items: rows.map((r: any) => this.row(r)) };
  }
  private row(r: any) {
    const services = this.services(r.services);
    return { requestId: String(r.cid), status: String(r.status), source: String(r.source), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      customerName: r.customer_name ?? null, maskedPhone: mask(r.customer_phone ?? r.normalized_phone), customerId: r.customer_id ? String(r.customer_id) : null,
      appointmentId: r.appt_id ? String(r.appt_id) : null, appointmentDate: ymd(r.appt_date), appointmentTime: r.start_time ?? null, appointmentStatus: r.appt_status ?? null,
      services: services.map((s) => s.name).filter(Boolean) as string[], technicianId: r.technician_id ? String(r.technician_id) : null, technicianName: r.tech_name ?? null,
      failureReason: r.failure_reason ?? null, attempts: N(r.attempts), events: N(r.events) };
  }
  private services(v: unknown): Array<{ name: string | null; priceCents: number | null; durationMinutes: number | null }> {
    const list = jsonList(v);
    return (Array.isArray(list) ? list : []).map((s: any) => ({ name: s?.name ?? s?.serviceName ?? null, priceCents: s?.priceCents ?? s?.price_cents ?? null, durationMinutes: s?.durationMinutes ?? s?.duration_minutes ?? null }));
  }

  // ── §8 overlay ────────────────────────────────────────────────────────────────────────────────────────────────────
  async detail(ctx: BkCtx, requestId: string) {
    this.need(ctx, 'ai_booking.view');
    const id = String(requestId ?? '').slice(0, 100);
    const r: any = (await sql<any>`select * from ${this.requests(ctx)} where r.cid = ${id}`.execute(this.db)).rows[0];
    if (!r) throw new AiBookingCenterError('That booking request could not be found.', 'NOT_FOUND', 404);
    const branch = ctx.branchId ? sql`and branch_id = ${ctx.branchId}` : sql``;
    const events = (await sql<any>`select stage, outcome, failure_reason, appointment_id, latency_ms, created_at from ai_booking_conversion_events
      where tenant_id = ${ctx.tenantId} ${branch} and coalesce(correlation_id, id::text) = ${id} order by created_at asc, id asc limit 200`.execute(this.db)).rows;
    const verifications = (await sql<any>`select v.id, v.status, v.channel, v.phone_mask, v.attempt_count, v.resend_count, v.expires_at, v.verified_at, v.last_sent_at, v.failure_reason, v.provider,
        v.provider_verification_sid, v.booking_hold_id, v.created_at from booking_verification_sessions v
      where v.tenant_id = ${ctx.tenantId} and v.correlation_id::text = ${id} order by v.created_at asc limit 20`.execute(this.db).catch(() => ({ rows: [] as Array<Record<string, any>> }))).rows;
    const holdIds = verifications.map((v: any) => v.booking_hold_id).filter(Boolean);
    const holds = (await sql<any>`select id, status, channel, start_time, end_time, expires_at, released_at, release_reason, converted_appointment_id, created_at from booking_holds
      where tenant_id = ${ctx.tenantId} and (${holdIds.length ? sql`id in (${sql.join(holdIds)})` : sql`false`} or (${r.appt_id ?? null}::uuid is not null and converted_appointment_id = ${r.appt_id ?? null}::uuid))
      order by created_at asc limit 20`.execute(this.db).catch(() => ({ rows: [] as Array<Record<string, any>> }))).rows;
    const tools = r.appt_id ? (await sql<any>`select tool_name, tool_kind, status, business_result, error_category, requests, requested_at, finished_at from voice_tool_executions
      where tenant_id = ${ctx.tenantId} and related_id = ${String(r.appt_id)} order by requested_at asc limit 50`.execute(this.db).catch(() => ({ rows: [] as Array<Record<string, any>> }))).rows : [];
    const nearby = r.customer_id ? (await sql<any>`select id, appt_date, start_time, status, source from pos_tech_appointments where tenant_id = ${ctx.tenantId} and customer_id = ${r.customer_id}
      and appt_date between current_date - 60 and current_date + 60 order by appt_date asc, start_time asc limit 12`.execute(this.db)).rows : [];
    return {
      ...this.row(r), branchId: r.branch_id ? String(r.branch_id) : null,
      customer: { customerId: r.customer_id ? String(r.customer_id) : null, name: r.customer_name ?? null, maskedPhone: mask(r.customer_phone ?? r.normalized_phone),
        verified: verifications.some((v: any) => v.status === 'verified'),
        appointments: nearby.map((a: any) => ({ appointmentId: String(a.id), date: ymd(a.appt_date), time: a.start_time ?? null, status: a.status, source: a.source })) },
      serviceLines: this.services(r.services),
      timeline: events.map((e: any) => ({ stage: e.stage, outcome: e.outcome ?? null, failureReason: e.failure_reason ?? null, appointmentId: e.appointment_id ?? null, latencyMs: e.latency_ms ?? null, at: iso(e.created_at) })),
      // never a code — state, counts, the masked phone and when it expires
      verification: verifications.map((v: any) => ({ status: v.status, channel: v.channel, maskedPhone: v.phone_mask, attempts: N(v.attempt_count), resends: N(v.resend_count),
        expiresAt: iso(v.expires_at), verifiedAt: iso(v.verified_at), failureReason: v.failure_reason ?? null, at: iso(v.created_at) })),
      communications: verifications.filter((v: any) => v.last_sent_at).map((v: any) => ({ kind: 'verification_code', provider: v.provider,
        providerReference: v.provider_verification_sid ? '…' + String(v.provider_verification_sid).slice(-6) : null, sentAt: iso(v.last_sent_at), status: v.status })),
      holds: holds.map((h: any) => ({ holdId: String(h.id), status: h.status, channel: h.channel, startAt: iso(h.start_time), endAt: iso(h.end_time), expiresAt: iso(h.expires_at),
        releasedAt: iso(h.released_at), releaseReason: h.release_reason ?? null, convertedAppointmentId: h.converted_appointment_id ? String(h.converted_appointment_id) : null })),
      tools: tools.map((t: any) => ({ tool: t.tool_name, kind: t.tool_kind, status: t.status, result: t.business_result ?? null, error: t.error_category ?? null, requests: N(t.requests), at: iso(t.requested_at), finishedAt: iso(t.finished_at) })),
    };
  }

  // ── §10 recovery cases ────────────────────────────────────────────────────────────────────────────────────────────
  async recovery(ctx: BkCtx) {
    this.need(ctx, 'ai_booking.view');
    const hb = ctx.branchId ? sql`and h.branch_id = ${ctx.branchId}` : sql``;
    const vb = ctx.branchId ? sql`and v.branch_id = ${ctx.branchId}` : sql``;
    const ab = ctx.branchId ? sql`and a.branch_id = ${ctx.branchId}` : sql``;
    const dismissed = new Set((await sql<any>`select case_key from ai_booking_recovery_dismissals where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows.map((x: any) => String(x.case_key)));
    const cases: any[] = [];
    const failed = (await sql<any>`select * from ${this.requests(ctx)} where r.status = 'failed' and r.created_at >= now() - interval '7 days' order by r.created_at desc limit 50`.execute(this.db)).rows;
    for (const r of failed) cases.push({ key: 'failed:' + r.cid, type: r.attempts > 1 ? 'repeated_attempts' : 'failed_request', urgency: 'high', requestId: String(r.cid), at: iso(r.updated_at),
      customerName: r.customer_name ?? null, maskedPhone: mask(r.customer_phone), appointmentId: r.appt_id ? String(r.appt_id) : null, date: ymd(r.appt_date), reason: r.failure_reason ?? null, source: r.source, attempts: N(r.attempts) });
    const holds = (await sql<any>`select h.id, h.expires_at, h.start_time, h.status, h.released_at, h.converted_appointment_id, h.customer_id, c.full_name, c.normalized_phone
      from booking_holds h left join customers c on c.tenant_id = h.tenant_id and c.id = h.customer_id
      where h.tenant_id = ${ctx.tenantId} ${hb} and h.channel = 'ai_receptionist' and h.converted_appointment_id is null
        and ((h.released_at is null and h.expires_at > now() and h.expires_at < now() + interval '10 minutes')
          or ((h.status = 'expired' or (h.released_at is null and h.expires_at <= now())) and h.expires_at >= now() - interval '1 day'))
      order by h.expires_at desc limit 50`.execute(this.db)).rows;
    for (const h of holds) {
      const live = new Date(h.expires_at).getTime() > this.now();
      cases.push({ key: 'hold:' + h.id, type: live ? 'hold_expiring' : 'hold_expired', urgency: live ? 'high' : 'medium', requestId: null, at: iso(h.expires_at), customerName: h.full_name ?? null,
        maskedPhone: mask(h.normalized_phone), appointmentId: null, date: h.start_time ? new Date(h.start_time).toISOString().slice(0, 10) : null, reason: live ? 'hold_expires_soon' : 'hold_expired_unbooked', source: 'AI_PHONE_RECEPTIONIST', attempts: 0 });
    }
    const ver = (await sql<any>`select v.id, v.correlation_id, v.status, v.expires_at, v.phone_mask, v.failure_reason, v.created_at from booking_verification_sessions v
      where v.tenant_id = ${ctx.tenantId} ${vb} and v.channel = 'ai_receptionist' and v.status in ('expired','locked','failed') and v.created_at >= now() - interval '1 day'
      order by v.created_at desc limit 50`.execute(this.db).catch(() => ({ rows: [] as Array<Record<string, any>> }))).rows;
    for (const v of ver) cases.push({ key: 'verify:' + v.id, type: 'verification_' + v.status, urgency: 'medium', requestId: v.correlation_id ? String(v.correlation_id) : null, at: iso(v.created_at),
      customerName: null, maskedPhone: v.phone_mask ?? null, appointmentId: null, date: null, reason: v.failure_reason ?? null, source: 'AI_PHONE_RECEPTIONIST', attempts: 0 });
    const unconfirmed = (await sql<any>`select a.id, a.appt_date, a.start_time, a.customer_name, a.customer_phone, a.created_at from pos_tech_appointments a
      where a.tenant_id = ${ctx.tenantId} ${ab} and a.source = 'ai' and a.status = 'booked' and a.appt_date between current_date and current_date + 1
      order by a.appt_date asc, a.start_time asc limit 50`.execute(this.db)).rows;
    for (const a of unconfirmed) cases.push({ key: 'unconfirmed:' + a.id, type: 'unconfirmed_appointment', urgency: 'medium', requestId: null, at: iso(a.created_at), customerName: a.customer_name ?? null,
      maskedPhone: mask(a.customer_phone), appointmentId: String(a.id), date: ymd(a.appt_date), reason: 'not_confirmed', source: 'AI_PHONE_RECEPTIONIST', attempts: 0 });
    const open = cases.filter((c) => !dismissed.has(c.key));
    const rank = (u: string) => (u === 'high' ? 0 : u === 'medium' ? 1 : 2);
    open.sort((a, b) => rank(a.urgency) - rank(b.urgency) || String(b.at).localeCompare(String(a.at)));
    return { cases: open, dismissedCount: cases.length - open.length, note: 'Suggestions only: nothing is sent, booked or charged until staff act in POS Booking.' };
  }

  async dismissRecovery(ctx: BkCtx, key: string, reason: unknown) {
    this.need(ctx, 'ai_booking.view');
    if (!/^(failed|hold|verify|unconfirmed):[0-9a-zA-Z-]{1,100}$/.test(String(key))) throw new AiBookingCenterError('That case could not be found.', 'NOT_FOUND', 404);
    const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
    if (!why) throw new AiBookingCenterError('Say why the case is dismissed.', 'REASON_REQUIRED');
    await sql`insert into ai_booking_recovery_dismissals (tenant_id, case_key, reason, dismissed_by) values (${ctx.tenantId}, ${key}, ${why}, ${UUID.test(ctx.userId) ? ctx.userId : null})
      on conflict (tenant_id, case_key) do nothing`.execute(this.db);
    // through the audit module (it used to write audit_logs itself)
    await this.audit?.({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: UUID.test(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null },
      { module: 'ai_booking', action: 'ai_booking_recovery_dismissed', resourceType: 'ai_booking_recovery_case', resourceId: key, metadata: { reason: why } });
    return { dismissed: true, key };
  }

  // ── §9 Check AI Booking System ────────────────────────────────────────────────────────────────────────────────────
  async lastHealth(ctx: BkCtx) {
    this.need(ctx, 'ai_booking.view');
    const r: any = (await sql<any>`select id, overall, checks, created_at from ai_booking_health_runs where tenant_id = ${ctx.tenantId} and branch_id is not distinct from ${ctx.branchId}
      order by created_at desc, id desc limit 1`.execute(this.db)).rows[0];
    return { run: r ? { runId: String(r.id), overall: r.overall as BkHealthStatus, checkedAt: iso(r.created_at)!, checks: typeof r.checks === 'string' ? JSON.parse(r.checks) : r.checks, note: NOTE } : null };
  }

  async health(ctx: BkCtx) {
    this.need(ctx, 'ai_booking.view');
    const T = ctx.tenantId, B = ctx.branchId;
    const at = new Date(this.now()).toISOString();
    const out: BkHealthCheck[] = [];
    const add = (key: string, status: BkHealthStatus, evidence: string, owner: string, facts: Record<string, string | number> = {}, failure: string | null = null, fix: string | null = null): void => { out.push({ key, status, evidence, failure, fix, owner, facts, checkedAt: at }); };
    const attempt = async (key: string, owner: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (e: any) { add(key, 'UNKNOWN', 'The check could not read its data.', owner, {}, String(e?.message ?? e).slice(0, 200), 'Run the check again; if it repeats, that data source is down.'); }
    };
    // the two aliases the checks use, as literal SQL (never an identifier built from a value)
    const bAnd = (alias: 'a' | 't') => (!B ? sql`` : alias === 'a' ? sql`and a.branch_id = ${B}` : sql`and t.branch_id = ${B}`);
    let subStatus: string | null = null;

    await attempt('entitlement', 'Owner', async () => {
      const s: any = (await sql<any>`select status, trial_ends_at, cancelled_at, current_period_ends_at from tenant_ai_subscriptions where tenant_id = ${T} and package_code = ${PACKAGE} order by created_at desc limit 1`.execute(this.db)).rows[0];
      subStatus = s?.status ?? null;
      if (!s) return add('entitlement', 'NOT_CONFIGURED', 'The salon has no AI Booking Assistant subscription.', 'Owner', {}, 'No subscription.', 'Start a trial or subscribe from this page.');
      const live = ['active', 'trialing', 'past_due'].includes(s.status);
      const trialOver = s.status === 'trialing' && s.trial_ends_at && new Date(s.trial_ends_at).getTime() < this.now();
      add('entitlement', live && !trialOver ? (s.status === 'past_due' ? 'ATTENTION_REQUIRED' : 'READY') : 'DISABLED', `Subscription ${s.status}${s.cancelled_at ? `, cancelled ${iso(s.cancelled_at)}` : ''}${s.trial_ends_at ? `, trial ends ${iso(s.trial_ends_at)}` : ''}.`, 'Owner',
        { status: String(s.status), cancelledAt: iso(s.cancelled_at) ?? '', trialEndsAt: iso(s.trial_ends_at) ?? '' },
        live && !trialOver ? (s.status === 'past_due' ? 'A payment is past due.' : null) : 'New AI booking work is blocked; staff keep booking normally in POS Booking.', live && !trialOver ? null : 'Reactivate the add-on from this page (an explicit, confirmed action).');
    });
    await attempt('permissions', 'Owner', async () => {
      const p: any = (await sql<any>`select value from platform_settings where setting_key = 'ai.auto_actions_disabled' limit 1`.execute(this.db).catch(() => ({ rows: [] as Array<Record<string, any>> }))).rows[0];
      const off = p && ['true', '"true"', 'TRUE'].includes(String(p.value));
      add('permissions', off ? 'DISABLED' : 'READY', off ? 'AI actions are switched off platform-wide.' : 'No platform-wide block; your role can view this page.', 'Super Admin', {}, off ? 'Blocked platform-wide.' : null, off ? 'Ask AIPowerSalon support.' : null);
    });
    await attempt('provider', 'AIPowerSalon', async () => {
      const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'].filter((k) => String(this.env[k] ?? '').trim());
      add('provider', keys.length ? 'READY' : 'NOT_CONFIGURED', keys.length ? 'An AI provider is configured on the server.' : 'No AI provider is configured on the server.', 'AIPowerSalon', { providers: keys.length },
        keys.length ? null : 'The assistant cannot run.', keys.length ? null : 'AIPowerSalon support sets the provider key on the server.');
    });
    await attempt('catalog', 'Manager', async () => {
      const r: any = (await sql<any>`select count(*)::int total, count(*) filter (where coalesce(s.price_cents, 0) <= 0)::int no_price, count(*) filter (where coalesce(s.duration_minutes, 0) <= 0)::int no_duration
        from services s where s.tenant_id = ${T} and s.status = 'active' and coalesce(s.online_booking_enabled, true)`.execute(this.db)).rows[0];
      const bad = N(r.no_price) + N(r.no_duration);
      add('catalog', N(r.total) === 0 ? 'NOT_CONFIGURED' : bad ? 'ATTENTION_REQUIRED' : 'READY', `${N(r.total)} active service(s); ${N(r.no_price)} without a price, ${N(r.no_duration)} without a duration.`, 'Manager',
        { total: N(r.total), noPrice: N(r.no_price), noDuration: N(r.no_duration) }, bad ? 'Some services cannot be booked correctly.' : null, bad ? 'Add the missing price or duration in Services & Products.' : null);
    });
    await attempt('technicians', 'Manager', async () => {
      const r: any = (await sql<any>`select count(*)::int n from technicians t where t.tenant_id = ${T} ${bAnd('t')} and t.is_active = true`.execute(this.db)).rows[0];
      add('technicians', N(r.n) ? 'READY' : 'NOT_CONFIGURED', `${N(r.n)} active technician(s).`, 'Manager', { total: N(r.n) }, N(r.n) ? null : 'No active technicians.', N(r.n) ? null : 'Add technicians under Team.');
    });
    await attempt('availability', 'Manager', async () => {
      const r: any = (await sql<any>`select count(*)::int n from pos_tech_appointments a where a.tenant_id = ${T} ${bAnd('a')} and a.appt_date between current_date and current_date + 7 and a.status in ('booked','confirmed')`.execute(this.db)).rows[0];
      add('availability', 'READY', `The POS Booking calendar is readable: ${N(r.n)} upcoming appointment(s) in the next 7 days. The assistant searches the same engine.`, 'Manager', { upcoming: N(r.n) });
    });
    await attempt('booking_api', 'AIPowerSalon', async () => {
      const r: any = (await sql<any>`select count(*)::int n from pg_indexes where indexname in ('uq_pos_tech_appts_queue_key')`.execute(this.db)).rows[0];
      const att: any = (await sql<any>`select count(*) filter (where stage = 'BOOKING_ATTEMPTED')::int attempted, count(*) filter (where stage = 'BOOKING_SUCCEEDED')::int ok from ai_booking_conversion_events
        where tenant_id = ${T} and created_at >= now() - interval '7 days'`.execute(this.db)).rows[0];
      add('booking_api', N(r.n) ? 'READY' : 'ATTENTION_REQUIRED', `Last 7 days: ${N(att.attempted)} booking attempt(s), ${N(att.ok)} created. Duplicate protection ${N(r.n) ? 'in place' : 'missing'}.`, 'AIPowerSalon',
        { attempted: N(att.attempted), created: N(att.ok) }, N(r.n) ? null : 'A retried booking could be created twice.', N(r.n) ? null : 'Run the database migrations.');
    });
    await attempt('verification', 'Owner', async () => {
      const v: any = (await sql<any>`select enabled, channel_ai_receptionist, hold_seconds from booking_verification_settings where tenant_id = ${T} and (branch_id is not distinct from ${B} or branch_id is null) order by (branch_id is null) asc limit 1`.execute(this.db)).rows[0];
      if (!v) return add('verification', 'ATTENTION_REQUIRED', 'No verification settings saved — the platform default applies.', 'Owner', {}, null, 'Review Booking Verification.');
      const on = !!(v.enabled && v.channel_ai_receptionist);
      add('verification', on ? 'READY' : 'DISABLED', on ? `Six-digit verification is on for AI bookings (hold ${Math.round(N(v.hold_seconds) / 60)} min).` : 'Six-digit verification is off for AI bookings (a salon choice).', 'Owner', { holdMinutes: Math.round(N(v.hold_seconds) / 60) });
    });
    await attempt('communications', 'Owner', async () => {
      const c: any = (await sql<any>`select status, last_validated_at, last_validation_error from tenant_messaging_credentials where tenant_id = ${T} and provider = 'twilio' and (branch_id is not distinct from ${B} or branch_id is null) and offboarded_at is null
        order by (branch_id is null) asc limit 1`.execute(this.db)).rows[0];
      if (!c) return add('communications', 'NOT_CONFIGURED', 'This salon has not connected its own Twilio account.', 'Owner', {}, 'Codes and texts cannot be sent from the salon\'s number.', 'Open Text Messaging Setup and connect the salon\'s Twilio account.');
      if (c.last_validation_error) return add('communications', 'FAILED', 'The last Twilio account check failed.', 'Owner', {}, 'Texts may not send.', 'Run Check SMS System in Text Messaging Setup.');
      add('communications', c.last_validated_at ? 'READY' : 'ATTENTION_REQUIRED', c.last_validated_at ? `Twilio account checked ${iso(c.last_validated_at)}.` : 'Twilio account saved but never checked.', 'Owner', { checkedAt: iso(c.last_validated_at) ?? '' },
        null, c.last_validated_at ? null : 'Run Check SMS System in Text Messaging Setup.');
    });
    await attempt('sync', 'AIPowerSalon', async () => {
      const r: any = (await sql<any>`select count(*) filter (where publish_status = 'failed')::int failed, count(*) filter (where publish_status in ('pending','claimed') and occurred_at < now() - interval '5 minutes')::int late
        from outbox_events where tenant_id = ${T} and (event_type ilike '%appointment%' or event_type ilike 'booking%') and occurred_at >= now() - interval '1 day'`.execute(this.db)).rows[0];
      const st: BkHealthStatus = N(r.failed) ? 'FAILED' : N(r.late) ? 'ATTENTION_REQUIRED' : 'READY';
      add('sync', st, `Booking updates in the last day: ${N(r.failed)} failed, ${N(r.late)} waiting more than 5 minutes.`, 'AIPowerSalon', { failed: N(r.failed), late: N(r.late) },
        st === 'READY' ? null : 'AI Calendar and POS Booking may show an update late.', st === 'READY' ? null : 'Check the event publisher in System Operations.');
    });
    await attempt('usage', 'Owner', async () => {
      const s: any = (await sql<any>`select current_period_starts_at, usage_limit from tenant_ai_subscriptions where tenant_id = ${T} and package_code = ${PACKAGE} order by created_at desc limit 1`.execute(this.db).catch(() => ({ rows: [] as Array<Record<string, any>> }))).rows[0];
      if (!s) return add('usage', 'NOT_CONFIGURED', 'No subscription, so no usage period.', 'Owner');
      const u: any = (await sql<any>`select coalesce(sum(usage_amount) filter (where status = 'success'), 0)::bigint used from ai_usage_logs where tenant_id = ${T} and package_code = ${PACKAGE} and created_at >= ${s.current_period_starts_at}`.execute(this.db)).rows[0];
      const limit = N(s.usage_limit); const used = N(u.used); const pct = limit ? Math.round((used / limit) * 100) : 0;
      add('usage', limit && pct >= 100 ? 'FAILED' : limit && pct >= 80 ? 'ATTENTION_REQUIRED' : 'READY', `${used} of ${limit || '—'} used this period (${pct}%). Nothing is upgraded or charged automatically.`, 'Owner', { used, limit, percent: pct },
        limit && pct >= 100 ? 'The limit for this period is reached.' : null, limit && pct >= 80 ? 'Watch the usage; a plan change is an explicit owner action.' : null);
    });
    await attempt('observability', 'Manager', async () => {
      const r: any = (await sql<any>`select count(*) filter (where stage = 'BOOKING_FAILED')::int failed from ai_booking_conversion_events where tenant_id = ${T} and created_at >= now() - interval '1 day'`.execute(this.db)).rows[0];
      const t: any = (await sql<any>`select count(*) filter (where status = 'failed')::int failed from voice_tool_executions where tenant_id = ${T} and requested_at >= now() - interval '1 day'`.execute(this.db).catch(() => ({ rows: [{ failed: 0 }] }))).rows[0];
      const n = N(r.failed) + N(t.failed);
      add('observability', n ? 'ATTENTION_REQUIRED' : 'READY', `Last 24 hours: ${N(r.failed)} failed booking request(s), ${N(t.failed)} failed AI tool call(s).`, 'Manager', { failedRequests: N(r.failed), failedTools: N(t.failed) },
        n ? 'Some AI booking work failed.' : null, n ? 'Open the recovery list below.' : null);
    });

    void subStatus;
    const overall = SEVERITY.find((s) => out.some((c) => c.status === s && !(s === 'DISABLED' && c.key === 'verification'))) ?? 'READY';
    let runId: string | null = null;
    try {
      const ins: any = (await sql<any>`insert into ai_booking_health_runs (tenant_id, branch_id, overall, checks, checked_by) values (${T}, ${B}, ${overall}, ${JSON.stringify(out)}::jsonb, ${UUID.test(ctx.userId) ? ctx.userId : null}) returning id`.execute(this.db)).rows[0];
      runId = ins?.id ? String(ins.id) : null;
    } catch (e) { console.warn(`ai-booking health run not kept (the result is still shown): ${(e as Error)?.message ?? e}`); }
    return { runId, overall, checkedAt: at, checks: out, note: NOTE };
  }
}
const NOTE = 'This check only reads: it made no appointment, sent no text, used no AI and changed nothing.';
