// ai-follow-up-center.ts — AI Follow-Ups & Human Handoff Center (AI Follow-Ups Complete Build Guide, Oct 31 2026).
//
// One task system: ai_receptionist_follow_ups (migration 303) + migration 759. This file is the server half of
// /tenant/ai/receptionist/follow-ups:
//   • KPIs, search (customer / phone / email / task / call / appointment / assignee), filters, salon-local From/To with a
//     stated date basis, numbered pages 10/20/50, newest-first or priority order (overdue urgent first)
//   • create (idempotent per request key), assign (active staff in this branch only), status lifecycle with the canonical
//     machine (AI_RECEPTIONIST_FOLLOW_UP), notes, priority override (manager + reason), escalate — every write checks the
//     row version, writes append-only activity and an audit event in the SAME transaction
//   • contact attempts: a staff-recorded phone outcome (an attestation, labelled so) or a text sent through the Reception
//     Copilot's prepare → confirm → verify path (consent, opt-out, +country, sender) — "submitted" is never "delivered"
//   • the full overlay (overview, customer, original AI call, attempts, booking & messages, assignments & audit)
//   • Check Follow-Up System (read-only; 8 domains), the Priority & Escalation Assistant (recommendations only), and the
//     overdue escalation job (one owner alert per task per rule).
// Nothing here places a call, sends a text without the Copilot confirmation, changes a booking or resolves on its own.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { utcDate } from '@aipowersalon/date-time';
import { randomUUID } from 'node:crypto';
import { branchTimeZone, canMoveToSql } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { hasPermission } from '@aipowersalon/permissions';
import { AI_RECEPTIONIST_FOLLOW_UP } from '../ai-lifecycles';
import { maskPhone } from './reception-copilot-context.service';

type Row = Record<string, any>;
export const AI_FOLLOW_UP_CENTER = Symbol('AI_FOLLOW_UP_CENTER');
export const FU_STATUS_CHIPS = ['open', 'assigned', 'in_progress', 'waiting', 'resolved', 'all'] as const;
export const FU_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export const FU_SOURCES = ['ai', 'manual', 'complaint', 'missed_call', 'copilot'] as const;
/** A13 Nov 6: a missed call = the caller hung up in under this many seconds (same as AI Receptionist / AI Calls) */
export const FU_MISSED_SECONDS = 15;
export const FU_BASES = ['created', 'due', 'updated', 'call', 'assigned', 'first_response', 'last_contact', 'resolved'] as const;
export const FU_SORTS = ['newest', 'priority', 'due'] as const;
export const FU_CREATE_REASONS = ['CALLBACK', 'COMPLAINT', 'BOOKING_HELP', 'FAILED_TRANSFER', 'VERIFICATION_ISSUE', 'OTHER'] as const;
export const FU_RESOLUTIONS = ['customer_reached', 'booked', 'issue_resolved', 'no_action_needed', 'unreachable', 'duplicate', 'referred_to_manager'] as const;
export const FU_ATTEMPT_CHANNELS = ['phone_call', 'in_person', 'email'] as const;
export const FU_ATTEMPT_OUTCOMES = ['reached', 'no_answer', 'voicemail', 'wrong_number', 'requested_later', 'resolved', 'escalated'] as const;
export const FU_PERIODS = ['all', 'today', 'week', 'month', 'year', 'custom'] as const;
const ACTIVE = ['open', 'assigned', 'in_progress', 'waiting'];
const ASSIGNABLE_ROLES = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION'];
/** the task columns every read uses (no whole-row reads) */
/** The overdue alert key: one alert per due time and per reopening. A task whose due time is moved, or that is reopened, and then
 *  goes overdue again alerts again (it used to stay silent forever after its first overdue alert). */
const OVERDUE_RULE = sql<string>`('overdue:' || floor(extract(epoch from f.due_at))::bigint::text || ':' || f.reopened_count::text)`;
const FU_COLS = sql.raw(`f.id, f.tenant_id, f.branch_id, f.reason, f.priority, f.status, f.customer_id, f.caller_phone, f.provider_call_id, f.appointment_id, f.assigned_user_id, f.due_at, f.due_tz, f.notes, f.description, f.resolution, f.resolution_category, f.source, f.created_by_user_id, f.created_at, f.updated_at, f.resolved_at, f.version, f.customer_match, f.contact_attempts, f.first_contact_at, f.last_contact_at, f.escalation_level, f.escalated_at, f.reopened_count, f.waiting_until, f.assigned_at`);
/** a second text to the same task within this window is a duplicate (manager override with a reason) — guide T37 */
export const FU_TEXT_COOLDOWN_HOURS = 4;

export class FollowUpCenterError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 400, public readonly details?: Record<string, unknown>) { super(message); this.name = 'FollowUpCenterError'; }
}
export interface FuCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
/** the Reception Copilot center's two-step text path (only what this file uses) */
export interface FuTextPort {
  prepare(ctx: FuCtx, action: { type: 'send_message'; to: string; body: string }): Promise<Row>;
  confirm(ctx: FuCtx, action: { type: 'send_message'; to: string; body: string }, token: string): Promise<Row>;
}
export interface FuQuery { q?: string; status?: string; priority?: string; source?: string; assignee?: string; overdue?: string; basis?: string; preset?: string; from?: string; to?: string; sort?: string; page?: unknown; pageSize?: unknown }

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const n = (v: unknown) => Number(v ?? 0) || 0;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (m: string, code: string, status = 400, d?: Record<string, unknown>) => new FollowUpCenterError(m, code, status, d);

/** today in the salon zone (server clock) */
export function salonToday(tz: string, now = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (ymd: string, d: number) => { const t = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + d)); return utcDate(t); };
/** preset / custom → whole salon-local days (inclusive To; the SQL uses the exclusive next-day boundary) */
export function fuPeriod(q: { preset?: string; from?: string; to?: string }, tz: string, now = new Date()): { preset: string; from: string | null; to: string | null; tz: string; today: string } {
  const today = salonToday(tz, now);
  const preset = q.preset && (FU_PERIODS as readonly string[]).includes(q.preset) ? q.preset : q.from || q.to ? 'custom' : 'all';
  if (preset === 'all') return { preset, from: null, to: null, tz, today };
  if (preset === 'custom') {
    const from = String(q.from ?? ''), to = String(q.to ?? '');
    if (!YMD.test(from) || !YMD.test(to)) throw fail('Choose a valid From and To date.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'from' });
    if (to < from) throw fail('The From date must be on or before the To date.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'to' });
    return { preset, from, to, tz, today };
  }
  if (preset === 'today') return { preset, from: today, to: today, tz, today };
  if (preset === 'week') { const dow = new Date(today + 'T00:00:00Z').getUTCDay(); const from = addDays(today, -((dow + 6) % 7)); return { preset, from, to: addDays(from, 6), tz, today }; }
  if (preset === 'month') { const last = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate(); return { preset, from: today.slice(0, 8) + '01', to: today.slice(0, 8) + String(last).padStart(2, '0'), tz, today }; }
  return { preset, from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31', tz, today };
}
/** a salon-local "YYYY-MM-DDTHH:MM" → the UTC instant (DST-correct, by asking the zone) */
export function localToUtc(local: string, tz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw fail('Enter a valid due date and time.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'due' });
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off = (t: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t; };
  let t = guess - off(guess); t = guess - off(t);
  return new Date(t).toISOString();
}

export class AiFollowUpCenter {
  constructor(private readonly db: Kysely<any>, private readonly text: FuTextPort | null) {}

  // ── access ────────────────────────────────────────────────────────────────────────────────────────────────────
  private can(ctx: FuCtx, p: string) { return hasPermission(ctx as Parameters<typeof hasPermission>[0], p); }
  /** view: ai.use · work a task (create/assign/progress/contact/resolve): ai.use + communications.manage (Front Desk holds
   *  both) · manager-tier (priority override, duplicate-text override, assigning others' escalations): ai.manage */
  needView(ctx: FuCtx) { if (!this.can(ctx, 'ai.use')) throw fail('Your role cannot see AI follow-ups.', 'PERMISSION_DENIED', 403); }
  needWork(ctx: FuCtx) { this.needView(ctx); if (!this.can(ctx, 'communications.manage') && !this.can(ctx, 'ai.manage')) throw fail('Your role can view follow-ups but not work them.', 'PERMISSION_DENIED', 403); }
  needManager(ctx: FuCtx) { if (!this.can(ctx, 'ai.manage')) throw fail('Only an owner or manager can do this.', 'PERMISSION_DENIED', 403); }
  private branch(ctx: FuCtx) { return ctx.branchId; }
  /** tenant + (this branch or no branch) — never another branch's tasks */
  /** this branch or a salon-wide (no-branch) task — always used next to an explicit f.tenant_id predicate */
  private branchScope(ctx: FuCtx) { const b = this.branch(ctx); return b ? sql`(f.branch_id = ${b} or f.branch_id is null)` : sql`true`; }
  async clock(ctx: FuCtx) { const tz = await branchTimeZone(this.db, ctx.tenantId, this.branch(ctx)).catch(() => 'America/New_York'); return { tz, today: salonToday(tz) }; }
  private async audit(ctx: FuCtx, trx: Kysely<any>, action: string, id: string | null, summary: string, extra: { reason?: string | null; before?: Row | null; after?: Row | null; metadata?: Row } = {}) {
    await recordAuditStrict(trx, { tenantId: ctx.tenantId, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role },
      { module: 'ai_follow_ups', action, resourceType: 'ai_follow_up', resourceId: id, summary, reason: extra.reason ?? null, before: extra.before ?? null, after: extra.after ?? null, metadata: extra.metadata });
  }
  private async activity(trx: Kysely<any>, ctx: FuCtx | null, tenantId: string, id: string, type: string, from: string | null, to: string | null, note: string | null, meta: Row = {}) {
    await sql`insert into ai_follow_up_activity (tenant_id, follow_up_id, actor_user_id, event_type, from_value, to_value, note, metadata)
      values (${tenantId}, ${id}, ${ctx?.userId ?? null}, ${type}, ${from}, ${to}, ${note}, ${JSON.stringify(meta)}::jsonb)`.execute(trx);
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async kpis(ctx: FuCtx) {
    this.needView(ctx);
    const clk = await this.clock(ctx);
    const r: Row = (await sql<Row>`select
        count(*) filter (where f.status = 'open')::int open, count(*) filter (where f.status = 'assigned')::int assigned,
        count(*) filter (where f.status = 'in_progress')::int in_progress, count(*) filter (where f.status = 'waiting')::int waiting,
        count(*) filter (where f.status = any(${ACTIVE}::text[]) and f.due_at < now())::int overdue,
        count(*) filter (where f.status in ('resolved','closed'))::int resolved,
        count(*) filter (where f.status in ('resolved','closed') and f.resolved_at >= (${clk.today}::date)::timestamp at time zone ${clk.tz})::int resolved_today,
        count(*) filter (where f.status = any(${ACTIVE}::text[]) and f.assigned_user_id is null)::int unassigned,
        count(*)::int total
      from ai_receptionist_follow_ups f where f.tenant_id = ${ctx.tenantId} and ${this.branchScope(ctx)}`.execute(this.db)).rows[0];
    const h: Row = (await sql<Row>`select count(*) filter (where kind <> 'transfer_completed')::int needs_staff, count(*) filter (where kind = 'transfer_completed')::int transfers_completed
      from ai_handoff_events e where e.tenant_id = ${ctx.tenantId} and (e.branch_id = ${this.branch(ctx)} or e.branch_id is null or ${this.branch(ctx)}::uuid is null)
        and e.created_at >= (${clk.today}::date - 29)::timestamp at time zone ${clk.tz}`.execute(this.db)).rows[0];
    return { asOf: new Date().toISOString(), timeZone: clk.tz, today: clk.today,
      cards: { open: n(r.open), assigned: n(r.assigned), inProgress: n(r.in_progress), waiting: n(r.waiting), overdue: n(r.overdue), resolved: n(r.resolved), resolvedToday: n(r.resolved_today), unassigned: n(r.unassigned), total: n(r.total) },
      handoffs30d: { needsStaff: n(h.needs_staff), transfersCompleted: n(h.transfers_completed) },
      definitions: { open: 'Tasks in Open status in this branch (and salon-wide tasks).', overdue: 'Unresolved tasks whose due time has passed.', resolved: 'Resolved or closed tasks (each with a recorded outcome).',
        handoffs: 'Verified AI events needing staff action in the last 30 salon days; completed transfers shown separately.' } };
  }

  // ── list / search ─────────────────────────────────────────────────────────────────────────────────────────────
  private basisCol(b: string): RawBuilder<unknown> {
    switch (b) {
      case 'due': return sql`f.due_at`; case 'updated': return sql`f.updated_at`; case 'assigned': return sql`f.assigned_at`;
      case 'first_response': return sql`f.first_contact_at`; case 'last_contact': return sql`f.last_contact_at`; case 'resolved': return sql`f.resolved_at`;
      case 'call': return sql`vc.started_at`; default: return sql`f.created_at`;
    }
  }
  async list(ctx: FuCtx, q: FuQuery) {
    this.needView(ctx);
    const clk = await this.clock(ctx);
    const status = q.status && (FU_STATUS_CHIPS as readonly string[]).includes(q.status) ? q.status : 'open';
    const basis = q.basis && (FU_BASES as readonly string[]).includes(q.basis) ? q.basis : 'created';
    const sort = q.sort && (FU_SORTS as readonly string[]).includes(q.sort) ? q.sort : 'newest';
    for (const [k, v, allowed] of [['priority', q.priority, FU_PRIORITIES], ['source', q.source, FU_SOURCES]] as const) if (v && !(allowed as readonly string[]).includes(v)) throw fail(`Unknown ${k} filter.`, 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: k });
    const p = fuPeriod({ preset: q.preset, from: q.from, to: q.to }, clk.tz);
    const pageSize = [10, 20, 50].includes(Number(q.pageSize)) ? Number(q.pageSize) : 20;
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const conds: RawBuilder<unknown>[] = [sql`f.tenant_id = ${ctx.tenantId}`, this.branchScope(ctx)];
    if (status === 'resolved') conds.push(sql`f.status in ('resolved','closed')`); else if (status !== 'all') conds.push(sql`f.status = ${status}`);
    if (q.priority) conds.push(sql`f.priority = ${q.priority}`);
    if (q.source === 'ai') conds.push(sql`f.source = 'ai_receptionist'`); else if (q.source === 'manual') conds.push(sql`f.source = 'manual'`); else if (q.source === 'complaint') conds.push(sql`f.reason = 'COMPLAINT'`);
    else if (q.source === 'missed_call') conds.push(sql`f.source = 'missed_call'`); else if (q.source === 'copilot') conds.push(sql`f.source = 'reception_copilot'`);
    if (q.assignee === 'unassigned') conds.push(sql`f.assigned_user_id is null`); else if (q.assignee === 'me') conds.push(sql`f.assigned_user_id = ${ctx.userId}`);
    else if (q.assignee) { if (!UUIDRE.test(q.assignee)) throw fail('Unknown assignee filter.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'assignee' }); conds.push(sql`f.assigned_user_id = ${q.assignee}`); }
    if (q.overdue === '1' || q.overdue === 'true') conds.push(sql`f.status = any(${ACTIVE}::text[]) and f.due_at < now()`);
    if (p.from && p.to) { const col = this.basisCol(basis); conds.push(sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`); }
    const term = String(q.q ?? '').trim().slice(0, 100);
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      const digits = term.replace(/\D/g, '');
      const ors: RawBuilder<unknown>[] = [sql`c.full_name ilike ${like}`, sql`c.first_name ilike ${like}`, sql`c.last_name ilike ${like}`, sql`concat_ws(' ', c.first_name, c.last_name) ilike ${like}`,
        sql`c.email ilike ${like}`, sql`f.id::text ilike ${term.toLowerCase() + '%'}`, sql`f.provider_call_id ilike ${like}`, sql`f.appointment_id::text ilike ${term.toLowerCase() + '%'}`,
        sql`u.full_name ilike ${like}`, sql`f.description ilike ${like}`, sql`f.reason ilike ${like}`];
      if (digits.length >= 4) { ors.push(sql`regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}`); ors.push(sql`regexp_replace(coalesce(f.caller_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}`); }
      conds.push(sql`(${sql.join(ors, sql` or `)})`);
    }
    const where = sql.join(conds, sql` and `);
    const from = sql`from ai_receptionist_follow_ups f
      left join customers c on c.id = f.customer_id and c.tenant_id = f.tenant_id
      left join users u on u.id = f.assigned_user_id and u.tenant_id = f.tenant_id
      left join voice_call_outcomes vc on vc.tenant_id = f.tenant_id and vc.provider_call_id = f.provider_call_id`;
    const order = sort === 'priority'
      ? sql`case when f.status = any(${ACTIVE}::text[]) and f.due_at < now() then 0 else 1 end, case f.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, f.created_at asc, f.id asc`
      : sort === 'due' ? sql`f.due_at asc nulls last, f.created_at desc, f.id desc` : sql`f.created_at desc, f.id desc`;
    const total = n((await sql<Row>`select count(*)::int n ${from} where ${where}`.execute(this.db)).rows[0]?.n);
    const rows: Row[] = (await sql<Row>`select ${FU_COLS}, c.first_name, c.last_name, c.full_name, c.normalized_phone c_phone, u.full_name assignee_name, vc.started_at call_started_at, vc.handoff_outcome
      ${from} where ${where} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => this.rowOut(r)),
      page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filters: { status, basis, sort, period: p, q: term || null, priority: q.priority ?? null, source: q.source ?? null, assignee: q.assignee ?? null, overdue: q.overdue === '1' || q.overdue === 'true' },
    };
  }
  private rowOut(r: Row) {
    const name = r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || null;
    const phone = r.c_phone || r.caller_phone || null;
    const overdue = ACTIVE.includes(r.status) && r.due_at && new Date(r.due_at).getTime() < Date.now();
    return { id: r.id, status: r.status, priority: r.priority, reason: r.reason, source: r.source, description: r.description ?? r.notes ?? null,
      customer: name ? { id: r.customer_id, name } : null, caller: phone ? maskPhone(String(phone)) : null, customerMatch: r.customer_match ?? (r.customer_id ? 'linked' : 'unmatched'),
      providerCallId: r.provider_call_id ?? null, callStartedAt: iso(r.call_started_at), handoffOutcome: r.handoff_outcome ?? null, appointmentId: r.appointment_id ?? null,
      assignee: r.assigned_user_id ? { id: r.assigned_user_id, name: r.assignee_name ?? null } : null,
      dueAt: iso(r.due_at), overdue: !!overdue, contactAttempts: n(r.contact_attempts), lastContactAt: iso(r.last_contact_at), escalationLevel: n(r.escalation_level),
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), resolvedAt: iso(r.resolved_at), version: n(r.version) || 1 };
  }

  /** active staff who can work tasks in this branch */
  async staff(ctx: FuCtx) {
    this.needView(ctx);
    const rows: Row[] = (await sql<Row>`select id, full_name, role from users where tenant_id = ${ctx.tenantId} and status = 'active' and role = any(${ASSIGNABLE_ROLES}::text[])
      and (branch_id = ${this.branch(ctx)} or branch_id is null or ${this.branch(ctx)}::uuid is null) order by full_name, id limit 200`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ id: r.id, name: r.full_name, role: r.role })) };
  }
  private async assertAssignable(ctx: FuCtx, db: Kysely<any>, userId: string) {
    if (!UUIDRE.test(userId)) throw fail('Choose an active staff member.', 'FOLLOWUP_ASSIGNEE_INVALID');
    const ok = (await sql<Row>`select 1 from users where id = ${userId} and tenant_id = ${ctx.tenantId} and status = 'active' and role = any(${ASSIGNABLE_ROLES}::text[])
      and (branch_id = ${this.branch(ctx)} or branch_id is null or ${this.branch(ctx)}::uuid is null)`.execute(db)).rows.length;
    if (!ok) throw fail('That person is not active staff who can work follow-ups in this branch.', 'FOLLOWUP_ASSIGNEE_INVALID');
  }

  // ── create ────────────────────────────────────────────────────────────────────────────────────────────────────
  async create(ctx: FuCtx, b: { reason?: string; description?: string; priority?: string; dueLocal?: string | null; customerId?: string | null; callerPhone?: string | null;
    assignedUserId?: string | null; providerCallId?: string | null; appointmentId?: string | null; idempotencyKey?: string }) {
    this.needWork(ctx);
    const key = String(b.idempotencyKey ?? '').trim();
    if (key.length < 8 || key.length > 120) throw fail('A request key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    if (!(FU_CREATE_REASONS as readonly string[]).includes(String(b.reason))) throw fail('Choose a reason.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'reason' });
    const description = String(b.description ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (description.length < 3 || description.length > 1000) throw fail('Describe the issue in 3–1000 characters.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'description' });
    const priority = (FU_PRIORITIES as readonly string[]).includes(String(b.priority)) ? String(b.priority) : 'normal';
    const clk = await this.clock(ctx);
    const dueAt = b.dueLocal ? localToUtc(String(b.dueLocal), clk.tz) : null;
    return this.db.transaction().execute(async (trx) => {
      let customerId: string | null = null; let match = 'manual'; let phone: string | null = null;
      if (b.customerId) {
        if (!UUIDRE.test(b.customerId) || !(await sql<Row>`select 1 from customers where id = ${b.customerId} and tenant_id = ${ctx.tenantId}`.execute(trx)).rows.length) throw fail('That customer is not in this salon.', 'FOLLOWUP_LINK_INVALID', 400, { field: 'customerId' });
        customerId = b.customerId; match = 'linked';
      } else if (b.callerPhone) {
        phone = String(b.callerPhone).replace(/[^\d+]/g, '');
        if (!E164.test(phone)) throw fail('Enter the caller’s number with its country code (for example +1…).', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'callerPhone' });
        match = 'unmatched';
      } else throw fail('Choose a customer or enter the caller’s number.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'customerId' });
      if (b.providerCallId && !(await sql<Row>`select 1 from voice_call_outcomes where tenant_id = ${ctx.tenantId} and provider_call_id = ${b.providerCallId}`.execute(trx)).rows.length) throw fail('That call is not in this salon’s records.', 'FOLLOWUP_LINK_INVALID', 400, { field: 'providerCallId' });
      if (b.appointmentId && (!UUIDRE.test(b.appointmentId) || !(await sql<Row>`select 1 from pos_tech_appointments where id = ${b.appointmentId} and tenant_id = ${ctx.tenantId}`.execute(trx)).rows.length)) throw fail('That appointment is not in this salon.', 'FOLLOWUP_LINK_INVALID', 400, { field: 'appointmentId' });
      if (b.assignedUserId) await this.assertAssignable(ctx, trx, b.assignedUserId);
      const status = b.assignedUserId ? 'assigned' : 'open';
      const ins: Row | undefined = (await sql<Row>`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, status, customer_id, caller_phone, provider_call_id, appointment_id, description,
          source, created_by_user_id, source_event_key, due_at, due_tz, customer_match, assigned_user_id, assigned_at, updated_by)
        values (${ctx.tenantId}, ${this.branch(ctx)}, ${b.reason}, ${priority}, ${status}, ${customerId}, ${phone}, ${b.providerCallId ?? null}, ${b.appointmentId ?? null}, ${description},
          'manual', ${ctx.userId}, ${'manual:' + key}, ${dueAt}, ${clk.tz}, ${match}, ${b.assignedUserId ?? null}, ${b.assignedUserId ? sql`now()` : null}, ${ctx.userId})
        on conflict (tenant_id, source_event_key) where source_event_key is not null do nothing returning id`.execute(trx)).rows[0];
      if (!ins) {
        const ex: Row = (await sql<Row>`select id from ai_receptionist_follow_ups where tenant_id = ${ctx.tenantId} and source_event_key = ${'manual:' + key}`.execute(trx)).rows[0];
        return { id: String(ex.id), duplicate: true };
      }
      await this.activity(trx, ctx, ctx.tenantId, ins.id, 'created', null, status, description, { source: 'manual', priority, assignedUserId: b.assignedUserId ?? null });
      await this.audit(ctx, trx, 'follow_up.created', ins.id, `Follow-up created (${b.reason})`, { after: { status, priority, reason: b.reason } });
      return { id: String(ins.id), duplicate: false };
    });
  }

  // ── row-versioned writes ──────────────────────────────────────────────────────────────────────────────────────
  private async lock(ctx: FuCtx, trx: Kysely<any>, id: string, version: unknown, requireVersion = true): Promise<Row> {
    if (!UUIDRE.test(id)) throw fail('Follow-up not found.', 'NOT_FOUND', 404);
    const r: Row | undefined = (await sql<Row>`select ${FU_COLS} from ai_receptionist_follow_ups f where f.id = ${id} and f.tenant_id = ${ctx.tenantId} and ${this.branchScope(ctx)} for update`.execute(trx)).rows[0];
    if (!r) throw fail('Follow-up not found.', 'NOT_FOUND', 404);
    if (requireVersion && (version === undefined || version === null)) throw fail('Refresh this follow-up and try again.', 'VERSION_REQUIRED', 422, { version: n(r.version) });   // a client without the row version could overwrite a newer change
    if (version !== undefined && version !== null && Number(version) !== n(r.version)) throw fail('This follow-up changed — refresh and try again.', 'RECORD_CHANGED_RELOAD', 409, { version: n(r.version) });
    return r;
  }
  async assign(ctx: FuCtx, id: string, b: { assignedUserId?: string | null; version?: number; note?: string }) {
    this.needWork(ctx);
    return this.db.transaction().execute(async (trx) => {
      const cur = await this.lock(ctx, trx, id, b.version);
      if (!ACTIVE.includes(cur.status)) throw fail('Reopen this follow-up before assigning it.', 'FOLLOWUP_STATE_INVALID', 409);
      const to = b.assignedUserId ?? null;
      if (to) await this.assertAssignable(ctx, trx, to);
      const nextStatus = to && cur.status === 'open' ? 'assigned' : !to && cur.status === 'assigned' ? 'open' : cur.status;
      const moved = nextStatus !== cur.status;
      const r: Row | undefined = (await sql<Row>`update ai_receptionist_follow_ups set assigned_user_id = ${to}, assigned_at = ${to ? sql`now()` : null}, status = ${nextStatus},
          version = version + 1, updated_at = now(), updated_by = ${ctx.userId}
        where id = ${id} and tenant_id = ${ctx.tenantId} and version = ${n(cur.version)} and ${moved ? canMoveToSql(AI_RECEPTIONIST_FOLLOW_UP, nextStatus) : sql`true`} returning *`.execute(trx)).rows[0];
      if (!r) throw fail('This follow-up changed — refresh and try again.', 'RECORD_CHANGED_RELOAD', 409);
      await this.activity(trx, ctx, ctx.tenantId, id, cur.assigned_user_id ? 'reassigned' : 'assigned', cur.assigned_user_id ?? null, to, b.note ? String(b.note).slice(0, 500) : null, moved ? { status: [cur.status, nextStatus] } : {});
      // A13 Nov 6: tell the person it was given to. There is no per-person inbox in the POS, so the notice is an in-app alert
      // (Alerts) naming them, plus an activity row; nothing is sent outside the salon. Not sent when you assign it to yourself.
      if (to && to !== ctx.userId) {
        const who: Row | undefined = (await sql<Row>`select full_name from users where id = ${to} and tenant_id = ${ctx.tenantId}`.execute(trx)).rows[0];
        await sql`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
          values (${ctx.tenantId}, ${r.branch_id ?? null}, 'ai_follow_up_assigned', 'info', 'new', ${`Follow-up assigned to ${who?.full_name ?? 'a staff member'}`},
            ${String(r.description ?? r.notes ?? r.reason).slice(0, 300)}, ${JSON.stringify({ followUpId: id, assignedUserId: to })}::jsonb, 'all')`.execute(trx);
        await this.activity(trx, ctx, ctx.tenantId, id, 'assignee_notified', null, to, null, { channel: 'in_app_alert' });
      }
      await this.audit(ctx, trx, 'follow_up.assigned', id, to ? 'Follow-up assigned' : 'Follow-up unassigned', { before: { assignedUserId: cur.assigned_user_id ?? null, status: cur.status }, after: { assignedUserId: to, status: nextStatus } });
      return this.rowOut(r);
    });
  }
  async transition(ctx: FuCtx, id: string, b: { to?: string; version?: number; reason?: string; resolutionCategory?: string; note?: string; waitingUntilLocal?: string | null }) {
    this.needWork(ctx);
    const to = String(b.to ?? '');
    if (!(AI_RECEPTIONIST_FOLLOW_UP.states as readonly string[]).includes(to)) throw fail('Unknown status.', 'FOLLOWUP_STATE_INVALID');
    const note = b.note ? String(b.note).slice(0, 1000).trim() : null;
    const clk = await this.clock(ctx);
    return this.db.transaction().execute(async (trx) => {
      const cur = await this.lock(ctx, trx, id, b.version);
      if (!(AI_RECEPTIONIST_FOLLOW_UP.transitions[cur.status as keyof typeof AI_RECEPTIONIST_FOLLOW_UP.transitions] ?? []).includes(to as never)) throw fail(`A follow-up cannot move from ${cur.status} to ${to}.`, 'FOLLOWUP_STATE_INVALID', 409);
      const reopening = ['resolved', 'closed'].includes(cur.status) && ACTIVE.includes(to);
      let category: string | null = null;
      if (to === 'resolved') {
        category = String(b.resolutionCategory ?? '');
        if (!(FU_RESOLUTIONS as readonly string[]).includes(category)) throw fail('Choose how this follow-up was resolved.', 'FOLLOWUP_RESOLUTION_REQUIRED', 400, { field: 'resolutionCategory' });
        if (cur.reason === 'COMPLAINT' && (!note || note.length < 5)) throw fail('A complaint needs a note describing how it was resolved.', 'FOLLOWUP_RESOLUTION_REQUIRED', 400, { field: 'note' });
      }
      if (reopening && (!b.reason || String(b.reason).trim().length < 3)) throw fail('Give a reason for reopening.', 'FOLLOWUP_REASON_REQUIRED', 400, { field: 'reason' });
      if (to === 'waiting' && !note && !b.waitingUntilLocal) throw fail('Say what this follow-up is waiting for.', 'FOLLOWUP_REASON_REQUIRED', 400, { field: 'note' });
      if (to === 'assigned' && !cur.assigned_user_id) throw fail('Choose who is responsible first.', 'FOLLOWUP_ASSIGNEE_INVALID');
      const waitingUntil = to === 'waiting' && b.waitingUntilLocal ? localToUtc(String(b.waitingUntilLocal), clk.tz) : null;
      const r: Row | undefined = (await sql<Row>`update ai_receptionist_follow_ups set status = ${to}, version = version + 1, updated_at = now(), updated_by = ${ctx.userId},
          resolution_category = ${to === 'resolved' ? category : reopening ? null : sql`resolution_category`},
          resolution = ${to === 'resolved' ? note : sql`resolution`},
          resolved_at = ${to === 'resolved' || to === 'closed' ? sql`coalesce(resolved_at, now())` : reopening ? null : sql`resolved_at`},
          reopened_count = reopened_count + ${reopening ? 1 : 0}, waiting_until = ${to === 'waiting' ? waitingUntil : null}
        where id = ${id} and tenant_id = ${ctx.tenantId} and status = ${cur.status} and version = ${n(cur.version)} and ${canMoveToSql(AI_RECEPTIONIST_FOLLOW_UP, to)} returning *`.execute(trx)).rows[0];
      if (!r) throw fail('This follow-up changed — refresh and try again.', 'RECORD_CHANGED_RELOAD', 409);
      await this.activity(trx, ctx, ctx.tenantId, id, reopening ? 'reopened' : to === 'resolved' ? 'resolved' : 'status_changed', cur.status, to, note ?? (b.reason ? String(b.reason).slice(0, 500) : null), category ? { resolutionCategory: category } : {});
      await this.audit(ctx, trx, reopening ? 'follow_up.reopened' : 'follow_up.status_changed', id, `Follow-up ${cur.status} → ${to}`, { reason: b.reason ?? null, before: { status: cur.status }, after: { status: to, resolutionCategory: category } });
      if (to === 'resolved' || to === 'closed') await sql`update ai_follow_up_escalations set resolved_at = coalesce(resolved_at, now()) where tenant_id = ${ctx.tenantId} and follow_up_id = ${id}`.execute(trx);
      return this.rowOut(r);
    });
  }
  async note(ctx: FuCtx, id: string, b: { note?: string; version?: number }) {
    this.needWork(ctx);
    const note = String(b.note ?? '').trim().slice(0, 1000);
    if (note.length < 2) throw fail('Write a note.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'note' });
    return this.db.transaction().execute(async (trx) => {
      await this.lock(ctx, trx, id, b.version);
      const r: Row = (await sql<Row>`update ai_receptionist_follow_ups set version = version + 1, updated_at = now(), updated_by = ${ctx.userId} where id = ${id} and tenant_id = ${ctx.tenantId} returning *`.execute(trx)).rows[0];
      await this.activity(trx, ctx, ctx.tenantId, id, 'note', null, null, note);
      return this.rowOut(r);
    });
  }
  /** edit the description and / or due time of an open task (row-versioned, audited). Due time is salon-local; '' clears it. */
  async edit(ctx: FuCtx, id: string, b: { description?: string | null; dueLocal?: string | null; version?: number }) {
    this.needWork(ctx);
    const hasDesc = b.description !== undefined && b.description !== null, hasDue = b.dueLocal !== undefined;
    if (!hasDesc && !hasDue) throw fail('Nothing to change.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400);
    const description = hasDesc ? String(b.description).trim().slice(0, 1000) : null;
    if (hasDesc && (description ?? '').length < 3) throw fail('Describe the issue (3+ characters).', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'description' });
    const clk = await this.clock(ctx);
    const dueAt = hasDue && b.dueLocal ? localToUtc(String(b.dueLocal), clk.tz) : null;
    return this.db.transaction().execute(async (trx) => {
      const cur = await this.lock(ctx, trx, id, b.version);
      if (!ACTIVE.includes(cur.status)) throw fail('Reopen this follow-up first.', 'FOLLOWUP_STATE_INVALID', 409);
      const r: Row = (await sql<Row>`update ai_receptionist_follow_ups set version = version + 1, updated_at = now(), updated_by = ${ctx.userId},
          description = ${hasDesc ? description : sql`description`}, due_at = ${hasDue ? dueAt : sql`due_at`}, due_tz = ${hasDue ? (dueAt ? clk.tz : null) : sql`due_tz`}
        where id = ${id} and tenant_id = ${ctx.tenantId} and version = ${n(cur.version)} returning *`.execute(trx)).rows[0];
      const before = { description: cur.description ?? null, dueAt: iso(cur.due_at) }, after = { description: r.description ?? null, dueAt: iso(r.due_at) };
      if (hasDue && before.dueAt !== after.dueAt) await this.activity(trx, ctx, ctx.tenantId, id, 'due_changed', before.dueAt, after.dueAt, null);
      if (hasDesc && before.description !== after.description) await this.activity(trx, ctx, ctx.tenantId, id, 'description_changed', null, null, String(after.description).slice(0, 500));
      await this.audit(ctx, trx, 'follow_up.edited', id, 'Follow-up details edited', { before, after });
      return this.rowOut(r);
    });
  }
  /** escalate (any worker): priority → urgent, escalation level +1, manager alert. Any other priority change: manager + reason. */
  async setPriority(ctx: FuCtx, id: string, b: { priority?: string; reason?: string; version?: number; escalate?: boolean }) {
    this.needWork(ctx);
    const escalate = !!b.escalate;
    const to = escalate ? 'urgent' : String(b.priority ?? '');
    if (!(FU_PRIORITIES as readonly string[]).includes(to)) throw fail('Choose a priority.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'priority' });
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) throw fail('Give a reason.', 'FOLLOWUP_REASON_REQUIRED', 400, { field: 'reason' });
    if (!escalate) this.needManager(ctx);
    return this.db.transaction().execute(async (trx) => {
      const cur = await this.lock(ctx, trx, id, b.version);
      if (!ACTIVE.includes(cur.status)) throw fail('Reopen this follow-up first.', 'FOLLOWUP_STATE_INVALID', 409);
      const r: Row = (await sql<Row>`update ai_receptionist_follow_ups set priority = ${to}, version = version + 1, updated_at = now(), updated_by = ${ctx.userId},
          escalation_level = escalation_level + ${escalate ? 1 : 0}, escalated_at = ${escalate ? sql`now()` : sql`escalated_at`}
        where id = ${id} and tenant_id = ${ctx.tenantId} returning *`.execute(trx)).rows[0];
      await this.activity(trx, ctx, ctx.tenantId, id, escalate ? 'escalated' : 'priority_override', cur.priority, to, reason.slice(0, 500));
      await this.audit(ctx, trx, escalate ? 'follow_up.escalated' : 'follow_up.priority_overridden', id, escalate ? 'Follow-up escalated to a manager' : `Priority ${cur.priority} → ${to}`, { reason, before: { priority: cur.priority }, after: { priority: to } });
      if (escalate) await this.raiseAlert(trx, ctx.tenantId, r.branch_id ?? null, id, `manual:${Number(r.escalation_level)}`,   // each escalation level alerts once (a second escalation used to be silent)
         'high', 'A follow-up was escalated', `Staff escalated a follow-up: ${reason.slice(0, 200)}`);
      return this.rowOut(r);
    });
  }
  private async raiseAlert(trx: Kysely<any>, tenantId: string, branchId: string | null, id: string, rule: string, severity: string, title: string, body: string) {
    const esc: Row | undefined = (await sql<Row>`insert into ai_follow_up_escalations (tenant_id, follow_up_id, rule, severity) values (${tenantId}, ${id}, ${rule}, ${severity})
      on conflict (tenant_id, follow_up_id, rule) do nothing returning id`.execute(trx)).rows[0];
    if (!esc) return false;
    const a: Row = (await sql<Row>`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
      values (${tenantId}, ${branchId}, 'ai_follow_up', ${severity}, 'new', ${title}, ${body}, ${JSON.stringify({ followUpId: id, rule })}::jsonb, 'all') returning id`.execute(trx)).rows[0];
    await sql`update ai_follow_up_escalations set owner_alert_id = ${a.id} where id = ${esc.id}`.execute(trx);
    return true;
  }

  // ── contact attempts ──────────────────────────────────────────────────────────────────────────────────────────
  /** a staff-recorded outcome of a call / visit / email the staff member made outside this screen (an attestation) */
  async recordAttempt(ctx: FuCtx, id: string, b: { channel?: string; outcome?: string; note?: string; nextAttemptLocal?: string | null; idempotencyKey?: string }) {
    this.needWork(ctx);
    const channel = String(b.channel ?? ''), outcome = String(b.outcome ?? ''), key = String(b.idempotencyKey ?? '').trim();
    if (!(FU_ATTEMPT_CHANNELS as readonly string[]).includes(channel)) throw fail('Choose how you contacted the customer.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'channel' });
    if (!(FU_ATTEMPT_OUTCOMES as readonly string[]).includes(outcome)) throw fail('Choose the outcome.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'outcome' });
    if (key.length < 8) throw fail('A request key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    const clk = await this.clock(ctx);
    const next = b.nextAttemptLocal ? localToUtc(String(b.nextAttemptLocal), clk.tz) : null;
    return this.db.transaction().execute(async (trx) => {
      const cur = await this.lock(ctx, trx, id, undefined, false);
      // Nov 3 audit: a resolved / closed follow-up takes no more attempts (they were counted on it)
      if (!ACTIVE.includes(cur.status)) throw fail('Reopen this follow-up first.', 'FOLLOWUP_STATE_INVALID', 409);
      const reached = ['reached', 'resolved'].includes(outcome);
      const ins: Row | undefined = (await sql<Row>`insert into ai_follow_up_contact_attempts (tenant_id, follow_up_id, channel, actor_user_id, recipient_ref, outcome, idempotency_key, note, next_attempt_at)
        values (${ctx.tenantId}, ${id}, ${channel}, ${ctx.userId}, ${cur.caller_phone ? maskPhone(String(cur.caller_phone)) : null}, ${outcome}, ${'att:' + key}, ${b.note ? String(b.note).slice(0, 1000) : null}, ${next})
        on conflict (tenant_id, idempotency_key) do nothing returning id`.execute(trx)).rows[0];
      if (!ins) return { duplicate: true };
      await sql`update ai_receptionist_follow_ups set contact_attempts = contact_attempts + 1, last_contact_at = now(), first_contact_at = coalesce(first_contact_at, case when ${reached} then now() else null end),
          version = version + 1, updated_at = now(), updated_by = ${ctx.userId},
          status = case when status in ('open','assigned') and ${canMoveToSql(AI_RECEPTIONIST_FOLLOW_UP, 'in_progress')} then 'in_progress' else status end
        where id = ${id} and tenant_id = ${ctx.tenantId}`.execute(trx);
      await this.activity(trx, ctx, ctx.tenantId, id, 'contact_attempt', null, outcome, b.note ? String(b.note).slice(0, 500) : null, { channel, recordedBy: 'staff_attestation' });
      return { duplicate: false, attemptId: ins.id };
    });
  }
  private async taskPhone(ctx: FuCtx, cur: Row): Promise<string | null> {
    if (cur.customer_id) { const c: Row | undefined = (await sql<Row>`select normalized_phone from customers where id = ${cur.customer_id} and tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0]; if (c?.normalized_phone) return String(c.normalized_phone); }
    return cur.caller_phone ? String(cur.caller_phone) : null;
  }
  private async recentText(ctx: FuCtx, id: string): Promise<Row | null> {
    return (await sql<Row>`select created_at, outcome from ai_follow_up_contact_attempts where tenant_id = ${ctx.tenantId} and follow_up_id = ${id} and channel = 'sms'
      and outcome not in ('failed','blocked') and created_at > now() - make_interval(hours => ${FU_TEXT_COOLDOWN_HOURS}) order by created_at desc limit 1`.execute(this.db)).rows[0] ?? null;
  }
  /** PREPARE a text (no side effect): Copilot preview + this task's duplicate protection */
  async prepareText(ctx: FuCtx, id: string, b: { body?: string; overrideReason?: string }) {
    this.needWork(ctx);
    if (!this.text) throw fail('Texting is not available here.', 'SERVICE_UNAVAILABLE', 503);
    const cur = await this.db.transaction().execute((trx) => this.lock(ctx, trx, id, undefined, false));
    const to = await this.taskPhone(ctx, cur);
    const body = String(b.body ?? '').trim();
    const extraBlocked: string[] = [];
    if (!ACTIVE.includes(cur.status)) extraBlocked.push('Reopen this follow-up before contacting the customer.');
    if (!to || !E164.test(to)) extraBlocked.push('This follow-up has no number with a country code to text.');
    const dup = await this.recentText(ctx, id);
    if (dup) {
      if (!b.overrideReason) extraBlocked.push(`A text for this follow-up was already submitted in the last ${FU_TEXT_COOLDOWN_HOURS} hours. A manager can override with a reason.`);
      else if (!this.can(ctx, 'ai.manage')) extraBlocked.push('Only an owner or manager can override duplicate-text protection.');
    }
    if (extraBlocked.length || !to) return { state: 'blocked', blocked: extraBlocked, warnings: [], notices: [], token: null, proposed: null, duplicateOf: dup ? iso(dup.created_at) : null };
    const p = await this.text.prepare(ctx, { type: 'send_message', to, body });
    return { ...p, duplicateOf: dup ? iso(dup.created_at) : null };
  }
  /** CONFIRM the prepared text through the Copilot spine, then record the attempt with the VERIFIED state */
  async confirmText(ctx: FuCtx, id: string, b: { body?: string; token?: string; idempotencyKey?: string; overrideReason?: string }) {
    this.needWork(ctx);
    if (!this.text) throw fail('Texting is not available here.', 'SERVICE_UNAVAILABLE', 503);
    const key = String(b.idempotencyKey ?? '').trim();
    if (key.length < 8) throw fail('A request key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    const prior: Row | undefined = (await sql<Row>`select id, outcome from ai_follow_up_contact_attempts where tenant_id = ${ctx.tenantId} and idempotency_key = ${'sms:' + key}`.execute(this.db)).rows[0];
    if (prior) return { duplicate: true, attemptId: prior.id, state: prior.outcome };
    const cur = await this.db.transaction().execute((trx) => this.lock(ctx, trx, id, undefined, false));
    const to = await this.taskPhone(ctx, cur);
    if (!to || !E164.test(to) || !ACTIVE.includes(cur.status)) throw fail('This follow-up cannot be texted.', 'FOLLOWUP_STATE_INVALID', 409);
    const dup = await this.recentText(ctx, id);
    if (dup && (!b.overrideReason || !this.can(ctx, 'ai.manage'))) throw fail('A text for this follow-up was already submitted recently.', 'FOLLOWUP_DUPLICATE_CONTACT', 409);
    const body = String(b.body ?? '').trim();
    const r = await this.text.confirm(ctx, { type: 'send_message', to, body }, String(b.token ?? ''));
    const state = r.ok ? (['delivered', 'provider_accepted', 'submitted'].includes(String(r.state)) ? String(r.state) : 'unknown') : r.errorCode === 'COPILOT_ACTION_BLOCKED' ? 'blocked' : 'failed';
    const nid = r.record?.notificationId ?? null;
    return this.db.transaction().execute(async (trx) => {
      const ins: Row | undefined = (await sql<Row>`insert into ai_follow_up_contact_attempts (tenant_id, follow_up_id, channel, actor_user_id, recipient_ref, outcome, notification_id, request_key, idempotency_key, note)
        values (${ctx.tenantId}, ${id}, 'sms', ${ctx.userId}, ${maskPhone(to)}, ${state}, ${nid}, ${r.requestKey ?? null}, ${'sms:' + key}, ${b.overrideReason ? 'Manager override: ' + String(b.overrideReason).slice(0, 300) : null})
        on conflict (tenant_id, idempotency_key) do nothing returning id`.execute(trx)).rows[0];
      if (ins && state !== 'failed' && state !== 'blocked') {
        await sql`update ai_receptionist_follow_ups set contact_attempts = contact_attempts + 1, last_contact_at = now(), version = version + 1, updated_at = now(), updated_by = ${ctx.userId},
            status = case when status in ('open','assigned') and ${canMoveToSql(AI_RECEPTIONIST_FOLLOW_UP, 'in_progress')} then 'in_progress' else status end
          where id = ${id} and tenant_id = ${ctx.tenantId}`.execute(trx);
      }
      if (ins) await this.activity(trx, ctx, ctx.tenantId, id, 'text_submitted', null, state, null, { notificationId: nid, override: !!b.overrideReason });
      if (ins && b.overrideReason) await this.audit(ctx, trx, 'follow_up.duplicate_text_override', id, 'Duplicate-text protection overridden', { reason: String(b.overrideReason) });
      return { duplicate: !ins, attemptId: ins?.id ?? null, state, ok: !!r.ok, errorCode: r.errorCode ?? null, message: r.message ?? null };
    });
  }

  // ── overlay ───────────────────────────────────────────────────────────────────────────────────────────────────
  async detail(ctx: FuCtx, id: string) {
    this.needView(ctx);
    if (!UUIDRE.test(id)) throw fail('Follow-up not found.', 'NOT_FOUND', 404);
    const T = ctx.tenantId;
    const f: Row | undefined = (await sql<Row>`select ${FU_COLS}, u.full_name assignee_name, cu.full_name creator_name from ai_receptionist_follow_ups f
        left join users u on u.id = f.assigned_user_id and u.tenant_id = f.tenant_id left join users cu on cu.id = f.created_by_user_id and cu.tenant_id = f.tenant_id
      where f.id = ${id} and f.tenant_id = ${ctx.tenantId} and ${this.branchScope(ctx)}`.execute(this.db)).rows[0];
    if (!f) throw fail('Follow-up not found.', 'NOT_FOUND', 404);
    const fullContact = this.can(ctx, 'communications.manage') || this.can(ctx, 'ai.manage');
    const c: Row | undefined = f.customer_id ? (await sql<Row>`select id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in from customers where id = ${f.customer_id} and tenant_id = ${T}`.execute(this.db)).rows[0] : undefined;
    const phone = c?.normalized_phone ?? f.caller_phone ?? null;
    const sharedPhone = phone ? n((await sql<Row>`select count(*)::int n from customers where tenant_id = ${T} and normalized_phone = ${phone} and archived_at is null`.execute(this.db)).rows[0]?.n) : 0;
    const optOut = phone ? !!(await sql<Row>`select 1 from notification_opt_outs where tenant_id = ${T} and channel = 'sms' and address = ${phone} limit 1`.execute(this.db).catch(() => ({ rows: [] as Row[] }))).rows.length : false;
    const upcoming: Row[] = c ? (await sql<Row>`select id, appt_date::text d, start_time, status from pos_tech_appointments where tenant_id = ${T} and customer_id = ${c.id} and appt_date >= ${(await this.clock(ctx)).today}::date and status not in ('cancelled','no_show') order by appt_date, start_time, id limit 5`.execute(this.db)).rows : [];
    const linkedAppt: Row | undefined = f.appointment_id ? (await sql<Row>`select id, appt_date::text d, start_time, status, source from pos_tech_appointments where id = ${f.appointment_id} and tenant_id = ${T}`.execute(this.db)).rows[0] : undefined;
    const visits = c ? n((await sql<Row>`select count(*)::int n from tickets where tenant_id = ${T} and customer_id = ${c.id} and status in ('closed','paid')`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n) : 0;
    const call: Row | undefined = f.provider_call_id ? (await sql<Row>`select provider_call_id, agent_ref, started_at, ended_at, duration_seconds, handoff_outcome, disconnection_reason, error_category, summary, sentiment
      from voice_call_outcomes where tenant_id = ${T} and provider_call_id = ${f.provider_call_id}`.execute(this.db)).rows[0] : undefined;
    const handoffs: Row[] = f.provider_call_id ? (await sql<Row>`select kind, source, callback_required, reason, created_at from ai_handoff_events where tenant_id = ${T} and provider_call_id = ${f.provider_call_id} order by created_at, id`.execute(this.db)).rows : [];
    const attempts: Row[] = (await sql<Row>`select a.id, a.channel, a.outcome, a.recipient_ref, a.note, a.next_attempt_at, a.created_at, a.notification_id, u.full_name actor_name,
        nt.status n_status, nt.provider_status n_provider_status, nt.delivered_at n_delivered_at, nt.provider_id n_provider_id
      from ai_follow_up_contact_attempts a left join users u on u.id = a.actor_user_id and u.tenant_id = a.tenant_id
        left join notifications nt on nt.id = a.notification_id and nt.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.follow_up_id = ${id} order by a.created_at desc, a.id desc limit 50`.execute(this.db)).rows;
    const activity: Row[] = (await sql<Row>`select a.event_type, a.from_value, a.to_value, a.note, a.metadata, a.created_at, u.full_name actor_name from ai_follow_up_activity a
      left join users u on u.id = a.actor_user_id and u.tenant_id = a.tenant_id where a.tenant_id = ${T} and a.follow_up_id = ${id} order by a.created_at desc, a.id desc limit 100`.execute(this.db)).rows;
    // extras (AI Follow Ups 05) — Duplicate Contact Guard: the same customer reached in the last 7 days by ANOTHER AI
    // follow-up task (its recorded contact attempts) or by an end-of-day technician follow-up (sent). A warning only —
    // it blocks nothing and changes nothing (the text path keeps its own cooldown + manager override).
    const recentContacts: Row[] = c || phone ? (await sql<Row>`select * from (
        select 'ai_follow_up' as source, a.created_at as at, a.channel, a.outcome, coalesce(u.full_name, 'Staff') as by_name, a.follow_up_id as ref
          from ai_follow_up_contact_attempts a join ai_receptionist_follow_ups o on o.id = a.follow_up_id and o.tenant_id = a.tenant_id
          left join users u on u.id = a.actor_user_id and u.tenant_id = a.tenant_id
         where a.tenant_id = ${T} and a.follow_up_id <> ${id} and a.created_at > now() - interval '7 days'
           and (${c ? sql`o.customer_id = ${c.id}` : sql`false`} or ${phone ? sql`o.caller_phone = ${phone}` : sql`false`})
        union all
        select 'end_of_day' as source, s.sent_at as at, 'customer_app' as channel, s.status as outcome, coalesce(nullif(s.technician_name_snapshot, ''), 'Technician') as by_name, s.id as ref
          from service_follow_up_tasks s where s.tenant_id = ${T} and s.deleted_at is null and s.sent_at is not null and s.sent_at > now() - interval '7 days' and ${c ? sql`s.customer_id = ${c.id}` : sql`false`}
      ) x order by x.at desc limit 10`.execute(this.db)).rows : [];
    await recordAuditStrict(this.db, { tenantId: T, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role }, { module: 'ai_follow_ups', action: 'follow_up.viewed', resourceType: 'ai_follow_up', resourceId: id, summary: 'Follow-up details viewed' });
    const smsState = (a: Row) => {
      if (a.channel !== 'sms' || !a.notification_id) return a.outcome;
      const ps = String(a.n_provider_status ?? '').toLowerCase();
      if (a.n_status === 'failed' || ['failed', 'undelivered'].includes(ps)) return 'failed';
      if (a.n_delivered_at || ps === 'delivered') return 'delivered';
      if (String(a.n_provider_id ?? '').startsWith('SM-MOCK-')) return 'submitted';
      return ['queued', 'accepted', 'sending', 'sent'].includes(ps) ? 'provider_accepted' : a.outcome;
    };
    return {
      overview: { ...this.rowOut({ ...f, assignee_name: f.assignee_name, c_phone: phone }), resolution: f.resolution ?? null, resolutionCategory: f.resolution_category ?? null, notes: f.notes ?? null,
        createdBy: f.created_by_user_id ? (f.creator_name ?? 'Staff') : 'AI receptionist', branchId: f.branch_id ?? null, dueTimeZone: f.due_tz ?? null, reopenedCount: n(f.reopened_count), waitingUntil: iso(f.waiting_until) },
      customer: c ? { id: c.id, name: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' '), phone: phone ? (fullContact ? phone : maskPhone(String(phone))) : null, email: c.email ? (fullContact ? c.email : String(c.email).replace(/^(.).*(@.*)$/, '$1•••$2')) : null,
        completedVisits: visits, upcoming: upcoming.map((u) => ({ id: u.id, date: u.d, start: u.start_time, status: u.status })), smsOptedOut: optOut, sharedPhoneProfiles: sharedPhone }
        : { id: null, name: null, phone: phone ? (fullContact ? phone : maskPhone(String(phone))) : null, unmatched: true, match: f.customer_match ?? 'unmatched', smsOptedOut: optOut, sharedPhoneProfiles: sharedPhone },
      call: call ? { providerCallId: call.provider_call_id, agent: call.agent_ref ?? null, startedAt: iso(call.started_at), endedAt: iso(call.ended_at), durationSeconds: call.duration_seconds ?? null,
        transfer: call.handoff_outcome === 'transferred' ? 'completed' : handoffs.some((h) => h.kind === 'transfer_failed') ? 'failed' : 'none_reported', disconnection: call.disconnection_reason ?? null,
        error: call.error_category ?? null, summary: call.summary ?? null, sentiment: call.sentiment ?? null, handoffs: handoffs.map((h) => ({ kind: h.kind, source: h.source, callbackRequired: !!h.callback_required, reason: h.reason, at: iso(h.created_at) })) } : null,
      attempts: attempts.map((a) => ({ id: a.id, channel: a.channel, outcome: smsState(a), recordedBy: a.actor_name ?? null, recipient: a.recipient_ref ?? null, note: a.note ?? null,
        nextAttemptAt: iso(a.next_attempt_at), at: iso(a.created_at), attestation: a.channel !== 'sms' })),
      recentContacts: recentContacts.map((r) => ({ source: String(r.source) as 'ai_follow_up' | 'end_of_day', at: iso(r.at), channel: String(r.channel), outcome: r.outcome ?? null, by: r.by_name ?? null, ref: String(r.ref) })),
      booking: { linked: linkedAppt ? { id: linkedAppt.id, date: linkedAppt.d, start: linkedAppt.start_time, status: linkedAppt.status, source: linkedAppt.source } : null, upcoming: upcoming.length },
      activity: activity.map((a) => ({ type: a.event_type, from: a.from_value, to: a.to_value, note: a.note, actor: a.actor_name ?? (a.event_type === 'created' && !a.actor_name ? 'AI receptionist' : null), at: iso(a.created_at) })),
      permissions: { canWork: this.can(ctx, 'communications.manage') || this.can(ctx, 'ai.manage'), canManage: this.can(ctx, 'ai.manage'), canText: this.can(ctx, 'reception_copilot.send_message'), canBook: this.can(ctx, 'pos.booking.create') },
    };
  }

  // ── A13 Nov 6: more sources, recommended assignee, hold expiry, health history ───────────────────────────────────────
  /** Bring in missed AI calls (hung up in under FU_MISSED_SECONDS, or flagged for follow-up, last 7 days) and failed / unknown
   *  Reception Copilot actions (last 7 days) as follow-ups. Idempotent: one task per source event (source_event_key). */
  async importSources(ctx: FuCtx) { return importFollowUpSources(this.db, ctx.tenantId, this.branch(ctx)); }
  /** Recommended assignee: the assignable staff member with the fewest open tasks in this branch (ties: assigned least recently).
   *  A suggestion only — a person still assigns. */
  async recommendAssignee(ctx: FuCtx) {
    this.needView(ctx); const b = this.branch(ctx);
    const r: Row | undefined = (await sql<Row>`select u.id, u.full_name, u.role,
        (select count(*)::int from ai_receptionist_follow_ups f where f.tenant_id = u.tenant_id and f.assigned_user_id = u.id and f.status = any(${ACTIVE}::text[])) open_tasks,
        (select max(f.assigned_at) from ai_receptionist_follow_ups f where f.tenant_id = u.tenant_id and f.assigned_user_id = u.id) last_assigned
      from users u where u.tenant_id = ${ctx.tenantId} and u.status = 'active' and u.role = any(${ASSIGNABLE_ROLES}::text[]) and (u.branch_id = ${b} or u.branch_id is null or ${b}::uuid is null)
      order by open_tasks asc, last_assigned asc nulls first, u.full_name, u.id limit 1`.execute(this.db)).rows[0];
    return r ? { userId: String(r.id), name: String(r.full_name ?? ''), role: String(r.role), openTasks: n(r.open_tasks), reason: `Fewest open follow-ups (${n(r.open_tasks)}) among staff who can take them.` } : null;
  }
  /** Hold expiry (A13 Nov 6): see expireFollowUpHolds */
  async expireHolds(tenantId?: string) { return expireFollowUpHolds(this.db, tenantId); }
  /** Check Follow-Up System history: every recorded run, newest first */
  async healthHistory(ctx: FuCtx, f: { page?: unknown; pageSize?: unknown } = {}) {
    this.needView(ctx); const b = this.branch(ctx);
    const size = [10, 20, 50].includes(Number(f.pageSize)) ? Number(f.pageSize) : 10; const page = Math.max(1, Math.trunc(Number(f.page)) || 1);
    const total = n((await sql<Row>`select count(*)::int c from ai_follow_up_health_runs where tenant_id = ${ctx.tenantId} and branch_id is not distinct from ${b}`.execute(this.db)).rows[0]?.c);
    const rows: Row[] = (await sql<Row>`select h.overall, h.results, h.ran_at, u.full_name from ai_follow_up_health_runs h left join users u on u.id = h.actor_user_id and u.tenant_id = h.tenant_id
      where h.tenant_id = ${ctx.tenantId} and h.branch_id is not distinct from ${b} order by h.ran_at desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ overall: String(r.overall), at: iso(r.ran_at), by: r.full_name ?? null, failed: (Array.isArray(r.results) ? r.results : []).filter((x: Row) => x.state === 'FAILED' || x.status === 'FAILED').length })),
      page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) };
  }

  // ── Check Follow-Up System (read-only) ────────────────────────────────────────────────────────────────────────
  async health(ctx: FuCtx) {
    this.needView(ctx);
    const T = ctx.tenantId, b = this.branch(ctx);
    const last: Row | undefined = (await sql<Row>`select overall, results, ran_at from ai_follow_up_health_runs where tenant_id = ${T} and branch_id is not distinct from ${b} and ran_at > now() - interval '30 seconds' order by ran_at desc limit 1`.execute(this.db)).rows[0];
    if (last) return { overall: last.overall, checks: last.results, ranAt: iso(last.ran_at), cached: true };
    const out: Row[] = [];
    const add = (domain: string, status: string, detail: string, evidence: string, next: string | null = null, owner = 'Owner / manager') => out.push({ domain, status, detail, evidence, nextAction: next, responsibleRole: owner, checkedAt: new Date().toISOString() });
    const guard = async (domain: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { add(domain, 'UNKNOWN', 'This check could not run.', String((e as Error)?.message ?? e).slice(0, 120)); } };
    await guard('voice_events', async () => {
      const agent: Row | undefined = (await sql<Row>`select provider_agent_id from ai_receptionist_agents where tenant_id = ${T} and provider = 'retell' and archived_at is null and provider_agent_id is not null limit 1`.execute(this.db)).rows[0];
      const signing = !!String(process.env.RETELL_WEBHOOK_SIGNING_KEY ?? '').trim();
      const ev: Row = (await sql<Row>`select count(*)::int n, max(last_received_at) last from voice_call_events where tenant_id = ${T} and auth = 'provider_signature'`.execute(this.db)).rows[0];
      if (!agent) add('voice_events', 'NOT_CONFIGURED', 'No Retell agent is linked to this salon.', 'ai_receptionist_agents: none', 'Link the agent in AI Front Desk.');
      else if (!signing) add('voice_events', 'NOT_CONFIGURED', 'Signed call events are refused: the webhook signing key is not set.', 'RETELL_WEBHOOK_SIGNING_KEY: absent', 'Set the signing key and register the webhook (owner approval).');
      else if (!n(ev.n)) add('voice_events', 'ATTENTION', 'The webhook is ready but no signed call event has arrived yet.', 'voice_call_events (signed): 0', 'Place an authorized test call.');
      else add('voice_events', 'READY', `${n(ev.n)} signed call events received.`, `last at ${iso(ev.last)}`, null);
    });
    await guard('handoff_detection', async () => {
      const h: Row = (await sql<Row>`select count(*)::int n, count(*) filter (where callback_required and follow_up_id is null)::int orphan from ai_handoff_events where tenant_id = ${T}`.execute(this.db)).rows[0];
      if (n(h.orphan)) add('handoff_detection', 'FAILED', `${n(h.orphan)} handoff event(s) required a callback but have no follow-up.`, 'ai_handoff_events.follow_up_id is null', 'Open Reconciliation and create the missing follow-ups.');
      else if (!n(h.n)) add('handoff_detection', 'UNKNOWN', 'No handoff has been detected yet, so the mapping is unproven.', 'ai_handoff_events: 0', 'Place an authorized test call that asks for a person.');
      else add('handoff_detection', 'READY', `${n(h.n)} handoff event(s), each mapped.`, 'no orphan callbacks', null);
    });
    await guard('task_durability', async () => {
      const k: Row = (await sql<Row>`select count(*)::int dup from (select provider_call_id, reason from ai_receptionist_follow_ups where tenant_id = ${T} and provider_call_id is not null and source = 'ai_receptionist' group by 1, 2 having count(*) > 1) x`.execute(this.db)).rows[0];
      const idx = (await sql<Row>`select 1 from pg_indexes where tablename = 'ai_receptionist_follow_ups' and indexname = 'uq_air_followup_source_key'`.execute(this.db)).rows.length;
      if (!idx) add('task_durability', 'FAILED', 'The one-task-per-handoff index is missing.', 'uq_air_followup_source_key absent', 'Apply migration 759.', 'Engineering');
      else if (n(k.dup)) add('task_durability', 'ATTENTION', `${n(k.dup)} call(s) have more than one AI task for the same reason (older rows from before the durable key).`, 'grouped by call + reason', 'Review and resolve the duplicates.');
      else add('task_durability', 'READY', 'Tasks are unique per handoff; writes are versioned and audited.', 'unique index present; no duplicates', null);
    });
    await guard('customer_identity', async () => {
      const m: Row = (await sql<Row>`select count(*) filter (where customer_match = 'ambiguous')::int amb, count(*) filter (where customer_match = 'unmatched')::int unm, count(*) filter (where caller_phone is not null and caller_phone !~ '^\\+[1-9][0-9]{7,14}$')::int bad
        from ai_receptionist_follow_ups where tenant_id = ${T} and status = any(${ACTIVE}::text[])`.execute(this.db)).rows[0];
      if (n(m.bad)) add('customer_identity', 'ATTENTION', `${n(m.bad)} open task(s) have a caller number without a country code; texting is blocked for them.`, 'caller_phone not E.164', 'Confirm the number with the customer.');
      else add('customer_identity', 'READY', `${n(m.amb)} ambiguous and ${n(m.unm)} unmatched caller(s) are kept separate — never merged.`, 'one profile per number → linked; several → ambiguous', null);
    });
    await guard('staff_assignment', async () => {
      const s: Row = (await sql<Row>`select count(*) filter (where f.assigned_user_id is null)::int unassigned, count(*) filter (where f.due_at < now())::int overdue,
          count(*) filter (where f.assigned_user_id is not null and (u.id is null or u.status <> 'active'))::int inactive
        from ai_receptionist_follow_ups f left join users u on u.id = f.assigned_user_id and u.tenant_id = f.tenant_id where f.tenant_id = ${ctx.tenantId} and ${this.branchScope(ctx)} and f.status = any(${ACTIVE}::text[])`.execute(this.db)).rows[0];
      if (n(s.inactive)) add('staff_assignment', 'FAILED', `${n(s.inactive)} task(s) are assigned to someone who is no longer active.`, 'assignee not active', 'Reassign them.');
      else if (n(s.overdue) || n(s.unassigned)) add('staff_assignment', 'ATTENTION', `${n(s.overdue)} overdue and ${n(s.unassigned)} unassigned task(s).`, 'active tasks', 'Assign and work the oldest first (Priority view).');
      else add('staff_assignment', 'READY', 'Every active task is assigned to active staff and none is overdue.', 'active tasks', null);
    });
    await guard('outreach_booking', async () => {
      const cred: Row | undefined = (await sql<Row>`select last_validated_at, last_validation_error from tenant_messaging_credentials where tenant_id = ${T} and offboarded_at is null and (branch_id = ${b} or branch_id is null) order by branch_id nulls last limit 1`.execute(this.db).catch(() => ({ rows: [] as Row[] }))).rows[0];
      if (!cred) add('outreach_booking', 'NOT_CONFIGURED', 'No salon Twilio account: texts go to the test sender and never reach customers.', 'tenant_messaging_credentials: none', 'Connect Twilio in Text Messaging Setup.');
      else if (cred.last_validation_error) add('outreach_booking', 'FAILED', 'The salon Twilio account failed its last check.', 'last_validation_error set', 'Run the SMS system check.');
      else add('outreach_booking', cred.last_validated_at ? 'READY' : 'ATTENTION', cred.last_validated_at ? 'Texts use the salon sender; consent and opt-outs are checked at send.' : 'Twilio is set but never checked.', 'tenant_messaging_credentials', cred.last_validated_at ? null : 'Run the SMS system check.');
    });
    await guard('background_jobs', async () => {
      const off = process.env.AI_FOLLOW_UP_ESCALATION === 'off';
      const o: Row = (await sql<Row>`select count(*)::int n from ai_receptionist_follow_ups f where f.tenant_id = ${T} and f.status = any(${ACTIVE}::text[]) and f.due_at < now() - interval '15 minutes'
          and not exists (select 1 from ai_follow_up_escalations e where e.tenant_id = f.tenant_id and e.follow_up_id = f.id and e.rule = ${OVERDUE_RULE})`.execute(this.db)).rows[0];
      if (off) add('background_jobs', 'DISABLED', 'The overdue escalation job is turned off.', 'AI_FOLLOW_UP_ESCALATION=off', 'Turn it back on.', 'Engineering');
      else if (n(o.n)) add('background_jobs', 'ATTENTION', `${n(o.n)} task(s) are overdue by 15+ minutes with no escalation — the job may not be running.`, 'overdue without escalation', 'Check the worker.', 'Engineering');
      else add('background_jobs', 'READY', 'Overdue tasks are escalated (one alert per task).', 'no stale overdue task', null);
    });
    await guard('ai_subscription', async () => {
      const pk: Row | undefined = (await sql<Row>`select status from tenant_ai_subscriptions where tenant_id = ${T} and package_code in ('ai_phone_call_assistant','ai_reception') order by updated_at desc limit 1`.execute(this.db).catch(() => ({ rows: [] as Row[] }))).rows[0];
      if (!pk) add('ai_subscription', 'UNKNOWN', 'No AI receptionist subscription record was found; manual follow-ups keep working.', 'tenant_ai_subscriptions: none', 'Check Plans & Usage.');
      else add('ai_subscription', ['active', 'trialing'].includes(String(pk.status)) ? 'READY' : 'DISABLED', `AI receptionist package: ${pk.status}. Existing and manual follow-ups stay available either way.`, 'tenant_ai_subscriptions', null);
    });
    const order = ['FAILED', 'NOT_CONFIGURED', 'ATTENTION', 'UNKNOWN', 'DISABLED', 'READY'];
    const overall = out.map((x) => x.status).sort((a, b2) => order.indexOf(a) - order.indexOf(b2))[0] ?? 'UNKNOWN';
    await sql`insert into ai_follow_up_health_runs (tenant_id, branch_id, actor_user_id, overall, results) values (${T}, ${b}, ${ctx.userId}, ${overall}, ${JSON.stringify(out)}::jsonb)`.execute(this.db);
    return { overall, checks: out, ranAt: new Date().toISOString(), cached: false };
  }

  // ── Priority & Escalation Assistant (recommendations only) ────────────────────────────────────────────────────
  async priorities(ctx: FuCtx) {
    this.needView(ctx);
    const rows: Row[] = (await sql<Row>`select ${FU_COLS}, u.status assignee_status, u.full_name assignee_name,
        (select count(*) from ai_follow_up_contact_attempts a where a.tenant_id = f.tenant_id and a.follow_up_id = f.id and a.outcome in ('no_answer','voicemail'))::int missed,
        (select kind from ai_handoff_events h where h.tenant_id = f.tenant_id and h.follow_up_id = f.id order by h.created_at limit 1) handoff_kind
      from ai_receptionist_follow_ups f left join users u on u.id = f.assigned_user_id and u.tenant_id = f.tenant_id
      where f.tenant_id = ${ctx.tenantId} and ${this.branchScope(ctx)} and f.status = any(${ACTIVE}::text[]) order by f.created_at asc, f.id asc limit 300`.execute(this.db)).rows;
    const out: Row[] = [];
    const now = Date.now();
    for (const r of rows) {
      const age = Math.round((now - new Date(r.created_at).getTime()) / 60000);
      const base = { taskId: r.id, version: n(r.version), reason: r.reason, priority: r.priority, ageMinutes: age, evidence: [] as string[] };
      if (r.reason === 'COMPLAINT' && n(r.escalation_level) === 0) out.push({ ...base, signal: 'urgent_complaint', rank: 0, recommendation: 'Ask a manager to review this complaint.', evidence: [`Reason recorded: COMPLAINT`, `Open for ${age} min`] });
      if (r.due_at && new Date(r.due_at).getTime() < now) out.push({ ...base, signal: 'overdue_callback', rank: 1, recommendation: 'Work this first: it is past its due time.', evidence: [`Overdue by ${Math.max(1, Math.round((now - new Date(r.due_at).getTime()) / 60000))} min`, r.assignee_name ? `Assigned to ${r.assignee_name}` : 'Unassigned'] });
      if (r.handoff_kind === 'transfer_failed' && !r.assigned_user_id) out.push({ ...base, signal: 'failed_transfer', rank: 2, recommendation: 'Route to the reception queue: the AI could not transfer this caller.', evidence: ['Provider reported a transfer that did not connect'] });
      if (n(r.missed) >= 2) out.push({ ...base, signal: 'repeated_missed_contact', rank: 3, recommendation: 'Try another way to reach the customer, only where they have consented.', evidence: [`${n(r.missed)} unanswered attempts recorded`] });
      if (r.assigned_user_id && r.assignee_status !== 'active') out.push({ ...base, signal: 'absent_assignee', rank: 4, recommendation: 'Reassign: the assignee is not active.', evidence: ['Assignee status is not active'] });
      else if (!r.assigned_user_id && age > 60) out.push({ ...base, signal: 'unassigned', rank: 5, recommendation: 'Assign a responsible person.', evidence: [`Unassigned for ${age} min`] });
    }
    const verif: Row[] = (await sql<Row>`select count(*)::int n from booking_verification_sessions where tenant_id = ${ctx.tenantId} and status in ('pending','sent') and expires_at > now()`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] as Row[] }))).rows;
    out.sort((a, b) => a.rank - b.rank || b.ageMinutes - a.ageMinutes);
    return { items: out.slice(0, 50), asOf: new Date(now).toISOString(), bookingsAwaitingVerification: n(verif[0]?.n), note: 'Recommendations only. Nothing is sent, booked, reassigned or resolved until a staff member does it.' };
  }
  async decide(ctx: FuCtx, b: { taskId?: string; signal?: string; decision?: string; note?: string; version?: number }) {
    this.needWork(ctx);
    const decision = String(b.decision ?? '');
    if (!['accept', 'dismiss', 'escalate'].includes(decision)) throw fail('Choose Accept, Dismiss or Escalate.', 'FOLLOWUP_CENTER_INVALID_FILTER', 400, { field: 'decision' });
    if (decision === 'escalate') return this.setPriority(ctx, String(b.taskId), { escalate: true, reason: b.note || `Assistant: ${b.signal}`, version: b.version });
    return this.db.transaction().execute(async (trx) => {
      await this.lock(ctx, trx, String(b.taskId), undefined, false);   // accept / dismiss only log the decision; nothing on the task changes
      await this.activity(trx, ctx, ctx.tenantId, String(b.taskId), `assistant_${decision}`, null, String(b.signal ?? '').slice(0, 40), b.note ? String(b.note).slice(0, 300) : null);
      return { ok: true };
    });
  }
}

/** overdue escalation: one owner alert per overdue period of a task; urgent overdue → high severity. Idempotent. */
export async function escalateOverdueFollowUps(db: Kysely<any>, now = new Date()): Promise<{ escalated: number }> {
  const rows: Row[] = (await sql<Row>`select f.id, f.tenant_id, f.branch_id, f.priority, f.reason, ${OVERDUE_RULE} as rule from ai_receptionist_follow_ups f
    where f.status = any(${ACTIVE}::text[]) and f.due_at < ${now.toISOString()}
      and not exists (select 1 from ai_follow_up_escalations e where e.tenant_id = f.tenant_id and e.follow_up_id = f.id and e.rule = ${OVERDUE_RULE}) limit 500`.execute(db)).rows;
  let escalated = 0;
  for (const r of rows) {
    const done = await db.transaction().execute(async (trx) => {
      const esc: Row | undefined = (await sql<Row>`insert into ai_follow_up_escalations (tenant_id, follow_up_id, rule, severity) values (${r.tenant_id}, ${r.id}, ${r.rule}, ${r.priority === 'urgent' ? 'high' : 'warning'})
        on conflict (tenant_id, follow_up_id, rule) do nothing returning id`.execute(trx)).rows[0];
      if (!esc) return false;
      const a: Row = (await sql<Row>`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
        values (${r.tenant_id}, ${r.branch_id}, 'ai_follow_up', ${r.priority === 'urgent' ? 'high' : 'warning'}, 'new', 'A follow-up is overdue', ${`A ${String(r.reason).toLowerCase()} follow-up is past its due time.`},
          ${JSON.stringify({ followUpId: r.id, rule: r.rule })}::jsonb, 'all') returning id`.execute(trx)).rows[0];
      await sql`update ai_follow_up_escalations set owner_alert_id = ${a.id} where id = ${esc.id}`.execute(trx);
      await sql`insert into ai_follow_up_activity (tenant_id, follow_up_id, actor_user_id, event_type, to_value, note) values (${r.tenant_id}, ${r.id}, null, 'overdue_alert', 'overdue', 'Overdue — manager alerted')`.execute(trx);
      return true;
    });
    if (done) escalated++;
  }
  return { escalated };
}
export const newRequestKey = () => randomUUID();

/** A13 Nov 6: an activity row written by the system (no staff actor) */
async function fuActivity(db: Kysely<any>, tenantId: string, id: string, type: string, from: string | null, to: string | null, note: string | null, meta: Row = {}) {
  await sql`insert into ai_follow_up_activity (tenant_id, follow_up_id, actor_user_id, event_type, from_value, to_value, note, metadata)
    values (${tenantId}, ${id}, null, ${type}, ${from}, ${to}, ${note}, ${JSON.stringify(meta)}::jsonb)`.execute(db);
}
/** A13 Nov 6: missed AI calls (hung up in under FU_MISSED_SECONDS, or flagged for a call back) and failed / unknown Reception
 *  Copilot actions of the last 7 days become follow-ups. Idempotent: one task per source event (source_event_key). */
export async function importFollowUpSources(db: Kysely<any>, T: string, b: string | null) {
  const missed: Row[] = (await sql<Row>`select o.provider_call_id, o.branch_id, o.caller_number, coalesce(o.started_at, o.created_at) at, o.follow_up_required
    from voice_call_outcomes o where o.tenant_id = ${T} and (${b}::uuid is null or o.branch_id = ${b}) and coalesce(o.started_at, o.created_at) > now() - interval '7 days'
      and ((o.abandoned and coalesce(o.duration_seconds, 0) < ${FU_MISSED_SECONDS}) or o.follow_up_required)
      and not exists (select 1 from ai_receptionist_follow_ups f where f.tenant_id = o.tenant_id and f.provider_call_id = o.provider_call_id)
    order by at limit 200`.execute(db)).rows;
  let calls = 0, copilot = 0;
  for (const m of missed) {
    const r = (await sql<Row>`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, status, caller_phone, provider_call_id, source, source_event_key, description, due_at)
      values (${T}, ${m.branch_id}, 'CALLBACK', 'normal', 'open', ${m.caller_number ?? null}, ${m.provider_call_id}, 'missed_call', ${'missed:' + m.provider_call_id},
        ${m.follow_up_required ? 'The AI flagged this call for a call back.' : 'Missed call — the caller hung up before the AI could help.'}, now() + interval '1 hour')
      on conflict do nothing returning id`.execute(db)).rows[0];
    if (r) { calls++; await fuActivity(db, T, String(r.id), 'created', null, 'open', null, { source: 'missed_call' }); }
  }
  const failed: Row[] = (await sql<Row>`select l.id, l.branch_id, l.action_type, l.state, l.error_code, l.resource_id from reception_copilot_action_ledger l
    where l.tenant_id = ${T} and (${b}::uuid is null or l.branch_id = ${b}) and l.state in ('failed', 'unknown') and l.created_at > now() - interval '7 days'
      and not exists (select 1 from ai_receptionist_follow_ups f where f.tenant_id = l.tenant_id and f.source_event_key = 'copilot:' || l.id::text)
    order by l.created_at limit 200`.execute(db)).rows;
  for (const l of failed) {
    const appt = /^[0-9a-f-]{36}$/i.test(String(l.resource_id ?? '')) && String(l.action_type).includes('appointment') ? String(l.resource_id) : null;
    const what = `Reception Copilot ${String(l.action_type).replace(/_/g, ' ')} ${l.state === 'unknown' ? 'has an unknown outcome — check the record by hand' : 'failed'}${l.error_code ? ` (${l.error_code})` : ''}.`;
    const r = (await sql<Row>`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, status, appointment_id, source, source_event_key, description, due_at)
      values (${T}, ${l.branch_id}, ${l.action_type === 'send_message' ? 'OTHER' : 'BOOKING_HELP'}, ${l.state === 'unknown' ? 'high' : 'normal'}, 'open', ${appt}::uuid, 'reception_copilot', ${'copilot:' + l.id},
        ${what}, now() + interval '30 minutes')
      on conflict do nothing returning id`.execute(db)).rows[0];
    if (r) { copilot++; await fuActivity(db, T, String(r.id), 'created', null, 'open', null, { source: 'reception_copilot' }); }
  }
  return { createdFromMissedCalls: calls, createdFromCopilot: copilot };
}

/** A13 Nov 6 — hold expiry: a task Waiting until a time goes back to In progress when that time passes (activity
 *  'hold_expired'), so it shows in the queue again. Run by the 5-minute follow-up job. */
export async function expireFollowUpHolds(db: Kysely<any>, tenantId?: string): Promise<{ returned: number }> {
  // through the follow-up lifecycle: waiting → in_progress (the only working state a Waiting task may move to)
  const rows: Row[] = (await sql<Row>`update ai_receptionist_follow_ups f set status = 'in_progress', waiting_until = null, version = version + 1, updated_at = now()
    where f.status = 'waiting' and f.waiting_until is not null and f.waiting_until <= now()
      and (${tenantId ?? null}::uuid is null or f.tenant_id = ${tenantId ?? null}::uuid) and ${canMoveToSql(AI_RECEPTIONIST_FOLLOW_UP, 'in_progress')}
    returning f.id, f.tenant_id`.execute(db)).rows;
  for (const r of rows) await fuActivity(db, String(r.tenant_id), String(r.id), 'hold_expired', 'waiting', 'in_progress', 'The waiting time passed; the follow-up is back in progress.');
  return { returned: rows.length };
}
/** A13 Nov 6 — the job's import: every salon with a candidate missed call or Copilot failure in the last 7 days */
export async function importAllFollowUpSources(db: Kysely<any>): Promise<{ tenants: number; created: number }> {
  const ts: Row[] = (await sql<Row>`select distinct tenant_id from voice_call_outcomes where coalesce(started_at, created_at) > now() - interval '7 days' and (abandoned or follow_up_required)
    union select distinct tenant_id from reception_copilot_action_ledger where state in ('failed', 'unknown') and created_at > now() - interval '7 days' limit 2000`.execute(db)).rows;
  let created = 0;
  for (const t of ts) { const r = await importFollowUpSources(db, String(t.tenant_id), null); created += r.createdFromMissedCalls + r.createdFromCopilot; }
  return { tenants: ts.length, created };
}
