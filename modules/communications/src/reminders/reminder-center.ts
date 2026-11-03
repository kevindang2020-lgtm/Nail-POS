/**
 * reminder-center.ts — Appointment Reminders Complete Build & Repair Guide (Oct 30 2026): the management center at
 * /tenant/communications/reminders. NOT a second reminder engine: it reads the live appointments, the dispatch record
 * (appointment_reminders_sent, 747), its event trail (appointment_reminder_attempts) and the provider-facing record
 * (notifications + notification_delivery_events, 741). The only writes are the two staff actions, both through the
 * same dispatch record the sweep uses:
 *   cancelPending   a reminder not yet sent → dispatch row 'cancelled' (the sweep's claim then finds it decided)
 *   retry           a failed / fixable-skipped reminder → re-claimed under the guarded transition, re-checked, sent
 *                   through RemindersService.sendClaimed (one send path), idempotent by key, audited.
 *
 * Statuses on screen (guide §8) — the ENGINE's state and the PROVIDER's state are kept apart:
 *   scheduled        derived: a booked future appointment × rung with no dispatch record yet (a reschedule moves it,
 *                    a cancellation removes it — by definition, nothing to invalidate)
 *   short_notice     derived: booked after its reminder time had passed — the engine never sends a late reminder
 *   missed_window    derived: its window passed with no run reaching it (scheduler off / down) — never sent late
 *   claimed          a run holds it right now
 *   submitted        the provider accepted the request (NOT delivered); sent / delivered / undelivered come from the
 *                    provider's own status on the linked notification; simulated = test mode
 *   failed · skipped · cancelled · deferred   the engine's decision, with its reason code
 *
 * KPI bases (guide §14) — one written basis per counter, in the salon's time zone:
 *   scheduled      reminders whose INTENDED send time falls in the period and that have not run yet
 *   sent           reminders the provider accepted, by acceptance time
 *   delivered      provider-confirmed deliveries, by delivery time — Unknown (not 0) while no delivery report was ever received
 *   failed         engine failures + provider undelivered/failed, by the time it was recorded
 *   cancelled      cancelled reminders (rescheduled / cancelled appointment, staff), by the time it was recorded
 *   upcomingToday  reminders due for dispatch TODAY (not every appointment today)
 */
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { withCode, type ApiErrorCode } from '@aipowersalon/api-contracts';
import { REMINDER_DISPATCH } from '../communications-lifecycles';
import { REASON_TEXT, occurrenceKey } from './reminder-core';
import { ladderOf, type RemindersService } from './reminders.service';
import { resolveBoundTemplate } from '../templates/message-templates';

export const RC_TABS = ['upcoming', 'sent', 'delivered', 'failed', 'cancelled', 'skipped', 'all'] as const;
export const RC_BASES = ['created', 'scheduled', 'sent', 'delivered', 'appointment'] as const;
export const RC_PRESETS = ['today', 'week', 'month', 'year', 'custom', 'all'] as const;
export const RC_CHANNELS = ['sms', 'email'] as const;
const PAGE_SIZES = [10, 20, 50];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TZ = process.env.REMINDERS_DEFAULT_TZ || 'America/New_York';
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const n = (v: unknown) => Number(v ?? 0) || 0;
const last4 = (p: unknown) => (p ? String(p).replace(/\D/g, '').slice(-4) || null : null);
const maskEmail = (e: unknown) => { const s = String(e ?? ''); const i = s.indexOf('@'); return i > 0 ? `${s[0]}•••${s.slice(i)}` : null; };
const err = (code: string, message: string, status: number) => withCode(Object.assign(new Error(message), { status, expose: true, code }), code as ApiErrorCode);

export interface RcCtx { tenantId: string; branchId: string | null; userId: string | null; role: string | null; allowedBranches: string[] | null }
export interface RcQuery { tab?: string; q?: string; channel?: string; branchId?: string; basis?: string; preset?: string; from?: string; to?: string; page?: number; pageSize?: number }

/** the provider's word over the engine's: a submitted reminder is "sent" only when the provider says so */
export const EFFECTIVE = sql`(case when d.state = 'submitted' then case n.status when 'delivered' then 'delivered' when 'failed' then 'undelivered' when 'undelivered' then 'undelivered'
  when 'simulated' then 'simulated' when 'sent' then 'sent' else 'submitted' end else d.state end)`;

export class ReminderCenter {
  constructor(private readonly db: Kysely<any>, private readonly svc: RemindersService) {}

  async tz(T: string): Promise<string> {
    const r = await sql<{ tz: string | null }>`select (settings_json ->> 'timezone') as tz from tenant_settings where tenant_id = ${T}::uuid and category = 'business-branch' limit 1`.execute(this.db);
    return r.rows[0]?.tz || DEFAULT_TZ;
  }

  /** salon-local inclusive days → half-open UTC instants (DST-safe: Postgres converts each boundary in the zone) */
  async period(tz: string, q: { preset?: string; from?: string; to?: string }, dflt = 'month') {
    const r = (await sql<{ today: string; wk: string; mo: string; yr: string }>`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as today,
      to_char(date_trunc('week', now() at time zone ${tz})::date, 'YYYY-MM-DD') as wk, to_char(date_trunc('month', now() at time zone ${tz})::date, 'YYYY-MM-DD') as mo,
      to_char(date_trunc('year', now() at time zone ${tz})::date, 'YYYY-MM-DD') as yr`.execute(this.db)).rows[0];
    const preset = (RC_PRESETS as readonly string[]).includes(q.preset ?? '') ? q.preset! : (q.from || q.to ? 'custom' : dflt);
    let from: string | null = null, to: string | null = null;
    if (preset === 'today') { from = r.today; to = r.today; }
    else if (preset === 'week') { from = r.wk; to = r.today; }
    else if (preset === 'month') { from = r.mo; to = r.today; }
    else if (preset === 'year') { from = r.yr; to = r.today; }
    else if (preset === 'custom') {
      from = q.from ?? null; to = q.to ?? null;
      if ((from && !YMD.test(from)) || (to && !YMD.test(to)) || (from && to && from > to)) throw err('REMINDER_INVALID_FILTER', 'Check the dates and filters.', 400);
    }
    return { preset, from, to, today: r.today,
      start: from ? sql`(${from}::date::timestamp at time zone ${tz})` : null,
      end: to ? sql`((${to}::date + 1)::timestamp at time zone ${tz})` : null };
  }

  private inRange(col: RawBuilder<unknown>, p: { start: RawBuilder<unknown> | null; end: RawBuilder<unknown> | null }) {
    const c: RawBuilder<unknown>[] = [];
    if (p.start) c.push(sql`${col} >= ${p.start}`);
    if (p.end) c.push(sql`${col} < ${p.end}`);
    return c.length ? sql.join(c, sql` and `) : sql`true`;
  }
  private branchConds(alias: 'd' | 'u', ctx: RcCtx, branchId?: string) {
    const c: RawBuilder<unknown>[] = [];
    const col = alias === 'd' ? sql.ref('d.branch_id') : sql.ref('u.branch_id');
    if (ctx.allowedBranches) c.push(sql`${col} = any(${ctx.allowedBranches}::uuid[])`);
    if (branchId) { if (!UUID.test(branchId) || (ctx.allowedBranches && !ctx.allowedBranches.includes(branchId))) throw err('BRANCH_ACCESS_DENIED', 'You do not have access to this location.', 403); c.push(sql`${col} = ${branchId}::uuid`); }
    return c;
  }
  private search(q: string | undefined, a: { name: RawBuilder<unknown>; phone: RawBuilder<unknown>; email: RawBuilder<unknown>; tech: RawBuilder<unknown>; ids: RawBuilder<unknown>[] }) {
    const s = (q ?? '').trim().slice(0, 120);
    if (!s) return null;
    const like = `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const digits = s.replace(/\D/g, '');
    const parts = [sql`${a.name} ilike ${like}`, sql`coalesce(${a.email}, '') ilike ${like}`, sql`coalesce(${a.tech}, '') ilike ${like}`];
    if (digits.length >= 3) parts.push(sql`regexp_replace(coalesce(${a.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`);
    if (UUID.test(s)) for (const id of a.ids) parts.push(sql`${id} = ${s}::uuid`);
    return sql`(${sql.join(parts, sql` or `)})`;
  }

  /** derived pending reminders (no dispatch record yet) — the live appointment decides, so a reschedule moves them */
  private upcomingCte(T: string, tz: string) {
    return sql`up as (
      select a.id as appointment_id, r.lead as lead_minutes, a.branch_id, a.customer_id, coalesce(c.full_name, a.customer_name, '') as customer_name,
        coalesce(c.normalized_phone, a.customer_phone) as phone, c.email, tc.full_name as technician_name, a.services, a.created_at as appt_created_at, s.channel,
        (to_char(a.appt_date, 'YYYY-MM-DD') || ' ' || left(a.start_time, 5)) as occ,
        ((a.appt_date::text || ' ' || left(a.start_time, 5))::timestamp at time zone ${tz}) as start_at,
        ((a.appt_date::text || ' ' || left(a.start_time, 5))::timestamp at time zone ${tz}) - make_interval(mins => r.lead) as intended_at,
        s.window_minutes
      from reminder_settings s
      cross join lateral unnest(coalesce(nullif(s.ladder_minutes, '{}'::int[]), array[s.lead_minutes])) as r(lead)
      join pos_tech_appointments a on a.tenant_id = s.tenant_id and a.status in ('booked', 'confirmed')
        and a.appt_date between ((now() at time zone ${tz})::date - 1) and ((now() at time zone ${tz})::date + 15)
      left join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
      left join technicians tc on tc.id = a.technician_id and tc.tenant_id = a.tenant_id
      where s.tenant_id = ${T}::uuid and s.enabled
        and ((a.appt_date::text || ' ' || left(a.start_time, 5))::timestamp at time zone ${tz}) > now()
        and not exists (select 1 from appointment_reminders_sent d where d.tenant_id = a.tenant_id and d.appointment_id = a.id and d.lead_minutes = r.lead
          and d.occurrence_key = (to_char(a.appt_date, 'YYYY-MM-DD') || ' ' || left(a.start_time, 5))))`;
  }
  /** scheduled · short_notice · missed_window */
  private static UPSTATE = sql`(case when u.appt_created_at > u.intended_at then 'short_notice'
    when u.intended_at + make_interval(mins => u.window_minutes) < now() then 'missed_window' else 'scheduled' end)`;

  // ── KPIs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  async kpis(ctx: RcCtx, q: { preset?: string; from?: string; to?: string; branchId?: string }) {
    const T = ctx.tenantId; const tz = await this.tz(T); const p = await this.period(tz, q, 'today');
    const bD = this.branchConds('d', ctx, q.branchId), bU = this.branchConds('u', ctx, q.branchId);
    const wD = bD.length ? sql` and ${sql.join(bD, sql` and `)}` : sql``, wU = bU.length ? sql` and ${sql.join(bU, sql` and `)}` : sql``;
    const today = await this.period(tz, { preset: 'today' });
    const r = (await sql<any>`with ${this.upcomingCte(T, tz)}
      select
        (select count(*) from up u where ${ReminderCenter.UPSTATE} = 'scheduled' and ${this.inRange(sql`u.intended_at`, p)} ${wU}) as scheduled,
        (select count(*) from up u where ${ReminderCenter.UPSTATE} = 'scheduled' and ${this.inRange(sql`u.intended_at`, today)} ${wU})
          + (select count(*) from appointment_reminders_sent d where d.tenant_id = ${T}::uuid and d.state = 'deferred' and ${this.inRange(sql`d.intended_send_at`, today)} ${wD}) as upcoming_today,
        (select count(*) from appointment_reminders_sent d left join notifications n on n.id = d.notification_id
          where d.tenant_id = ${T}::uuid and d.state = 'submitted' and d.reason is distinct from 'legacy_ledger' and ${this.inRange(sql`coalesce(n.created_at, d.updated_at)`, p)} ${wD}) as sent,
        (select count(*) from appointment_reminders_sent d join notifications n on n.id = d.notification_id
          where d.tenant_id = ${T}::uuid and n.status = 'delivered' and ${this.inRange(sql`coalesce(n.delivered_at, n.created_at)`, p)} ${wD}) as delivered,
        (select count(*) from appointment_reminders_sent d left join notifications n on n.id = d.notification_id
          where d.tenant_id = ${T}::uuid and (d.state = 'failed' or (d.state = 'submitted' and n.status in ('failed', 'undelivered'))) and ${this.inRange(sql`d.updated_at`, p)} ${wD}) as failed,
        (select count(*) from appointment_reminders_sent d where d.tenant_id = ${T}::uuid and d.state = 'cancelled' and ${this.inRange(sql`d.updated_at`, p)} ${wD}) as cancelled,
        (select count(*) from notification_delivery_events e join appointment_reminders_sent d on d.notification_id = e.notification_id and d.tenant_id = e.tenant_id where e.tenant_id = ${T}::uuid) as delivery_reports,
        (select max(e.received_at) from notification_delivery_events e join appointment_reminders_sent d on d.notification_id = e.notification_id and d.tenant_id = e.tenant_id where e.tenant_id = ${T}::uuid) as last_report_at
    `.execute(this.db)).rows[0];
    const deliveryKnown = n(r.delivery_reports) > 0;
    return {
      timezone: tz, period: { preset: p.preset, from: p.from, to: p.to },
      scheduled: { value: n(r.scheduled), basis: 'intended_send' }, sent: { value: n(r.sent), basis: 'provider_accepted' },
      delivered: { value: deliveryKnown ? n(r.delivered) : null, known: deliveryKnown, basis: 'provider_delivered', lastReportAt: iso(r.last_report_at) },
      failed: { value: n(r.failed), basis: 'recorded' }, cancelled: { value: n(r.cancelled), basis: 'recorded' },
      upcomingToday: { value: n(r.upcoming_today), basis: 'due_today' },
    };
  }

  // ── list ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  async list(ctx: RcCtx, f: RcQuery) {
    const T = ctx.tenantId; const tz = await this.tz(T);
    const tab = (RC_TABS as readonly string[]).includes(f.tab ?? '') ? f.tab! : 'upcoming';
    const ps = PAGE_SIZES.includes(Number(f.pageSize)) ? Number(f.pageSize) : 20;
    const pg = Math.max(1, Math.floor(Number(f.page)) || 1);
    if (f.channel && !(RC_CHANNELS as readonly string[]).includes(f.channel)) throw err('REMINDER_INVALID_FILTER', 'Check the dates and filters.', 400);
    const p = await this.period(tz, f, 'all');
    const basis = (RC_BASES as readonly string[]).includes(f.basis ?? '') ? f.basis! : (tab === 'upcoming' ? 'scheduled' : 'created');
    if (tab === 'upcoming') {
      const conds = [sql`true`, ...this.branchConds('u', ctx, f.branchId)];
      if (f.channel) conds.push(sql`u.channel = ${f.channel}`);
      conds.push(this.inRange(basis === 'appointment' ? sql`u.start_at` : sql`u.intended_at`, p));
      const s = this.search(f.q, { name: sql`u.customer_name`, phone: sql`u.phone`, email: sql`u.email`, tech: sql`u.technician_name`, ids: [sql`u.appointment_id`, sql`u.customer_id`] });
      if (s) conds.push(s);
      const fetchU = async (pgN: number) => (await sql<any>`with ${this.upcomingCte(T, tz)}
        select u.appointment_id, u.lead_minutes, u.branch_id, u.customer_id, u.customer_name, u.phone, u.email, u.technician_name, u.channel, u.start_at, u.intended_at, ${ReminderCenter.UPSTATE} as state, count(*) over() as total, b.name as branch_name
        from up u left join branches b on b.id = u.branch_id and b.tenant_id = ${T}::uuid
        where ${sql.join(conds, sql` and `)}
        order by u.intended_at asc, u.appointment_id asc, u.lead_minutes desc
        limit ${ps} offset ${(pgN - 1) * ps}`.execute(this.db)).rows;
      const { rows, total, page: pgU } = await this.pastEnd(fetchU, pg, ps);
      return { tab, basis, timezone: tz, period: { preset: p.preset, from: p.from, to: p.to }, page: pgU, pageSize: ps, totalItems: total, totalPages: Math.max(1, Math.ceil(total / ps)),
        items: rows.map((r: any) => ({
          id: `u:${r.appointment_id}:${r.lead_minutes}`, kind: 'upcoming', state: r.state, reasonText: REASON_TEXT[r.state] ?? null,
          appointmentId: r.appointment_id, customerId: r.customer_id, customerName: r.customer_name, phoneLast4: last4(r.phone), emailMasked: maskEmail(r.email),
          hasDestination: r.channel === 'email' ? !!r.email : !!r.phone, technicianName: r.technician_name, branchId: r.branch_id, branchName: r.branch_name,
          channel: r.channel, leadMinutes: n(r.lead_minutes), appointmentStartAt: iso(r.start_at), intendedSendAt: iso(r.intended_at), createdAt: null, sentAt: null, deliveredAt: null,
          providerStatus: null, superseded: false,
        })) };
    }
    const conds = [sql`d.tenant_id = ${T}::uuid`, ...this.branchConds('d', ctx, f.branchId)];
    if (f.channel) conds.push(sql`d.channel = ${f.channel}`);
    if (tab === 'sent') conds.push(sql`${EFFECTIVE} in ('submitted', 'sent', 'simulated', 'delivered')`);
    else if (tab === 'delivered') conds.push(sql`${EFFECTIVE} = 'delivered'`);
    else if (tab === 'failed') conds.push(sql`${EFFECTIVE} in ('failed', 'undelivered')`);
    else if (tab === 'cancelled') conds.push(sql`d.state = 'cancelled'`);
    else if (tab === 'skipped') conds.push(sql`d.state in ('skipped', 'deferred')`);
    const col = basis === 'scheduled' ? sql`d.intended_send_at` : basis === 'sent' ? sql`n.created_at` : basis === 'delivered' ? sql`n.delivered_at` : basis === 'appointment' ? sql`d.appt_start_at` : sql`d.created_at`;
    conds.push(this.inRange(col, p));
    const s = this.search(f.q, { name: sql`coalesce(c.full_name, a.customer_name, '')`, phone: sql`coalesce(c.normalized_phone, a.customer_phone)`, email: sql`c.email`, tech: sql`tc.full_name`, ids: [sql`d.id`, sql`d.appointment_id`, sql`d.customer_id`, sql`d.notification_id`] });
    if (s) conds.push(s);
    const fetchD = async (pgN: number) => (await sql<any>`
      select d.id, d.appointment_id, d.customer_id, d.branch_id, d.channel, d.lead_minutes, d.occurrence_key, d.state, d.reason, d.appt_start_at, d.intended_send_at, d.created_at, d.updated_at, d.attempt_count, d.notification_id, ${EFFECTIVE} as eff, n.status as provider_status, n.created_at as sent_at, n.delivered_at, n.provider_error_code,
        coalesce(c.full_name, a.customer_name, '') as customer_name, coalesce(c.normalized_phone, a.customer_phone) as phone, c.email, tc.full_name as technician_name, b.name as branch_name,
        (a.id is null or a.status not in ('booked', 'confirmed') or (to_char(a.appt_date, 'YYYY-MM-DD') || ' ' || left(a.start_time, 5)) <> d.occurrence_key) as superseded,
        a.status as appt_status, count(*) over() as total
      from appointment_reminders_sent d
      left join pos_tech_appointments a on a.id = d.appointment_id and a.tenant_id = d.tenant_id
      left join customers c on c.id = coalesce(d.customer_id, a.customer_id) and c.tenant_id = d.tenant_id
      left join technicians tc on tc.id = a.technician_id and tc.tenant_id = d.tenant_id
      left join notifications n on n.id = d.notification_id and n.tenant_id = d.tenant_id
      left join branches b on b.id = coalesce(d.branch_id, a.branch_id) and b.tenant_id = d.tenant_id
      where ${sql.join(conds, sql` and `)}
      order by d.created_at desc, d.id desc
      limit ${ps} offset ${(pgN - 1) * ps}`.execute(this.db)).rows;
    const { rows, total, page: pgD } = await this.pastEnd(fetchD, pg, ps);
    return { tab, basis, timezone: tz, period: { preset: p.preset, from: p.from, to: p.to }, page: pgD, pageSize: ps, totalItems: total, totalPages: Math.max(1, Math.ceil(total / ps)), items: rows.map((r: any) => this.rowOut(r)) };
  }

  /** count(*) over() is only on returned rows: a page past the end used to say "0 total". Re-read the first page for the count and
   *  show the last real page instead. */
  private async pastEnd(fetch: (page: number) => Promise<any[]>, pg: number, ps: number): Promise<{ rows: any[]; total: number; page: number }> {
    const rows = await fetch(pg);
    if (rows.length || pg <= 1) return { rows, total: rows.length ? n(rows[0].total) : 0, page: pg };
    const first = await fetch(1);
    const total = first.length ? n(first[0].total) : 0;
    const last = Math.max(1, Math.ceil(total / ps));
    return last === 1 ? { rows: first, total, page: 1 } : { rows: await fetch(last), total, page: last };
  }

  private rowOut(r: any) {
    return {
      id: r.id, kind: 'dispatch', state: r.eff, engineState: r.state, reason: r.reason, reasonText: r.reason ? REASON_TEXT[r.reason] ?? null : null,
      appointmentId: r.appointment_id, customerId: r.customer_id, customerName: r.customer_name, phoneLast4: last4(r.phone), emailMasked: maskEmail(r.email),
      technicianName: r.technician_name ?? null, branchId: r.branch_id, branchName: r.branch_name ?? null, channel: r.channel, leadMinutes: n(r.lead_minutes),
      occurrenceKey: r.occurrence_key, appointmentStartAt: iso(r.appt_start_at), intendedSendAt: iso(r.intended_send_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      sentAt: iso(r.sent_at), deliveredAt: iso(r.delivered_at), providerStatus: r.provider_status ?? null, providerErrorCode: r.provider_error_code ?? null,
      attempts: n(r.attempt_count), notificationId: r.notification_id ?? null, superseded: !!r.superseded, appointmentStatus: r.appt_status ?? null,
      retryable: this.retryable(r).ok,
    };
  }

  /** the Safe Retry precondition on the RECORD (the appointment / provider checks run at retry time) */
  retryable(r: { state: string; reason: string | null; provider_status?: string | null; eff?: string }): { ok: boolean; why: string | null } {
    if (r.state === 'failed') return { ok: true, why: null };
    if (r.state === 'skipped' && (r.reason === 'no_destination' || r.reason === 'quiet_hours')) return { ok: true, why: null };
    if (r.state === 'submitted') return { ok: false, why: 'already_submitted' };
    return { ok: false, why: r.state };
  }

  // ── details ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async details(ctx: RcCtx, id: string) {
    const T = ctx.tenantId; const tz = await this.tz(T);
    const cfg = await this.svc.getConfig(T);
    const rule = { enabled: !!cfg.enabled, leadMinutes: cfg.leadMinutes, windowMinutes: cfg.windowMinutes, channel: cfg.channel, ladderMinutes: ladderOf(cfg) };
    const m = /^u:([0-9a-f-]{36}):(\d+)$/i.exec(id);
    if (m) {
      const list = await this.list(ctx, { tab: 'upcoming', q: m[1], pageSize: 50 });
      const it = list.items.find((x) => x.id === id);
      if (!it) throw err('REMINDER_NOT_FOUND', 'That reminder could not be found.', 404);
      const tpl = await this.templateOf(T, it.branchId ?? null, it.channel);
      return { item: it, rule, template: tpl, attempts: [], deliveryEvents: [], timezone: tz };
    }
    if (!UUID.test(id)) throw err('REMINDER_NOT_FOUND', 'That reminder could not be found.', 404);
    const bc = this.branchConds('d', ctx);
    const r = (await sql<any>`
      select d.id, d.appointment_id, d.customer_id, d.branch_id, d.channel, d.lead_minutes, d.occurrence_key, d.state, d.reason, d.appt_start_at, d.intended_send_at, d.created_at, d.updated_at, d.attempt_count, d.notification_id, ${EFFECTIVE} as eff, n.status as provider_status, n.created_at as sent_at, n.delivered_at, n.provider_error_code, n.provider_id, n.failure_reason,
        coalesce(c.full_name, a.customer_name, '') as customer_name, coalesce(c.normalized_phone, a.customer_phone) as phone, c.email, tc.full_name as technician_name, b.name as branch_name,
        (a.id is null or a.status not in ('booked', 'confirmed') or (to_char(a.appt_date, 'YYYY-MM-DD') || ' ' || left(a.start_time, 5)) <> d.occurrence_key) as superseded, a.status as appt_status
      from appointment_reminders_sent d
      left join pos_tech_appointments a on a.id = d.appointment_id and a.tenant_id = d.tenant_id
      left join customers c on c.id = coalesce(d.customer_id, a.customer_id) and c.tenant_id = d.tenant_id
      left join technicians tc on tc.id = a.technician_id and tc.tenant_id = d.tenant_id
      left join notifications n on n.id = d.notification_id and n.tenant_id = d.tenant_id
      left join branches b on b.id = coalesce(d.branch_id, a.branch_id) and b.tenant_id = d.tenant_id
      where d.tenant_id = ${T}::uuid and d.id = ${id}::uuid ${bc.length ? sql` and ${sql.join(bc, sql` and `)}` : sql``}`.execute(this.db)).rows[0];
    if (!r) throw err('REMINDER_NOT_FOUND', 'That reminder could not be found.', 404);
    const attempts = (await sql<any>`select id, status, error, kind, notification_id, actor_user_id, note, created_at from appointment_reminder_attempts
      where tenant_id = ${T}::uuid and (dispatch_id = ${id}::uuid or (dispatch_id is null and appointment_id = ${r.appointment_id}::uuid)) order by created_at asc, id asc limit 200`.execute(this.db)).rows;
    const events = r.notification_id ? (await sql<any>`select provider_status, error_code, applied, signature_verified, received_at from notification_delivery_events
      where tenant_id = ${T}::uuid and notification_id in (select distinct notification_id from appointment_reminder_attempts where dispatch_id = ${id}::uuid and notification_id is not null union select ${r.notification_id}::uuid)
      order by received_at asc limit 100`.execute(this.db)).rows : [];
    const usage = (await sql<{ template_id: string; version: number }>`select template_id, template_version as version from pos_message_template_usage where tenant_id = ${T}::uuid and workflow = 'appointment_reminder' and appointment_id = ${r.appointment_id}::uuid order by created_at desc limit 1`.execute(this.db)).rows[0];
    return {
      item: { ...this.rowOut(r), providerReference: r.provider_id ? `…${String(r.provider_id).slice(-6)}` : null, failureReason: r.failure_reason ?? null },
      rule, template: usage ? { templateId: usage.template_id, version: n(usage.version), source: 'salon_template' } : { templateId: null, version: null, source: 'built_in' },
      attempts: attempts.map((a: any) => ({ id: String(a.id), status: a.status, reason: a.error, reasonText: a.error ? REASON_TEXT[a.error] ?? null : null, kind: a.kind, notificationId: a.notification_id, byStaff: !!a.actor_user_id, note: a.note, at: iso(a.created_at) })),
      deliveryEvents: events.map((e: any) => ({ providerStatus: e.provider_status, errorCode: e.error_code, applied: !!e.applied, signatureVerified: !!e.signature_verified, at: iso(e.received_at) })),
      timezone: tz,
    };
  }
  private async templateOf(T: string, branchId: string | null, channel: string) {
    const b = await resolveBoundTemplate(this.db, T, branchId, 'appointment_reminder', channel === 'email' ? 'email' : 'sms');
    return b ? { templateId: b.templateId, version: b.version, source: 'salon_template' } : { templateId: null, version: null, source: 'built_in' };
  }

  // ── staff actions ─────────────────────────────────────────────────────────────────────────────────────────────────
  private audit(x: Kysely<any>, ctx: RcCtx, action: string, id: string | null, summary: string, metadata: Record<string, unknown>) {
    return recordAuditStrict(x, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'communications', action, resourceType: 'appointment_reminder', resourceId: id, summary, status: 'success', severity: 'info', metadata });
  }

  /** a reminder that has not been sent: the upcoming one (u:appointment:lead) or a deferred / failed record → cancelled */
  async cancelPending(ctx: RcCtx, id: string, reason: string) {
    const why = String(reason ?? '').trim();
    if (why.length < 3 || why.length > 300) throw err('REMINDER_REASON_REQUIRED', 'Enter a reason (3–300 characters).', 400);
    const T = ctx.tenantId; const tz = await this.tz(T);
    const m = /^u:([0-9a-f-]{36}):(\d+)$/i.exec(id);
    return this.db.transaction().execute(async (trx: Kysely<any>) => {
      if (m) {
        const a = (await sql<any>`select a.id, a.status, a.branch_id, a.customer_id, to_char(a.appt_date, 'YYYY-MM-DD') as d, left(a.start_time, 5) as t,
            ((a.appt_date::text || ' ' || left(a.start_time, 5))::timestamp at time zone ${tz}) as start_at
          from pos_tech_appointments a where a.id = ${m[1]}::uuid and a.tenant_id = ${T}::uuid for update`.execute(trx)).rows[0];
        if (!a || (ctx.allowedBranches && !ctx.allowedBranches.includes(a.branch_id))) throw err('REMINDER_NOT_FOUND', 'That reminder could not be found.', 404);
        if (!['booked', 'confirmed'].includes(a.status) || new Date(a.start_at).getTime() <= Date.now()) throw err('REMINDER_APPOINTMENT_CHANGED', 'The appointment changed.', 409);
        const lead = Number(m[2]); const occ = occurrenceKey(a.d, a.t); const cfg = await this.svc.getConfig(T);
        const ins = (await sql<{ id: string }>`insert into appointment_reminders_sent (tenant_id, appointment_id, lead_minutes, occurrence_key, state, reason, channel, branch_id, customer_id,
            intended_send_at, appt_start_at, reminded_at, created_at, updated_at, updated_by)
          values (${T}, ${a.id}, ${lead}, ${occ}, 'cancelled', 'staff_cancelled', ${cfg.channel}, ${a.branch_id}, ${a.customer_id}, ${a.start_at}::timestamptz - make_interval(mins => ${lead}), ${a.start_at}, now(), now(), now(), ${ctx.userId})
          on conflict (tenant_id, appointment_id, lead_minutes, occurrence_key) do nothing returning id`.execute(trx)).rows[0];
        if (!ins) throw err('REMINDER_NOT_CANCELLABLE', 'Only a reminder that has not been sent yet can be cancelled.', 409);
        await sql`insert into appointment_reminder_attempts (tenant_id, appointment_id, channel, status, error, dispatch_id, kind, actor_user_id, occurrence_key, note)
          values (${T}, ${a.id}, ${cfg.channel}, 'cancelled', 'staff_cancelled', ${ins.id}, 'staff_cancel', ${ctx.userId}, ${occ}, ${why})`.execute(trx);
        await this.audit(trx, ctx, 'appointment_reminder.cancelled', ins.id, 'Pending appointment reminder cancelled by staff', { appointmentId: a.id, leadMinutes: lead, occurrence: occ, reason: why });
        return { id: ins.id, state: 'cancelled' };
      }
      if (!UUID.test(id)) throw err('REMINDER_NOT_FOUND', 'That reminder could not be found.', 404);
      const d = (await sql<any>`update appointment_reminders_sent set state = 'cancelled', reason = 'staff_cancelled', updated_at = now(), updated_by = ${ctx.userId}
        where id = ${id}::uuid and tenant_id = ${T}::uuid and state in ('deferred', 'failed') and ${canMoveToSql(REMINDER_DISPATCH, 'cancelled')}
        ${ctx.allowedBranches ? sql`and branch_id = any(${ctx.allowedBranches}::uuid[])` : sql``}
        returning id, appointment_id, channel, occurrence_key`.execute(trx)).rows[0];
      if (!d) throw err('REMINDER_NOT_CANCELLABLE', 'Only a reminder that has not been sent yet can be cancelled.', 409);
      await sql`insert into appointment_reminder_attempts (tenant_id, appointment_id, channel, status, error, dispatch_id, kind, actor_user_id, occurrence_key, note)
        values (${T}, ${d.appointment_id}, ${d.channel}, 'cancelled', 'staff_cancelled', ${d.id}, 'staff_cancel', ${ctx.userId}, ${d.occurrence_key}, ${why})`.execute(trx);
      await this.audit(trx, ctx, 'appointment_reminder.cancelled', d.id, 'Appointment reminder cancelled by staff', { appointmentId: d.appointment_id, reason: why });
      return { id: d.id, state: 'cancelled' };
    });
  }

  /** Safe Retry (guide §11): one failed / fixable-skipped reminder, after re-checking the appointment, the destination,
   *  the provider and whether an earlier attempt may already have reached the customer. Idempotent by key. */
  async retry(ctx: RcCtx, id: string, body: { idempotencyKey?: string; reason?: string; confirm?: boolean; acknowledgeDuplicateRisk?: boolean }) {
    const T = ctx.tenantId;
    const key = String(body?.idempotencyKey ?? '').trim();
    if (!UUID.test(id)) throw err('REMINDER_NOT_FOUND', 'That reminder could not be found.', 404);
    if (key.length < 8 || key.length > 100) throw err('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key required', 400);
    if (!body?.confirm) throw err('REMINDER_CONFIRM_REQUIRED', 'Confirm the retry.', 400);
    const why = String(body?.reason ?? '').trim();
    if (why.length < 3 || why.length > 300) throw err('REMINDER_REASON_REQUIRED', 'Enter a reason (3–300 characters).', 400);
    // the same key again (a double tap, a lost answer): the first answer, never a second send
    const prior = (await sql<any>`select dispatch_id from appointment_reminder_attempts where tenant_id = ${T}::uuid and idempotency_key = ${key} limit 1`.execute(this.db)).rows[0];
    if (prior) { const dd = await this.details(ctx, prior.dispatch_id); return { replayed: true, id: prior.dispatch_id, state: dd.item.state }; }
    const tz = await this.tz(T); const cfg = await this.svc.getConfig(T); const meta = await this.svc.meta(T);
    const dp = this.svc.dispatchPort;
    if (!dp) throw err('SERVICE_UNAVAILABLE', 'Reminders are not available here.', 503);
    const d = (await sql<any>`select d.id, d.appointment_id, d.customer_id, d.branch_id, d.channel, d.lead_minutes, d.occurrence_key, d.state, d.reason, d.appt_start_at, d.intended_send_at, d.created_at, d.updated_at, d.attempt_count, d.notification_id, n.status as provider_status from appointment_reminders_sent d left join notifications n on n.id = d.notification_id
      where d.id = ${id}::uuid and d.tenant_id = ${T}::uuid ${ctx.allowedBranches ? sql`and d.branch_id = any(${ctx.allowedBranches}::uuid[])` : sql``}`.execute(this.db)).rows[0];
    if (!d) throw err('REMINDER_NOT_FOUND', 'That reminder could not be found.', 404);
    if (d.state === 'submitted' || ['sent', 'delivered', 'simulated'].includes(String(d.provider_status))) throw err('REMINDER_ALREADY_DELIVERED', 'Already accepted by the provider.', 409);
    if (!this.retryable(d).ok) throw err('REMINDER_NOT_RETRYABLE', 'This reminder cannot be retried.', 409);
    if (d.reason === 'interrupted_unknown' && !body.acknowledgeDuplicateRisk) throw err('REMINDER_CONFIRM_REQUIRED', 'The earlier attempt may have reached the customer — confirm the duplicate-send risk.', 400);
    // the appointment: still booked, at this occurrence, more than 15 minutes away
    const apptDate = String(d.occurrence_key).slice(0, 10);
    const cand = await this.svc.candidateFor(T, d.appointment_id, d.channel, tz, apptDate);
    if (!cand || occurrenceKey(cand.apptDate, cand.startTime) !== d.occurrence_key || cand.startsAtMs <= Date.now() + 15 * 60_000) throw err('REMINDER_APPOINTMENT_CHANGED', 'The appointment changed.', 409);
    if (!cand.address) throw err('REMINDER_NOT_RETRYABLE', 'The customer has no phone number / email for this channel.', 409);
    const prov = await this.providerReady(T, d.channel);
    if (!prov.ready) throw err('REMINDER_PROVIDER_NOT_READY', prov.summary, 409);
    // the guarded transition → claimed (one retry wins; a concurrent second one finds it already claimed)
    const won = await this.db.transaction().execute(async (trx: Kysely<any>) => {
      const r = (await sql<any>`update appointment_reminders_sent set state = 'claimed', reason = null, attempt_count = attempt_count + 1, channel = ${cfg.channel === d.channel ? d.channel : d.channel}, updated_at = now(), updated_by = ${ctx.userId}
        where id = ${id}::uuid and tenant_id = ${T}::uuid and state = ${d.state} and ${canMoveToSql(REMINDER_DISPATCH, 'claimed')} returning id`.execute(trx)).rows[0];
      if (!r) return false;
      await sql`insert into appointment_reminder_attempts (tenant_id, appointment_id, channel, status, error, dispatch_id, kind, actor_user_id, idempotency_key, occurrence_key, note)
        values (${T}, ${d.appointment_id}, ${d.channel}, 'retry_requested', ${d.reason}, ${id}, 'manual_retry', ${ctx.userId}, ${key}, ${d.occurrence_key}, ${why})`.execute(trx);
      await this.audit(trx, ctx, 'appointment_reminder.retried', id, 'Appointment reminder retried by staff', { appointmentId: d.appointment_id, previousState: d.state, previousReason: d.reason, reason: why, duplicateRiskAcknowledged: !!body.acknowledgeDuplicateRisk });
      return true;
    });
    if (!won) throw err('REMINDER_NOT_RETRYABLE', 'This reminder is already being retried or has changed.', 409);
    const lead = n(d.lead_minutes);
    const out = await this.svc.sendClaimed(dp, T, id, cand, d.channel, meta.salonName, lead, tz, Date.now(), { kind: 'manual_retry', actorUserId: ctx.userId, note: why });
    return { replayed: false, id, state: out };
  }

  /** SMS: the salon's Twilio account + sender, validated ("Connected" alone is not proof). Email: a provider key is set
   *  in this environment (name only). The full six-part check lives in Text Messaging Setup. */
  async providerReady(T: string, channel: string): Promise<{ ready: boolean; state: string; summary: string }> {
    if (channel === 'email') {
      const has = !!String(process.env.SENDGRID_API_KEY ?? '').trim();
      return has ? { ready: true, state: 'ready', summary: 'An email provider key is set (SENDGRID_API_KEY).' }
        : process.env.NODE_ENV === 'production' ? { ready: false, state: 'attention_required', summary: 'No email provider is configured (SENDGRID_API_KEY is not set).' }
        : { ready: true, state: 'test_mode', summary: 'No email provider key: emails are recorded as simulated (test mode), never delivered.' };
    }
    const c = (await sql<{ status: string; last_validated_at: unknown; last_validation_error: string | null; has_from: boolean; has_svc: boolean }>`select status, last_validated_at, last_validation_error, (from_number is not null) as has_from, (messaging_service_sid is not null) as has_svc
      from tenant_messaging_credentials where tenant_id = ${T}::uuid and provider = 'twilio' order by branch_id nulls first limit 1`.execute(this.db)).rows[0];
    if (!c) return { ready: false, state: 'attention_required', summary: 'No Twilio account is connected for this salon.' };
    if (c.last_validation_error) return { ready: false, state: 'failed', summary: 'The last Twilio check failed.' };
    if (!c.has_from && !c.has_svc) return { ready: false, state: 'attention_required', summary: 'Twilio is connected but has no sending number.' };
    if (!c.last_validated_at) return { ready: true, state: 'pending', summary: 'Twilio is set but has never been checked — run the check in Text Messaging Setup.' };
    return { ready: true, state: 'ready', summary: 'Twilio account and sender are set and were checked.' };
  }

  // ── health (guide §11) ────────────────────────────────────────────────────────────────────────────────────────────
  async health(ctx: RcCtx) {
    const T = ctx.tenantId; const tz = await this.tz(T); const cfg = await this.svc.getConfig(T);
    const cron = ['1', 'true', 'yes', 'on'].includes(String(process.env.REMINDER_CRON_ENABLED ?? '').trim().toLowerCase());
    const runs = (await sql<any>`select
        (select max(finished_at) from appointment_reminder_runs where tenant_id = ${T}::uuid and outcome in ('ok', 'partial')) as last_ok,
        (select max(started_at) from appointment_reminder_runs where tenant_id = ${T}::uuid) as last_start,
        (select count(*) from appointment_reminder_runs where tenant_id = ${T}::uuid and outcome = 'failed' and started_at > now() - interval '24 hours') as failed_runs,
        (select count(*) from appointment_reminders_sent where tenant_id = ${T}::uuid and state = 'claimed' and updated_at < now() - interval '15 minutes') as stale_claims,
        (select count(*) from appointment_reminders_sent where tenant_id = ${T}::uuid and state = 'deferred') as deferred,
        (select count(*) from appointment_reminders_sent where tenant_id = ${T}::uuid and state = 'failed' and updated_at > now() - interval '24 hours') as failed_24h,
        (select count(*) from appointment_reminders_sent where tenant_id = ${T}::uuid and state = 'failed' and channel = 'email' and updated_at > now() - interval '24 hours') as email_failed_24h,
        (select count(*) from appointment_reminders_sent d join notifications n on n.id = d.notification_id where d.tenant_id = ${T}::uuid and d.state = 'submitted'
           and n.status in ('sent', 'submitted', 'queued', 'accepted') and n.created_at < now() - interval '24 hours' and n.created_at > now() - interval '14 days') as awaiting_reports,
        (select max(e.received_at) from notification_delivery_events e join appointment_reminders_sent d on d.notification_id = e.notification_id and d.tenant_id = e.tenant_id where e.tenant_id = ${T}::uuid) as last_report_at,
        (select count(*) from appointment_reminders_sent d join pos_tech_appointments a on a.id = d.appointment_id and a.tenant_id = d.tenant_id
           where d.tenant_id = ${T}::uuid and d.state = 'submitted' and d.updated_at > now() - interval '7 days'
             and (a.status not in ('booked', 'confirmed') or (to_char(a.appt_date, 'YYYY-MM-DD') || ' ' || left(a.start_time, 5)) <> d.occurrence_key)) as changed_after_send
      `.execute(this.db)).rows[0];
    const up = (await sql<any>`with ${this.upcomingCte(T, tz)} select
        count(*) filter (where ${ReminderCenter.UPSTATE} = 'missed_window' and u.intended_at > now() - interval '24 hours') as missed,
        min(u.intended_at) filter (where ${ReminderCenter.UPSTATE} = 'scheduled' and u.intended_at < now()) as oldest_due
      from up u`.execute(this.db)).rows[0];
    const lagMin = up.oldest_due ? Math.round((Date.now() - new Date(up.oldest_due).getTime()) / 60000) : 0;
    const lastOk = runs.last_ok ? new Date(runs.last_ok).getTime() : null;
    const sinceOk = lastOk ? Math.round((Date.now() - lastOk) / 60000) : null;
    const items = [] as { key: string; state: string; summary: string; evidence: string; checkedAt: string | null; nextAction: string | null }[];
    // scheduler
    if (!cfg.enabled) items.push({ key: 'scheduler', state: 'off', summary: 'Appointment reminders are turned off for this salon.', evidence: 'reminder_settings.enabled = false', checkedAt: null, nextAction: 'Turn on “Send appointment reminders” and save.' });
    else if (sinceOk === null) items.push({ key: 'scheduler', state: cron ? 'unknown' : 'attention_required', summary: 'No reminder run has been recorded for this salon yet.', evidence: `REMINDER_CRON_ENABLED is ${cron ? 'on' : 'off'} in this environment; no appointment_reminder_runs row`, checkedAt: null, nextAction: cron ? 'Wait for the next 5-minute run, then refresh.' : 'Ask the platform team to enable the reminder scheduler (REMINDER_CRON_ENABLED) or an external call to /jobs/appointment-reminders.' });
    else if (sinceOk > 15 || n(up.missed) > 0 || lagMin > 15) items.push({ key: 'scheduler', state: 'attention_required', summary: `Last successful run ${sinceOk} min ago${n(up.missed) ? `; ${n(up.missed)} reminder(s) missed their window in the last 24 h` : ''}${lagMin > 15 ? `; oldest due reminder waiting ${lagMin} min` : ''}.`, evidence: `appointment_reminder_runs; failed runs 24 h: ${n(runs.failed_runs)}`, checkedAt: iso(runs.last_ok), nextAction: 'Check the reminder scheduler; missed reminders are never sent late.' });
    else items.push({ key: 'scheduler', state: n(runs.failed_runs) > 0 ? 'attention_required' : 'ready', summary: `Last successful run ${sinceOk} min ago.${n(runs.failed_runs) ? ` ${n(runs.failed_runs)} failed run(s) in 24 h.` : ''}`, evidence: `appointment_reminder_runs; queue lag ${lagMin} min`, checkedAt: iso(runs.last_ok), nextAction: n(runs.failed_runs) ? 'Look at the failed runs in the server log.' : null });
    // providers
    const sms = await this.providerReady(T, 'sms');
    items.push({ key: 'twilio', state: cfg.channel === 'sms' ? sms.state : sms.ready ? 'ready' : 'off', summary: sms.summary, evidence: 'tenant_messaging_credentials (no secret is read)', checkedAt: null, nextAction: sms.ready && sms.state === 'ready' ? null : 'Open Communications → Text Messaging Setup and run Check SMS System.' });
    const em = await this.providerReady(T, 'email');
    items.push({ key: 'email', state: cfg.channel === 'email' ? (n(runs.email_failed_24h) ? 'attention_required' : em.state) : 'off', summary: `${em.summary}${n(runs.email_failed_24h) ? ` ${n(runs.email_failed_24h)} email reminder(s) failed in 24 h.` : ''}`, evidence: 'environment variable name only; email reminder failures 24 h', checkedAt: null, nextAction: em.ready ? null : 'Set up the email provider (Communications → Email).' });
    // booking sync
    items.push({ key: 'booking_sync', state: n(runs.stale_claims) ? 'attention_required' : 'ready',
      summary: n(runs.stale_claims) ? `${n(runs.stale_claims)} reminder(s) were claimed but never finished (a run was interrupted); the next run resolves them.` : `Reminders follow the live appointment: ${n(runs.deferred)} deferred by quiet hours; ${n(runs.changed_after_send)} appointment(s) changed after their reminder went out (7 days).`,
      evidence: 'appointment_reminders_sent (claimed > 15 min); occurrence vs live appointment', checkedAt: null, nextAction: n(runs.stale_claims) ? 'Interrupted sends are marked “unknown” and never retried automatically — review them under Failed.' : null });
    // history / callbacks
    items.push({ key: 'history', state: !runs.last_report_at ? 'unknown' : n(runs.awaiting_reports) ? 'attention_required' : 'ready',
      summary: !runs.last_report_at ? 'No delivery report has ever been received for a reminder — delivery is Unknown, not 0.' : n(runs.awaiting_reports) ? `${n(runs.awaiting_reports)} reminder(s) accepted more than 24 h ago still have no delivery report.` : 'Delivery reports are arriving.',
      evidence: 'notification_delivery_events for reminder notifications', checkedAt: iso(runs.last_report_at), nextAction: !runs.last_report_at || n(runs.awaiting_reports) ? 'Check the Twilio status callback in Text Messaging Setup (Delivery part).' : null });
    const overall = items.some((i) => i.state === 'failed') ? 'failed' : items.some((i) => i.state === 'attention_required') ? 'attention_required' : items.some((i) => i.state === 'unknown' || i.state === 'pending') ? 'unknown' : !cfg.enabled ? 'off' : 'ready';
    return { overall, items, timezone: tz, schedulerEnabledHere: cron, checkedAt: new Date().toISOString() };
  }

  // ── customer reminder history (guide §10) ─────────────────────────────────────────────────────────────────────────
  async customerHistory(ctx: RcCtx, customerId: string, page = 1, pageSize = 10) {
    if (!UUID.test(customerId)) throw err('REMINDER_NOT_FOUND', 'That reminder could not be found.', 404);
    const T = ctx.tenantId;
    const ok = (await sql<any>`select 1 from customers where id = ${customerId}::uuid and tenant_id = ${T}::uuid`.execute(this.db)).rows.length;
    if (!ok) throw err('REMINDER_NOT_FOUND', 'That reminder could not be found.', 404);
    const ps = PAGE_SIZES.includes(Number(pageSize)) ? Number(pageSize) : 10; const pg = Math.max(1, Math.floor(Number(page)) || 1);
    const bc = this.branchConds('d', ctx);
    const rows = (await sql<any>`
      select d.id, d.appointment_id, d.customer_id, d.branch_id, d.channel, d.lead_minutes, d.occurrence_key, d.state, d.reason, d.appt_start_at, d.intended_send_at, d.created_at, d.updated_at, d.attempt_count, d.notification_id, ${EFFECTIVE} as eff, n.status as provider_status, n.created_at as sent_at, n.delivered_at, n.provider_error_code,
        coalesce(c.full_name, a.customer_name, '') as customer_name, coalesce(c.normalized_phone, a.customer_phone) as phone, c.email, tc.full_name as technician_name, b.name as branch_name,
        (a.id is null or a.status not in ('booked', 'confirmed') or (to_char(a.appt_date, 'YYYY-MM-DD') || ' ' || left(a.start_time, 5)) <> d.occurrence_key) as superseded, a.status as appt_status, count(*) over() as total
      from appointment_reminders_sent d
      left join pos_tech_appointments a on a.id = d.appointment_id and a.tenant_id = d.tenant_id
      left join customers c on c.id = coalesce(d.customer_id, a.customer_id) and c.tenant_id = d.tenant_id
      left join technicians tc on tc.id = a.technician_id and tc.tenant_id = d.tenant_id
      left join notifications n on n.id = d.notification_id and n.tenant_id = d.tenant_id
      left join branches b on b.id = coalesce(d.branch_id, a.branch_id) and b.tenant_id = d.tenant_id
      where d.tenant_id = ${T}::uuid and (d.customer_id = ${customerId}::uuid or a.customer_id = ${customerId}::uuid) ${bc.length ? sql` and ${sql.join(bc, sql` and `)}` : sql``}
      order by d.created_at desc, d.id desc limit ${ps} offset ${(pg - 1) * ps}`.execute(this.db)).rows;
    const ids = rows.map((r) => r.id);
    const ev = ids.length ? (await sql<any>`select dispatch_id, status, error, kind, created_at from appointment_reminder_attempts where tenant_id = ${T}::uuid and dispatch_id = any(${ids}::uuid[]) order by created_at asc, id asc`.execute(this.db)).rows : [];
    const total = rows.length ? n(rows[0].total) : 0;
    return { page: pg, pageSize: ps, totalItems: total, totalPages: Math.max(1, Math.ceil(total / ps)),
      items: rows.map((r) => ({ ...this.rowOut(r), events: ev.filter((e: any) => e.dispatch_id === r.id).map((e: any) => ({ status: e.status, reason: e.error, reasonText: e.error ? REASON_TEXT[e.error] ?? null : null, kind: e.kind, at: iso(e.created_at) })) })) };
  }
}
