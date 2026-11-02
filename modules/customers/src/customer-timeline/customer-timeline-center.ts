// customer-timeline-center.ts — Customer Timeline guide (Nov 1 2026): `/pos/customer-timeline/*`.
//
// A READ-ONLY, source-linked history of one customer. It keeps no copy of history ("not a second operational database"):
// every event is read, at request time, from the system that owns it, and its id is that source record's own id —
//   appointment   Booking (pos_tech_appointments)                    booked · the appointment's current status
//   visit         Check-In / queues (pos_queue_items, pos_queue_status_history) · Serving / Service Done / Checkout (tickets)
//   money         Payments (payments, payment_refunds, receipts)     amounts only for pos.checkout.view
//   benefit       Loyalty ledger · Memberships (membership_activity) · Gift Cards (gift_card_transactions)
//   communication customer_notifications · appointment_reminders_sent  message text only for pos.communications.view
//   profile       Customer Management (customers, customer_merge_logs)
// so a replayed delivery can never appear twice, a legitimate status change is its own event, and a back-filled old visit
// sorts by when it HAPPENED (occurred_at = paid / served / checked-in time), not when it was imported (recorded_at).
// Customer lookup and the Customer 360° summary are Customer Search's (reused, not rebuilt). Nothing here books, merges,
// charges, refunds, awards points, edits a profile or sends a message.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { VISIT_TICKET_STATUSES } from '../customers/customer-segments';
import { toStoredCustomerPhone } from '../customer-activation-rules/customer-activation-core';
import { RetentionRepository, isUuid, maskEmail, type RetentionContext, type BranchScope } from '../retention/retention.repository';

type Row = Record<string, any>;
const log = new Logger('CustomerTimeline');
export type TlCtx = RetentionContext;
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;

export class CustomerTimelineError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

export const TL_FAMILIES = ['appointment', 'visit', 'money', 'benefit', 'communication', 'profile'] as const;
export const TL_DATE_FIELDS = ['occurred', 'recorded', 'appointment'] as const;
export const TL_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year', 'custom'] as const;
export const TL_SORTS = ['newest', 'oldest', 'recently_added'] as const;
export const TL_PAGE_SIZES = [10, 25, 50, 100] as const;
export const TL_REQUIRED_INDEXES = ['ix_pos_queue_items_tenant_customer', 'ix_membership_activity_tenant_customer', 'ix_gift_cards_tenant_customer',
  'ix_payments_tenant_ticket', 'ix_receipts_tenant_ticket', 'idx_tickets_tenant_customer_paid', 'idx_pos_tech_appts_tenant_customer_date', 'idx_loyalty_ledger_tenant_customer_created'] as const;
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HEALTH_GAP_SECONDS = 30;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const uuidOrNull = (v: unknown) => (isUuid(String(v ?? '')) ? String(v) : null);

/** salon-local [from, to] for a preset given the salon's today */
export function tlPresetRange(preset: string, today: string): { from: string; to: string } | null {
  const d = (s: string) => new Date(s + 'T00:00:00Z'); const f = (x: Date) => x.toISOString().slice(0, 10);
  const add = (s: string, n: number) => { const x = d(s); x.setUTCDate(x.getUTCDate() + n); return f(x); };
  const t = d(today);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = add(today, -1); return { from: y, to: y }; }
    case 'week': { const s = add(today, -((t.getUTCDay() + 6) % 7)); return { from: s, to: add(s, 6) }; }
    case 'last_7': return { from: add(today, -6), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: f(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0))) };
    case 'last_month': return { from: f(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1))), to: f(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0))) };
    case 'last_30': return { from: add(today, -29), to: today };
    case 'last_90': return { from: add(today, -89), to: today };
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default: return null;
  }
}

export interface TlQuery { q?: unknown; family?: unknown; technician?: unknown; branch?: unknown; dateField?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown }
export interface TlView { money: boolean; messages: boolean; memberships: boolean }
export type TlCheckState = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
export interface TlCheck { key: string; state: TlCheckState; count?: number | null; detail?: Record<string, unknown> }

export class CustomerTimelineCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  private async scope(ctx: TlCtx, branch?: unknown): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, branch); }
    catch (e: any) { throw new CustomerTimelineError(e?.message ?? 'Unknown branch.', e?.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'TIMELINE_INVALID_BRANCH', e?.status ?? 400); }
  }
  /** the customer must be one this session may see (CR-02: home branch OR activity in an authorized branch) */
  private async assertCustomer(ctx: TlCtx, s: BranchScope, id: string): Promise<Row> {
    if (!isUuid(`${id}`)) throw new CustomerTimelineError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const vis = !s.branchIds ? sql`true` : sql`(c.branch_id = any(${s.branchIds}::uuid[])
      or exists (select 1 from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.branch_id = any(${s.branchIds}::uuid[]) and t.removed_at is null)
      or exists (select 1 from pos_tech_appointments a where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.branch_id = any(${s.branchIds}::uuid[])))`;
    const c = (await sql<Row>`select c.id, c.archived_at from customers c where c.tenant_id = ${T} and c.id = ${id}::uuid and ${vis}`.execute(this.db)).rows[0];
    // same answer for "another salon", "not your branches" and "does not exist" — knowing an id is not permission
    if (!c) throw new CustomerTimelineError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    return c;
  }
  private async period(ctx: TlCtx, f: TlQuery) {
    const preset = pick(TL_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    const w = await this.ret.window(ctx, { preset: 'today' });
    const today = w.today, tz = w.tz;
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    let from: string, to: string;
    if (preset === 'custom') {
      const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
      const b = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
      if (!a || !b) throw new CustomerTimelineError('Choose a From and a To date.', 'TIMELINE_INVALID_PERIOD');
      if (a > b) throw new CustomerTimelineError('The From date must be on or before the To date.', 'TIMELINE_INVALID_PERIOD');
      if (Date.parse(b) - Date.parse(a) > 1000 * 86400 * 366 * 20) throw new CustomerTimelineError('Choose a range of twenty years or less.', 'TIMELINE_INVALID_PERIOD');
      from = a; to = b;
    } else ({ from, to } = tlPresetRange(preset, today)!);
    const b = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(b.s) as Date | null, end: new Date(b.e) as Date | null, today, tz };
  }

  /** every event of one customer, as one uniform relation — each branch reads ONE owning source, tenant + customer scoped */
  private eventsSql(T: string, C: string) {
    return sql`
      select ('appt:' || a.id || ':booked') as id, 'appointment' as family, 'appointment_booked' as type, a.created_at as occurred_at, a.created_at as recorded_at,
        a.branch_id, coalesce((select 'ticket:' || q.ticket_id from pos_queue_items q where q.tenant_id = ${T} and q.appointment_id = a.id and q.ticket_id is not null limit 1), 'appt:' || a.id) as group_ref,
        a.id::text as ref_id, a.status, a.technician_id, null::bigint as amount_cents, a.appt_date,
        jsonb_build_object('date', a.appt_date, 'time', a.start_time, 'source', a.source, 'services', a.services, 'anyTechnician', a.any_technician) as meta
      from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = ${C}::uuid
      union all
      select ('appt:' || a.id || ':' || a.status), 'appointment', 'appointment_' || a.status, coalesce(case when a.status = 'arrived' then a.arrived_at end, a.updated_at), a.updated_at,
        a.branch_id, coalesce((select 'ticket:' || q.ticket_id from pos_queue_items q where q.tenant_id = ${T} and q.appointment_id = a.id and q.ticket_id is not null limit 1), 'appt:' || a.id),
        a.id::text, a.status, a.technician_id, null::bigint, a.appt_date,
        jsonb_build_object('date', a.appt_date, 'time', a.start_time, 'statusTimeIsLastUpdate', a.status <> 'arrived' or a.arrived_at is null)
      from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = ${C}::uuid and a.status <> 'booked'
      union all
      select ('queue:' || q.id || ':checked_in'), 'visit', 'checked_in', coalesce(q.checked_in_at, q.created_at), q.created_at, q.branch_id,
        coalesce('ticket:' || q.ticket_id, 'appt:' || q.appointment_id, 'queue:' || q.id), q.id::text, q.status, q.assigned_technician_id, null::bigint, null::date,
        jsonb_build_object('source', q.source, 'station', q.station)
      from pos_queue_items q where q.tenant_id = ${T} and q.customer_id = ${C}::uuid
      union all
      select ('queueh:' || h.id), 'visit', 'queue_' || h.to_status, h.created_at, h.created_at, h.branch_id,
        coalesce('ticket:' || q.ticket_id, 'appt:' || q.appointment_id, 'queue:' || q.id), q.id::text, h.to_status, null::uuid, null::bigint, null::date,
        jsonb_build_object('from', h.from_status, 'to', h.to_status, 'action', h.action)
      from pos_queue_status_history h join pos_queue_items q on q.id = h.queue_item_id and q.tenant_id = h.tenant_id
      where h.tenant_id = ${T} and q.customer_id = ${C}::uuid
      union all
      select ('ticket:' || t.id || ':started'), 'visit', 'service_started', t.serving_started_at, t.serving_started_at, t.branch_id, 'ticket:' || t.id::text, t.id::text, t.status, t.primary_technician_id, null::bigint, null::date,
        jsonb_build_object('ticketNumber', t.ticket_number)
      from tickets t where t.tenant_id = ${T} and t.customer_id = ${C}::uuid and t.serving_started_at is not null
      union all
      select ('ticket:' || t.id || ':done'), 'visit', 'service_done', t.service_done_at, t.service_done_at, t.branch_id, 'ticket:' || t.id::text, t.id::text, t.status, t.primary_technician_id, null::bigint, null::date,
        jsonb_build_object('ticketNumber', t.ticket_number)
      from tickets t where t.tenant_id = ${T} and t.customer_id = ${C}::uuid and t.service_done_at is not null
      union all
      select ('ticket:' || t.id || ':completed'), 'visit', 'visit_completed', coalesce(t.paid_at, t.finished_at, t.created_at), t.created_at, t.branch_id, 'ticket:' || t.id::text, t.id::text, t.status, t.primary_technician_id, t.total_cents, null::date,
        jsonb_build_object('ticketNumber', t.ticket_number, 'completedTimeKnown', t.paid_at is not null or t.finished_at is not null)
      from tickets t where t.tenant_id = ${T} and t.customer_id = ${C}::uuid and t.removed_at is null and t.status = any(${VISIT}::text[])
      union all
      select ('ticket:' || t.id || ':removed'), 'visit', 'ticket_removed', t.removed_at, t.removed_at, t.branch_id, 'ticket:' || t.id::text, t.id::text, t.status, t.primary_technician_id, null::bigint, null::date,
        jsonb_build_object('ticketNumber', t.ticket_number)
      from tickets t where t.tenant_id = ${T} and t.customer_id = ${C}::uuid and t.removed_at is not null
      union all
      select ('pay:' || p.id), 'money', 'payment_' || p.status, coalesce(p.approved_at, p.failed_at, p.created_at), p.created_at, p.branch_id, 'ticket:' || t.id::text, p.id::text, p.status, null::uuid, p.amount_cents, null::date,
        jsonb_build_object('method', p.method, 'cardBrand', p.card_brand, 'cardLast4', p.card_last4, 'tipCents', p.tip_cents, 'ticketNumber', t.ticket_number)
      from payments p join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id
      where p.tenant_id = ${T} and t.customer_id = ${C}::uuid
      union all
      select ('refund:' || rf.id), 'money', 'refund_' || rf.status, coalesce(rf.settled_at, rf.created_at), rf.created_at, rf.branch_id, 'ticket:' || t.id::text, rf.id::text, rf.status, null::uuid, rf.amount_cents, null::date,
        jsonb_build_object('paymentId', p.id, 'ticketNumber', t.ticket_number)
      from payment_refunds rf join payments p on p.id = rf.payment_id and p.tenant_id = rf.tenant_id join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id
      where rf.tenant_id = ${T} and t.customer_id = ${C}::uuid
      union all
      select ('receipt:' || rc.id), 'money', 'receipt_issued', rc.created_at, rc.created_at, rc.branch_id, 'ticket:' || t.id::text, rc.id::text, null::text, null::uuid, rc.total_cents, null::date,
        jsonb_build_object('receiptNumber', rc.receipt_number, 'emailed', rc.emailed_to is not null, 'emailTo', rc.emailed_to, 'ticketNumber', t.ticket_number)
      from receipts rc join tickets t on t.id = rc.ticket_id and t.tenant_id = rc.tenant_id
      where rc.tenant_id = ${T} and t.customer_id = ${C}::uuid
      union all
      select ('loyalty:' || l.id), 'benefit', 'loyalty_' || coalesce(l.entry_type, l.type), l.created_at, l.created_at, l.branch_id,
        coalesce(case when l.source_table = 'tickets' and l.source_id is not null then 'ticket:' || l.source_id end, 'loyalty:' || l.id), l.id::text, coalesce(l.entry_type, l.type), null::uuid, null::bigint, null::date,
        jsonb_build_object('points', coalesce(l.delta, l.amount), 'balanceAfter', coalesce(l.balance_after, l.running_balance), 'reason', coalesce(l.reason, l.description), 'sourceTable', l.source_table)
      from loyalty_ledger l where l.tenant_id = ${T} and l.customer_id = ${C}::uuid
      union all
      select ('membership:' || m.id), 'benefit', 'membership_' || m.activity_type, m.occurred_at, m.occurred_at, m.branch_id, 'membership:' || m.customer_membership_id, m.customer_membership_id::text, m.activity_type, null::uuid, m.amount_cents, null::date,
        jsonb_build_object('plan', m.plan_name_snapshot)
      from membership_activity m where m.tenant_id = ${T} and m.customer_id = ${C}::uuid
      union all
      select ('giftcard:' || g.id), 'benefit', 'gift_card_' || g.type, g.created_at, g.created_at, g.branch_id, coalesce('ticket:' || g.ticket_id, 'giftcard:' || gc.id), gc.id::text, g.type, null::uuid, g.amount_cents, null::date,
        jsonb_build_object('last4', gc.card_number_last4, 'balanceAfterCents', g.balance_after_cents)
      from gift_card_transactions g join gift_cards gc on gc.id = g.gift_card_id and gc.tenant_id = g.tenant_id
      where g.tenant_id = ${T} and gc.customer_id = ${C}::uuid
      union all
      select ('notice:' || n.id), 'communication', 'notification_' || n.type, n.created_at, n.created_at, null::uuid, 'notice:' || n.id, n.id::text, case when n.read_at is null then 'unread' else 'read' end, null::uuid, null::bigint, null::date,
        jsonb_build_object('title', n.title, 'body', n.body, 'reference', n.reference)
      from customer_notifications n where n.tenant_id = ${T} and n.customer_id = ${C}::uuid
      union all
      select ('reminder:' || r.id), 'communication', 'reminder_' || r.state, coalesce(r.reminded_at, r.updated_at, r.created_at), r.created_at, r.branch_id, 'appt:' || r.appointment_id, r.appointment_id::text, r.state, null::uuid, null::bigint, null::date,
        jsonb_build_object('channel', r.channel, 'leadMinutes', r.lead_minutes, 'reason', r.reason)
      from appointment_reminders_sent r where r.tenant_id = ${T} and r.customer_id = ${C}::uuid
      union all
      select ('customer:' || c.id || ':created'), 'profile', 'profile_created', c.created_at, c.created_at, c.branch_id, 'customer:' || c.id, c.id::text, c.status, null::uuid, null::bigint, null::date, '{}'::jsonb
      from customers c where c.tenant_id = ${T} and c.id = ${C}::uuid
      union all
      select ('merge:' || ml.id), 'profile', case when ml.target_customer_id = ${C}::uuid then 'profile_merged_in' else 'profile_merged_into' end, ml.created_at, ml.created_at, ml.branch_id, 'merge:' || ml.id, ml.id::text, null::text, null::uuid, null::bigint, null::date,
        jsonb_build_object('otherCustomerId', case when ml.target_customer_id = ${C}::uuid then ml.source_customer_id else ml.target_customer_id end)
      from customer_merge_logs ml where ml.tenant_id = ${T} and (ml.target_customer_id = ${C}::uuid or ml.source_customer_id = ${C}::uuid)`;
  }

  /** field-level visibility (guide: money, message text and destinations are role-restricted) */
  private shape(e: Row, view: TlView, techs: Map<string, string>, branches: Map<string, string>) {
    const meta: Record<string, unknown> = { ...(e.meta ?? {}) };
    if (!view.money) { delete meta.cardLast4; delete meta.cardBrand; delete meta.tipCents; }
    if (!view.messages) { delete meta.body; }
    if ('emailTo' in meta) { meta.emailTo = meta.emailTo ? maskEmail(String(meta.emailTo)) : null; }
    const money = e.family === 'money' || e.type === 'visit_completed' || (e.family === 'benefit' && String(e.type).startsWith('gift_card_'));
    const memberMoney = e.family === 'benefit' && String(e.type).startsWith('membership_');
    const amountVisible = e.amount_cents == null ? null : money ? view.money : memberMoney ? view.memberships : true;
    return {
      id: String(e.id), family: String(e.family), type: String(e.type), occurredAt: iso(e.occurred_at), recordedAt: iso(e.recorded_at),
      groupRef: String(e.group_ref), refId: e.ref_id ? String(e.ref_id) : null, status: e.status ?? null,
      branch: e.branch_id ? { id: String(e.branch_id), name: branches.get(String(e.branch_id)) ?? null } : null,
      technician: e.technician_id ? { id: String(e.technician_id), name: techs.get(String(e.technician_id)) ?? null } : null,
      amountCents: amountVisible ? N(e.amount_cents) : null, amountHidden: amountVisible === false,
      appointmentDate: e.appt_date ? String(e.appt_date).slice(0, 10) : null,
      meta, source: String(e.id).split(':')[0],
    };
  }
  private async names(T: string, rows: Row[]) {
    const techIds = [...new Set(rows.map((r) => r.technician_id).filter(Boolean).map(String))];
    const techs = new Map<string, string>();
    if (techIds.length) for (const t of (await sql<Row>`select id, coalesce(nullif(full_name, ''), trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) as name
      from technicians where tenant_id = ${T} and id = any(${techIds}::uuid[])`.execute(this.db)).rows) techs.set(String(t.id), String(t.name ?? '').trim());
    const branches = new Map<string, string>((await sql<Row>`select id, name from branches where tenant_id = ${T}`.execute(this.db)).rows.map((b) => [String(b.id), String(b.name ?? '')]));
    return { techs, branches };
  }

  async events(ctx: TlCtx, customerId: string, f: TlQuery, view: TlView) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    await this.assertCustomer(ctx, s, customerId);
    const C = customerId;
    const family = pick(TL_FAMILIES, f.family);
    const dateField = pick(TL_DATE_FIELDS, f.dateField) ?? 'occurred';
    const sort = pick(TL_SORTS, f.sort) ?? 'newest';
    const pageSize = (TL_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const p = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q && q.length < 2) throw new CustomerTimelineError('Type at least 2 characters.', 'TIMELINE_SEARCH_TOO_SHORT');
    const technician = f.technician != null && f.technician !== '' ? (isUuid(String(f.technician)) ? String(f.technician) : null) : undefined;
    if (technician === null) throw new CustomerTimelineError('Unknown technician.', 'TIMELINE_INVALID_FILTER');

    const where = [sql`true`];
    if (s.branchIds) where.push(sql`(e.branch_id is null or e.branch_id = any(${s.branchIds}::uuid[]))`);
    if (family) where.push(sql`e.family = ${family}`);
    if (dateField === 'appointment') where.push(sql`e.family = 'appointment'`);
    if (technician) where.push(sql`(e.technician_id = ${technician}::uuid or (e.group_ref like 'ticket:%' and exists (select 1 from ticket_service_lines l
      where l.tenant_id = ${T} and l.ticket_id::text = substr(e.group_ref, 8) and l.technician_id = ${technician}::uuid and l.removed_at is null)))`);
    if (p.start && p.end) {
      if (dateField === 'appointment') where.push(sql`e.appt_date >= ${p.from}::date and e.appt_date <= ${p.to}::date`);
      else if (dateField === 'recorded') where.push(sql`e.recorded_at >= ${p.start} and e.recorded_at < ${p.end}`);
      else where.push(sql`e.occurred_at >= ${p.start} and e.occurred_at < ${p.end}`);
    }
    if (q) {
      if (isUuid(`${q}`)) where.push(sql`(e.ref_id = ${q} or e.group_ref in (${'ticket:' + q}, ${'appt:' + q}))`);
      else if (/^#?\d{1,9}$/.test(q)) where.push(sql`(e.meta->>'ticketNumber' = ${q.replace('#', '')} or e.meta->>'receiptNumber' = ${q.replace('#', '')})`);
      else where.push(sql`(exists (select 1 from technicians tc where tc.tenant_id = ${T} and tc.id = e.technician_id
            and vi_fold(coalesce(tc.full_name, tc.first_name || ' ' || coalesce(tc.last_name, ''))) ilike ${'%'} || vi_fold(${likeEsc(q)}::text) || ${'%'})
          or (e.group_ref like 'ticket:%' and exists (select 1 from ticket_service_lines l where l.tenant_id = ${T} and l.ticket_id::text = substr(e.group_ref, 8)
            and l.removed_at is null and vi_fold(coalesce(l.service_name_snapshot, '')) ilike ${'%'} || vi_fold(${likeEsc(q)}::text) || ${'%'}))
          or (e.family = 'appointment' and vi_fold(coalesce(e.meta->>'services', '')) ilike ${'%'} || vi_fold(${likeEsc(q)}::text) || ${'%'}))`);
    }
    const W = sql.join(where, sql` and `);
    const E = this.eventsSql(T, C);
    const order = sort === 'oldest' ? sql`e.occurred_at asc nulls last, e.id asc`
      : sort === 'recently_added' ? sql`e.recorded_at desc nulls last, e.id desc`
      : sql`e.occurred_at desc nulls last, e.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from (${E}) e where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.* from (${E}) e where ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const head = (await sql<Row>`select max(e.occurred_at) as newest, max(e.recorded_at) as last_recorded from (${E}) e`.execute(this.db)).rows[0] ?? {};
    const { techs, branches } = await this.names(T, rows);
    return {
      customerId: C,
      items: rows.map((r) => this.shape(r, view, techs, branches)),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, family: family ?? null, technician: technician ?? null, dateField, preset: p.preset, from: p.from, to: p.to, sort },
      period: { from: p.from, to: p.to, timeZone: p.tz, today: p.today },
      freshness: { newestActivityAt: iso(head.newest), lastRecordedAt: iso(head.last_recorded), readAt: new Date(this.now()).toISOString(), source: 'live' },
      visibility: { money: view.money, messages: view.messages },
    };
  }

  /** one event re-read from its source (tenant + customer), with its visit's services / technicians when it has one — audited */
  async event(ctx: TlCtx, customerId: string, eventId: string, view: TlView, audit: AuditFn) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    await this.assertCustomer(ctx, s, customerId);
    if (typeof eventId !== 'string' || eventId.length > 120 || !/^[a-z]+:[0-9a-f-]{36}(:[a-z_]+)?$/i.test(eventId)) throw new CustomerTimelineError('Event not found.', 'TIMELINE_EVENT_NOT_FOUND', 404);
    const E = this.eventsSql(T, customerId);
    const scopeW = s.branchIds ? sql`(e.branch_id is null or e.branch_id = any(${s.branchIds}::uuid[]))` : sql`true`;
    const r = (await sql<Row>`select e.* from (${E}) e where e.id = ${eventId} and ${scopeW}`.execute(this.db)).rows[0];
    if (!r) throw new CustomerTimelineError('Event not found.', 'TIMELINE_EVENT_NOT_FOUND', 404);
    const { techs, branches } = await this.names(T, [r]);
    const out: Record<string, unknown> = { event: this.shape(r, view, techs, branches) };
    const ticketId = String(r.group_ref).startsWith('ticket:') ? String(r.group_ref).slice(7) : null;
    if (ticketId && isUuid(ticketId)) {
      const t = (await sql<Row>`select t.id, t.ticket_number, t.status, t.branch_id, t.created_at, t.serving_started_at, t.service_done_at, t.paid_at, t.removed_at,
          t.subtotal_cents, t.total_cents, t.tip_cents from tickets t where t.tenant_id = ${T} and t.id = ${ticketId}::uuid and t.customer_id = ${customerId}::uuid`.execute(this.db)).rows[0];
      if (t) {
        const lines = (await sql<Row>`select l.id, l.service_name_snapshot as service, l.duration_minutes_snapshot as minutes, l.status, l.started_at, l.completed_at, l.line_total_cents, l.is_add_on,
            coalesce(nullif(tc.full_name, ''), trim(coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))) as technician
          from ticket_service_lines l left join technicians tc on tc.id = l.technician_id and tc.tenant_id = l.tenant_id
          where l.tenant_id = ${T} and l.ticket_id = ${ticketId}::uuid and l.removed_at is null order by l.created_at, l.id`.execute(this.db)).rows;
        out.visit = {
          ticketId: String(t.id), ticketNumber: t.ticket_number ?? null, status: t.status, branch: t.branch_id ? branches.get(String(t.branch_id)) ?? null : null,
          checkedInAt: iso(t.created_at), startedAt: iso(t.serving_started_at), serviceDoneAt: iso(t.service_done_at), paidAt: iso(t.paid_at), removedAt: iso(t.removed_at),
          totals: view.money ? { subtotalCents: N(t.subtotal_cents), totalCents: N(t.total_cents), tipCents: N(t.tip_cents) } : null,
          services: lines.map((l) => ({ id: String(l.id), service: l.service ?? null, minutes: l.minutes == null ? null : N(l.minutes), status: l.status ?? null, technician: String(l.technician ?? '').trim() || null,
            startedAt: iso(l.started_at), completedAt: iso(l.completed_at), addOn: !!l.is_add_on, lineTotalCents: view.money ? N(l.line_total_cents) : null })),
          technicians: [...new Set(lines.map((l) => String(l.technician ?? '').trim()).filter(Boolean))],
        };
      }
    }
    await this.db.transaction().execute(async (trx) => { await audit(trx as unknown as Kysely<any>, { customerId, eventId, money: view.money, messages: view.messages }); });
    return out;
  }

  // ── Check Customer Timeline System (read-only; records its own evidence; one run per salon per 30 s) ─────────
  async check(ctx: TlCtx) {
    const T = ctx.tenantId;
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from customer_timeline_health_runs where tenant_id = ${T}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    {
      const checks: TlCheck[] = [];
      const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
      // every probe is a plain read; a failing source is reported, it never aborts the run
      const probe = async (q: any): Promise<Row | null> => {
        try { return (await q.execute(this.db)).rows[0] ?? {}; }
        catch (e) { log.warn(`timeline health probe failed: ${(e as Error)?.message ?? e}`); return null; }   // reported as UNAVAILABLE, never as zero
      };
      const SOURCES: [string, any][] = [
        ['customers', sql<Row>`select count(*)::int as n, max(updated_at) as at from customers where tenant_id = ${T}`],
        ['booking', sql<Row>`select count(*)::int as n, max(updated_at) as at from pos_tech_appointments where tenant_id = ${T} and customer_id is not null`],
        ['check_in', sql<Row>`select count(*)::int as n, max(created_at) as at from pos_queue_items where tenant_id = ${T} and customer_id is not null`],
        ['service_done', sql<Row>`select count(*)::int as n, max(coalesce(service_done_at, paid_at, created_at)) as at from tickets where tenant_id = ${T} and customer_id is not null`],
        ['payments', sql<Row>`select count(*)::int as n, max(created_at) as at from payments where tenant_id = ${T}`],
        ['loyalty', sql<Row>`select count(*)::int as n, max(created_at) as at from loyalty_ledger where tenant_id = ${T}`],
        ['memberships', sql<Row>`select count(*)::int as n, max(occurred_at) as at from membership_activity where tenant_id = ${T}`],
        ['gift_cards', sql<Row>`select count(*)::int as n, max(created_at) as at from gift_card_transactions where tenant_id = ${T}`],
        ['communications', sql<Row>`select count(*)::int as n, max(created_at) as at from customer_notifications where tenant_id = ${T}`],
      ];
      const src: Record<string, { ok: boolean; n: number; at: string | null }> = {};
      for (const [k, qq] of SOURCES) { const r = await probe(qq); src[k] = { ok: !!r, n: N(r?.n), at: iso(r?.at) }; }
      const down = Object.entries(src).filter(([, v]) => !v.ok).map(([k]) => k);
      checks.push({ key: 'sources', state: down.length ? 'FAILED' : 'PASSED', count: down.length, detail: { unavailable: down, newest: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v.at])) } });
      checks.push({ key: 'directory', state: !src.customers.ok ? 'UNAVAILABLE' : src.customers.n ? 'PASSED' : 'INSUFFICIENT_DATA', count: src.customers.n });

      const sample = toStoredCustomerPhone('(609) 555-0101');
      const phoneOff = N((await one(sql<Row>`select count(*)::int as n from (select normalized_phone from customers where tenant_id = ${T} and normalized_phone is not null order by updated_at desc limit 500) x
        where normalized_phone !~ '^\\+[1-9][0-9]{7,14}$'`)).n);
      checks.push({ key: 'phone_search', state: !sample ? 'FAILED' : phoneOff ? 'WARNING' : 'PASSED', count: phoneOff });

      const cross = N((await one(sql<Row>`select
          (select count(*) from tickets t join customers c on c.id = t.customer_id where t.tenant_id = ${T} and c.tenant_id <> t.tenant_id)
        + (select count(*) from pos_tech_appointments a join customers c on c.id = a.customer_id where a.tenant_id = ${T} and c.tenant_id <> a.tenant_id) as n`)).n);
      checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });

      const noLines = N((await one(sql<Row>`select count(*)::int as n from tickets t where t.tenant_id = ${T} and t.customer_id is not null and t.removed_at is null
        and t.status = any(${VISIT}::text[]) and coalesce(t.paid_at, t.created_at) >= now() - interval '90 days'
        and not exists (select 1 from ticket_service_lines l where l.tenant_id = t.tenant_id and l.ticket_id = t.id and l.removed_at is null)`)).n);
      checks.push({ key: 'visits_without_services', state: noLines ? 'WARNING' : 'PASSED', count: noLines });

      const unlinked = N((await one(sql<Row>`select count(*)::int as n from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id is not null and a.status = 'completed'
        and a.appt_date >= current_date - 90 and not exists (select 1 from pos_queue_items q where q.tenant_id = a.tenant_id and q.appointment_id = a.id and q.ticket_id is not null)`)).n);
      checks.push({ key: 'booking_to_service_done', state: unlinked ? 'WARNING' : 'PASSED', count: unlinked });

      const noTime = N((await one(sql<Row>`select count(*)::int as n from tickets where tenant_id = ${T} and customer_id is not null and removed_at is null
        and status = any(${VISIT}::text[]) and paid_at is null and finished_at is null`)).n);
      const future = N((await one(sql<Row>`select count(*)::int as n from tickets where tenant_id = ${T} and customer_id is not null and paid_at > now() + interval '1 day'`)).n);
      const backfilled = N((await one(sql<Row>`select count(*)::int as n from tickets where tenant_id = ${T} and customer_id is not null and paid_at is not null and created_at > paid_at + interval '1 day'`)).n);
      checks.push({ key: 'chronology', state: future ? 'FAILED' : noTime ? 'WARNING' : 'PASSED', count: future || noTime, detail: { completedWithoutTime: noTime, futureDated: future, backfilledKeepOwnDate: backfilled } });

      const orphan = N((await one(sql<Row>`select count(*)::int as n from customer_merge_logs ml where ml.tenant_id = ${T}
        and (exists (select 1 from tickets t where t.tenant_id = ${T} and t.customer_id = ml.source_customer_id)
          or exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = ml.source_customer_id))`)).n);
      checks.push({ key: 'merged_history', state: orphan ? 'WARNING' : 'PASSED', count: orphan });

      const ledgerOff = N((await one(sql<Row>`select count(*)::int as n from customer_loyalty_profiles lp where lp.tenant_id = ${T}
        and lp.points_balance <> coalesce((select sum(l.delta) from loyalty_ledger l where l.tenant_id = lp.tenant_id and l.customer_id = lp.customer_id), 0)`)).n);
      checks.push({ key: 'loyalty_ledger', state: ledgerOff ? 'WARNING' : src.loyalty.n ? 'PASSED' : 'INSUFFICIENT_DATA', count: ledgerOff });

      const idx = (await sql<Row>`select indexname from pg_indexes where indexname = any(${[...TL_REQUIRED_INDEXES]}::text[])`.execute(this.db)).rows.map((r) => String(r.indexname));
      const missing = TL_REQUIRED_INDEXES.filter((i) => !idx.includes(i));
      checks.push({ key: 'indexes', state: missing.length ? 'WARNING' : 'PASSED', count: missing.length, detail: { missing } });

      const noTz = N((await one(sql<Row>`select count(*)::int as n from branches where tenant_id = ${T} and (timezone is null or timezone = '') and deleted_at is null`)).n);
      checks.push({ key: 'timezone', state: noTz ? 'WARNING' : 'PASSED', count: noTz });

      const dupScan = await probe(sql<Row>`select (select count(*)::int from customer_duplicate_groups where tenant_id = ${T} and status in ('pending', 'in_review', 'deferred', 'failed')) as open,
          (select max(finished_at) from customer_duplicate_scans where tenant_id = ${T} and status = 'completed') as last`);
      checks.push({ key: 'duplicates', state: !dupScan ? 'UNAVAILABLE' : !dupScan.last ? 'INSUFFICIENT_DATA' : N(dupScan.open) ? 'WARNING' : 'PASSED', count: N(dupScan?.open) });

      const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
      checks.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
      const overall = checks.some((c) => c.state === 'FAILED' || c.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((c) => c.state === 'WARNING') ? 'WARNING'
        : checks.some((c) => c.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
      const runId = randomUUID();
      return this.db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtext('customer-timeline-health:' || ${T}))`.execute(trx);
        const raced = await recentRun(trx);
        if (raced) return reusedOut(raced);
        await sql`insert into customer_timeline_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
          values (${runId}, ${T}, ${uuidOrNull(ctx.branchId)}, ${uuidOrNull(ctx.userId)}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
        return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
      });
    }
  }
}
