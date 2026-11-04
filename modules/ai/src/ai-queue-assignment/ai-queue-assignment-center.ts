// ai-queue-assignment-center.ts — A6 AI Queue guide (Nov 4 2026): the three parts the page still lacked.
//   history(ctx, f)   §4  one search over customer name / phone / queue entry / ticket / appointment / technician /
//                         recommendation id, decision + technician filters, From → To in the salon's day, and numbered
//                         pages (10 / 20 / 50), newest first (created_at DESC, id DESC) — on the server, over every row.
//   health(ctx)       §9 Upgrade 1  "Check AI Queue System": each dependency tested on its own, per-component status
//                         READY / ATTENTION_REQUIRED / FAILED / DISABLED / NOT_CONFIGURED / UNKNOWN with the evidence,
//                         the exact failure and the fix. Read-only: it never assigns anyone. Each run is recorded (789).
//   entryDetail(ctx)  §8  what the guest overlay shows beside the engine panel: verified customer facts (no "prefers X"
//                         guess), related appointments, and the audit trail (decisions + the queue events' delivery).
// Every query is scoped to the caller's salon AND location.
import { withCode } from '@aipowersalon/api-contracts';   // a refusal's registry code beside its English
import { sql, type Kysely } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { QueueAssignmentForbiddenError, QueueAssignmentDisabledError, QueueAssignmentValidationError, type QueueAssignmentContext } from './ai-queue-assignment.dto';
import type { QueueAssignmentSettingsPort } from './ai-queue-assignment-settings';
import type { QueueAssignmentEntitlementPort } from './ai-queue-assignment-entitlement';
import type { QueueOpsQueuePort } from './ai-queue-assignment-ops.ports';
import { technicianIsFree } from './ai-queue-assignment-detection';

/** a stored JSON list (array column or JSON text); anything else is an empty list, said in the log — never a thrown read */
function jsonList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string' || !v.trim()) return [];
  try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { console.warn(`not a JSON list: ${(e as Error)?.message ?? e}`); return [] as unknown[]; }
}
export type QueueHealthStatus = 'READY' | 'ATTENTION_REQUIRED' | 'FAILED' | 'DISABLED' | 'NOT_CONFIGURED' | 'UNKNOWN';
export interface QueueHealthCheck { key: string; label: string; status: QueueHealthStatus; evidence: string; failure: string | null; fix: string | null; facts: Record<string, string | number>; checkedAt: string }
export interface QueueHealthRun { runId: string | null; overall: QueueHealthStatus; checkedAt: string; checks: QueueHealthCheck[]; note: string }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HISTORY_DECISIONS = ['accepted', 'rejected', 'overridden', 'kept_unassigned', 'auto_assigned'] as const;
export const PAGE_SIZES = [10, 20, 50] as const;
const N = (v: unknown) => Number(v ?? 0) || 0;
export const HISTORY_PRESETS = ['all', 'today', 'yesterday', 'week', 'month', 'year', 'custom'] as const;
const todayIn = (tz: string, now: number) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); } catch { return new Date(now).toISOString().slice(0, 10); } };
const addDays = (ymd: string, n: number) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)).toISOString().slice(0, 10);
/** a preset → whole salon days (Mon-start week); 'custom' keeps the given From / To; 'all' has no bounds */
export function historyPeriod(preset: string | undefined, today: string, from?: string, to?: string): { preset: string; from: string | null; to: string | null } {
  const p = (HISTORY_PRESETS as readonly string[]).includes(String(preset)) ? String(preset) : (from || to ? 'custom' : 'all');
  if (p === 'today') return { preset: p, from: today, to: today };
  if (p === 'yesterday') { const y = addDays(today, -1); return { preset: p, from: y, to: y }; }
  if (p === 'week') { const dow = new Date(today + 'T00:00:00Z').getUTCDay(); const f = addDays(today, -((dow + 6) % 7)); return { preset: p, from: f, to: addDays(f, 6) }; }
  if (p === 'month') { const last = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate(); return { preset: p, from: today.slice(0, 8) + '01', to: today.slice(0, 8) + String(last).padStart(2, '0') }; }
  if (p === 'year') return { preset: p, from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31' };
  if (p === 'custom') return { preset: p, from: from || null, to: to || null };
  return { preset: 'all', from: null, to: null };
}
const iso = (v: unknown) => (v ? new Date(v as string | number | Date).toISOString() : null);
const like = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const maskPhone = (p: unknown) => { const d = String(p ?? '').replace(/[^0-9]/g, ''); return d.length >= 4 ? '••• ' + d.slice(-4) : null; };
/** the order the overall status takes the worst of */
const SEVERITY: QueueHealthStatus[] = ['FAILED', 'UNKNOWN', 'ATTENTION_REQUIRED', 'NOT_CONFIGURED', 'DISABLED', 'READY'];

export class QueueAssignmentCenter {
  constructor(
    private readonly db: Kysely<any> | null,
    private readonly settings: QueueAssignmentSettingsPort,
    private readonly queue: QueueOpsQueuePort,
    private readonly entitlement?: QueueAssignmentEntitlementPort | null,
    private readonly now: () => number = Date.now,
  ) {}

  private need(ctx: QueueAssignmentContext, perm: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new QueueAssignmentForbiddenError('Not signed in.');
    if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new QueueAssignmentForbiddenError(`You need the "${perm}" permission for this.`);
  }
  private get d(): Kysely<any> { if (!this.db) throw withCode(new QueueAssignmentValidationError('The queue history needs the database.'), 'SERVICE_UNAVAILABLE'); return this.db; }
  private tz(ctx: QueueAssignmentContext) { return sql`coalesce((select b.timezone from branches b where b.id = ${ctx.branchId} and b.tenant_id = ${ctx.tenantId}), 'UTC')`; }

  // ── §4 history: search + filters + numbered pages ─────────────────────────────────────────────────────────────────
  async history(ctx: QueueAssignmentContext, f0: { q?: string; decision?: string; technicianId?: string; preset?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }) {
    this.need(ctx, 'ai_queue_assignment.view');
    if (this.entitlement && !(await this.entitlement.isEnabled(ctx.tenantId))) throw new QueueAssignmentDisabledError();
    const zone = String((await sql<any>`select coalesce((select timezone from branches where id = ${ctx.branchId} and tenant_id = ${ctx.tenantId}), 'UTC') tz`.execute(this.d)).rows[0]?.tz ?? 'UTC');
    const today = todayIn(zone, this.now());
    const period = historyPeriod(f0.preset, today, f0.from, f0.to);
    const f = { ...f0, from: period.from ?? undefined, to: period.to ?? undefined };
    if (f.from && !DAY.test(f.from)) throw withCode(new QueueAssignmentValidationError('Choose a valid From date.'), 'DATE_INVALID');
    if (f.to && !DAY.test(f.to)) throw withCode(new QueueAssignmentValidationError('Choose a valid To date.'), 'DATE_INVALID');
    if (f.from && f.to && f.to < f.from) throw withCode(new QueueAssignmentValidationError('The To date is before the From date.'), 'DATE_RANGE_INVALID');
    const size = (PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 20;
    const page = Math.max(1, Math.min(10_000, Math.floor(Number(f.page) || 1)));
    const tz = this.tz(ctx);
    const conds = [sql`d.tenant_id = ${ctx.tenantId}`, sql`d.branch_id = ${ctx.branchId}`];
    if (f.from) conds.push(sql`d.created_at >= (${f.from}::date::timestamp at time zone ${tz})`);
    if (f.to) conds.push(sql`d.created_at < ((${f.to}::date + 1)::timestamp at time zone ${tz})`);
    if (f.decision && (HISTORY_DECISIONS as readonly string[]).includes(f.decision)) conds.push(sql`d.decision = ${f.decision}`);
    if (f.technicianId && UUID.test(f.technicianId)) conds.push(sql`(d.chosen_technician = ${f.technicianId} or d.previous_technician = ${f.technicianId})`);
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q) {
      const digits = q.replace(/[^0-9]/g, '');
      const words = q.split(/\s+/).filter((w) => /\p{L}/u.test(w)).slice(0, 6);
      const nameOf = (col: any) => sql.join(words.map((w) => sql`vi_fold(coalesce(${col}, '')) like '%' || vi_fold(${like(w).slice(1, -1)}) || '%'`), sql` and `);
      const ors = [
        ...(words.length ? [sql`(${nameOf(sql`qi.customer_name`)})`, sql`(${nameOf(sql`coalesce(t.full_name, t.first_name || ' ' || t.last_name)`)})`] : []),
        // an id or the start of one: queue entry, decision, recommendation, ticket, appointment, customer
        sql`d.queue_entry_id ilike ${q.replace(/[\\%_]/g, '') + '%'}`, sql`d.id::text ilike ${q.replace(/[\\%_]/g, '') + '%'}`,
        sql`coalesce(d.recommendation_id::text, '') ilike ${q.replace(/[\\%_]/g, '') + '%'}`, sql`coalesce(qi.ticket_id::text, '') ilike ${q.replace(/[\\%_]/g, '') + '%'}`,
        sql`coalesce(qi.appointment_id::text, '') ilike ${q.replace(/[\\%_]/g, '') + '%'}`, sql`coalesce(qi.customer_id::text, '') ilike ${q.replace(/[\\%_]/g, '') + '%'}`,
      ];
      // a phone: four digits or more, compared on digits only (a shared family phone finds every guest who used it)
      if (digits.length >= 4) ors.push(sql`regexp_replace(coalesce(qi.customer_phone, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}`);
      conds.push(sql`(${sql.join(ors, sql` or `)})`);
    }
    const where = sql.join(conds, sql` and `);
    const from = sql`queue_assignment_decisions d
      left join pos_queue_items qi on qi.tenant_id = d.tenant_id and qi.id::text = d.queue_entry_id
      left join technicians t on t.tenant_id = d.tenant_id and t.id::text = d.chosen_technician
      left join technicians pt on pt.tenant_id = d.tenant_id and pt.id::text = d.previous_technician`;
    const total = N((await sql<any>`select count(*)::int n from ${from} where ${where}`.execute(this.d)).rows[0]?.n);
    const rows = (await sql<any>`select d.id, d.queue_entry_id, d.recommendation_id, d.decision, d.chosen_technician, d.previous_technician, d.reason, d.feedback_code,
        d.decided_by, d.applied, d.created_at, qi.customer_name, qi.customer_phone, qi.customer_id, qi.ticket_id, qi.appointment_id, qi.status as entry_status,
        coalesce(t.full_name, nullif(trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), '')) as tech_name,
        coalesce(pt.full_name, nullif(trim(coalesce(pt.first_name, '') || ' ' || coalesce(pt.last_name, '')), '')) as prev_tech_name
      from ${from} where ${where} order by d.created_at desc, d.id desc limit ${size} offset ${(page - 1) * size}`.execute(this.d)).rows;
    return {
      period: { ...period, tz: zone, today }, page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)), order: 'newest' as const,
      items: rows.map((r: any) => ({
        decisionId: String(r.id), queueEntryId: String(r.queue_entry_id), recommendationId: r.recommendation_id ? String(r.recommendation_id) : null,
        decision: String(r.decision), applied: !!r.applied, reason: r.reason ?? null, feedbackCode: r.feedback_code ?? null, decidedBy: r.decided_by ?? null, createdAt: iso(r.created_at),
        customerName: r.customer_name ?? null, maskedPhone: maskPhone(r.customer_phone), customerId: r.customer_id ? String(r.customer_id) : null,
        ticketId: r.ticket_id ? String(r.ticket_id) : null, appointmentId: r.appointment_id ? String(r.appointment_id) : null, entryStatus: r.entry_status ?? null,
        technicianId: r.chosen_technician ?? null, technicianName: r.tech_name ?? null, previousTechnicianId: r.previous_technician ?? null, previousTechnicianName: r.prev_tech_name ?? null,
      })),
    };
  }

  // ── §8 guest overlay: verified facts, appointments, audit ─────────────────────────────────────────────────────────
  async entryDetail(ctx: QueueAssignmentContext, queueEntryId: string) {
    this.need(ctx, 'ai_queue_assignment.view');
    if (!UUID.test(queueEntryId)) throw withCode(new QueueAssignmentValidationError('That queue entry could not be found.'), 'QUEUE_ITEM_NOT_FOUND');
    const e: any = (await sql<any>`select qi.id, qi.customer_id, qi.customer_name, qi.customer_phone, qi.status, qi.source, qi.priority, qi.is_vip, qi.checked_in_at, qi.called_at, qi.started_at,
        qi.ticket_id, qi.appointment_id, qi.assigned_technician_id, qi.requested_services, qi.notes,
        c.preferred_technician_id, c.created_at as customer_since,
        (select count(*)::int from tickets k where k.tenant_id = qi.tenant_id and k.customer_id = qi.customer_id and k.status = 'paid') as paid_visits,
        (select max(k.created_at) from tickets k where k.tenant_id = qi.tenant_id and k.customer_id = qi.customer_id and k.status = 'paid') as last_visit_at
      from pos_queue_items qi left join customers c on c.tenant_id = qi.tenant_id and c.id = qi.customer_id
      where qi.tenant_id = ${ctx.tenantId} and qi.branch_id = ${ctx.branchId} and qi.id = ${queueEntryId}`.execute(this.d)).rows[0];
    if (!e) throw withCode(new QueueAssignmentValidationError('That queue entry could not be found.'), 'QUEUE_ITEM_NOT_FOUND');
    // appointments live in pos_tech_appointments (the legacy `appointments` table was dropped in 041): date + 'HH:MM' in the salon's zone
    const tz = this.tz(ctx);
    const appts = e.customer_id ? (await sql<any>`select a.id, a.appt_date, a.start_time, a.end_time, a.status, a.source, a.technician_id,
        ((a.appt_date + a.start_time::time) at time zone ${tz}) as start_at, ((a.appt_date + a.end_time::time) at time zone ${tz}) as end_at,
        coalesce(t.full_name, nullif(trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), '')) as tech_name
      from pos_tech_appointments a left join technicians t on t.tenant_id = a.tenant_id and t.id = a.technician_id
      where a.tenant_id = ${ctx.tenantId} and a.branch_id = ${ctx.branchId} and a.customer_id = ${e.customer_id}
        and a.appt_date >= (now() at time zone ${tz})::date - 1 and a.appt_date < (now() at time zone ${tz})::date + 14
      order by a.appt_date asc, a.start_time asc limit 20`.execute(this.d)).rows : [];
    const events = (await sql<any>`select o.event_type, o.publish_status, o.attempt_count, o.occurred_at, o.published_at from outbox_events o
      where o.tenant_id = ${ctx.tenantId} and o.aggregate_id = ${queueEntryId} order by o.occurred_at desc limit 20`.execute(this.d).catch(() => ({ rows: [] as Array<Record<string, any>> }))).rows;
    const services = jsonList(e.requested_services);
    return {
      queueEntryId, status: e.status, source: e.source, priority: e.priority, isVip: !!e.is_vip,
      checkedInAt: iso(e.checked_in_at), calledAt: iso(e.called_at), startedAt: iso(e.started_at),
      waitMinutes: e.checked_in_at ? Math.max(0, Math.round((this.now() - new Date(e.checked_in_at).getTime()) / 60000)) : null,
      ticketId: e.ticket_id ? String(e.ticket_id) : null, appointmentId: e.appointment_id ? String(e.appointment_id) : null, assignedTechnicianId: e.assigned_technician_id ? String(e.assigned_technician_id) : null,
      requestedServices: services.map((s: any) => ({ serviceId: s?.serviceId ?? s?.service_id ?? null, name: s?.name ?? s?.serviceName ?? null })),
      notes: e.notes ?? null,
      // verified facts only — the customer record's own preferred technician, visit counts from paid tickets
      customer: { customerId: e.customer_id ? String(e.customer_id) : null, name: e.customer_name ?? null, maskedPhone: maskPhone(e.customer_phone),
        preferredTechnicianId: e.preferred_technician_id ? String(e.preferred_technician_id) : null, customerSince: iso(e.customer_since), paidVisits: N(e.paid_visits), lastVisitAt: iso(e.last_visit_at) },
      appointments: appts.map((a: any) => ({ appointmentId: String(a.id), date: a.appt_date instanceof Date ? a.appt_date.toISOString().slice(0, 10) : String(a.appt_date).slice(0, 10), startAt: iso(a.start_at), endAt: iso(a.end_at), status: a.status, source: a.source,
        technicianId: a.technician_id ? String(a.technician_id) : null, technicianName: a.tech_name ?? null })),
      events: events.map((o: any) => ({ eventType: o.event_type, deliveryStatus: o.publish_status, attempts: N(o.attempt_count), occurredAt: iso(o.occurred_at), publishedAt: iso(o.published_at) })),
    };
  }

  // ── §9 Upgrade 1: Check AI Queue System ───────────────────────────────────────────────────────────────────────────
  async lastHealth(ctx: QueueAssignmentContext): Promise<QueueHealthRun | null> {
    this.need(ctx, 'ai_queue_assignment.view');
    const r: any = (await sql<any>`select id, overall, checks, created_at from ai_queue_health_runs where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId}
      order by created_at desc, id desc limit 1`.execute(this.d)).rows[0];
    if (!r) return null;
    return { runId: String(r.id), overall: r.overall, checkedAt: iso(r.created_at)!, checks: typeof r.checks === 'string' ? JSON.parse(r.checks) : r.checks, note: NOTE };
  }

  async health(ctx: QueueAssignmentContext): Promise<QueueHealthRun> {
    this.need(ctx, 'ai_queue_assignment.view');
    const at = new Date(this.now()).toISOString();
    const out: QueueHealthCheck[] = [];
    // `facts` carry the numbers so the POS words each result in its own language; evidence / failure / fix are the English
    const add = (key: string, label: string, status: QueueHealthStatus, evidence: string, failure: string | null = null, fix: string | null = null, facts: Record<string, string | number> = {}): void => {
      out.push({ key, label, status, evidence, failure, fix, facts, checkedAt: at });
    };
    const attempt = async (key: string, label: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (e: any) { add(key, label, 'UNKNOWN', 'The check could not read its data.', String(e?.message ?? e).slice(0, 200), 'Run the check again; if it repeats, the data source is down.'); }
    };
    const scope = { tenantId: ctx.tenantId, branchId: ctx.branchId };
    const tz = this.tz(ctx);
    let eff: any = null;
    let snap: any = null;

    await attempt('entitlement', 'Plan & feature', async () => {
      const on = this.entitlement ? await this.entitlement.isEnabled(ctx.tenantId) : true;
      add('entitlement', 'Plan & feature', on ? 'READY' : 'DISABLED', on ? 'The AI Queue add-on is active for this salon.' : 'The AI Queue add-on is not active for this salon.', on ? null : 'Not active.', on ? null : 'Turn on AI Queue Assignment in the salon\'s AI add-ons.');
    });
    await attempt('settings', 'Settings & rotation policy', async () => {
      eff = await this.settings.effective(scope);
      const fixed = (eff.fixedOrder ?? []).length;
      add('settings', 'Settings & rotation policy', 'READY', `Rotation "${eff.rotationPolicy}", config version ${eff.configVersion}${fixed ? `, fixed order of ${fixed}` : ''}.`, null, null, { policy: String(eff.rotationPolicy), version: String(eff.configVersion), fixed });
    });
    await attempt('queue_sync', 'Queue synchronization', async () => {
      snap = await this.queue.snapshot(ctx);
      const db = (await sql<any>`select count(*) filter (where status in ('waiting','called','assigned','ready_for_tech'))::int active,
          count(*) filter (where status = 'in_service')::int in_service from pos_queue_items where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId}
          and checked_in_at >= now() - interval '1 day'`.execute(this.d)).rows[0];
      const seen = (snap.entries ?? []).filter((x: any) => ['waiting', 'called', 'assigned', 'ready_for_tech'].includes(x.status)).length;
      const ok = seen === N(db.active);
      add('queue_sync', 'Queue synchronization', ok ? 'READY' : 'ATTENTION_REQUIRED', `The AI reads ${seen} active guest(s); the queue holds ${N(db.active)} active and ${N(db.in_service)} in service (last 24 hours).`,
        ok ? null : 'The AI\'s view of the queue and the queue table disagree.', ok ? null : 'Refresh the Queue screen; an entry older than a day still active should be finished or removed there.', { seen, active: N(db.active), inService: N(db.in_service) });
    });
    await attempt('customers', 'Customers', async () => {
      const r = (await sql<any>`select count(*)::int total, count(*) filter (where qi.customer_id is null)::int walk_in,
          count(*) filter (where qi.customer_id is not null and c.id is null)::int missing
        from pos_queue_items qi left join customers c on c.tenant_id = qi.tenant_id and c.id = qi.customer_id
        where qi.tenant_id = ${ctx.tenantId} and qi.branch_id = ${ctx.branchId} and qi.status in ('waiting','called','assigned','ready_for_tech')`.execute(this.d)).rows[0];
      const linked = N(r.total) - N(r.walk_in);
      add('customers', 'Customers', N(r.missing) ? 'FAILED' : 'READY', `${N(r.total)} active guest(s): ${linked} linked to a customer record, ${N(r.walk_in)} name only.`,
        N(r.missing) ? `${N(r.missing)} guest(s) point to a customer record that is not in this salon.` : null, N(r.missing) ? 'Open each guest on the Queue screen and link the right customer.' : null,
        { total: N(r.total), linked, walkIn: N(r.walk_in), missing: N(r.missing) });
    });
    await attempt('technicians', 'Technician eligibility', async () => {
      const techs = snap?.technicians ?? (await this.queue.snapshot(ctx)).technicians;
      const free = techs.filter((t: any) => technicianIsFree(t)).length;
      add('technicians', 'Technician eligibility', techs.length === 0 ? 'NOT_CONFIGURED' : 'READY', `${techs.length} technician(s) at this location; ${free} free now.`,
        techs.length === 0 ? 'No technicians at this location.' : null, techs.length === 0 ? 'Add technicians to this location under Team.' : null, { total: techs.length, free });
    });
    await attempt('schedules', 'Schedules', async () => {
      const n = N((await sql<any>`select count(*)::int n from technician_shifts s where s.tenant_id = ${ctx.tenantId} and s.branch_id = ${ctx.branchId}
          and s.shift_date = (now() at time zone ${tz})::date`.execute(this.d)).rows[0]?.n);
      add('schedules', 'Schedules', n ? 'READY' : 'ATTENTION_REQUIRED', `${n} shift(s) today at this location.`,
        n ? null : 'No shifts today — the AI can only use who is clocked in.', n ? null : 'Check the staff schedule or have technicians clock in.', { shifts: n });
    });
    await attempt('breaks', 'Breaks', async () => {
      const r = (await sql<any>`select count(*) filter (where ended_at is null)::int open, count(*) filter (where ended_at is null and started_at < now() - interval '2 hours')::int stale
        from technician_breaks where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId} and started_at >= now() - interval '1 day'`.execute(this.d)).rows[0];
      add('breaks', 'Breaks', N(r.stale) ? 'ATTENTION_REQUIRED' : 'READY', `${N(r.open)} technician(s) on a break now.`,
        N(r.stale) ? `${N(r.stale)} break(s) open for more than 2 hours — those technicians are never suggested.` : null, N(r.stale) ? 'End the forgotten break on the Technicians screen.' : null, { open: N(r.open), stale: N(r.stale) });
    });
    await attempt('booking_conflicts', 'Booking conflicts', async () => {
      // appointments live in pos_tech_appointments: date + 'HH:MM' in the salon's zone
      const r = (await sql<any>`select count(*)::int n, count(distinct technician_id)::int techs from pos_tech_appointments where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId}
          and status in ('booked','confirmed') and appt_date between (now() at time zone ${tz})::date and (now() at time zone ${tz})::date + 1
          and ((appt_date + start_time::time) at time zone ${tz}) >= now() and ((appt_date + start_time::time) at time zone ${tz}) < now() + interval '2 hours'`.execute(this.d)).rows[0];
      add('booking_conflicts', 'Booking conflicts', 'READY', `${N(r.n)} appointment(s) in the next 2 hours for ${N(r.techs)} technician(s); the AI checks each one before it suggests a technician.`, null, null, { appointments: N(r.n), technicians: N(r.techs) });
    });
    await attempt('kill_switch', 'Kill switch', async () => {
      const e = eff ?? await this.settings.effective(scope);
      if (e.salonAutoKilled && e.autoAllowed) return add('kill_switch', 'Kill switch', 'FAILED', 'The kill switch is on but auto-assignment still reads as allowed.', 'The switch is not enforced.', 'Turn the kill switch off and on again, then re-run this check.');
      add('kill_switch', 'Kill switch', e.salonAutoKilled ? 'DISABLED' : 'READY', e.salonAutoKilled ? `Kill switch is ON${e.salonAutoKilledReason ? ` (${e.salonAutoKilledReason})` : ''} — no auto-assignment can run.` : 'Kill switch is off; it is enforced on the server for every auto-run.',
        null, null, { reason: e.salonAutoKilledReason ?? '' });
    });
    await attempt('auto_jobs', 'Auto-assignment jobs', async () => {
      const e = eff ?? await this.settings.effective(scope);
      const st = (await sql<any>`select last_scan_at, last_auto_run_at from queue_assignment_settings where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId}`.execute(this.d)).rows[0];
      const scanAge = st?.last_scan_at ? Math.round((this.now() - new Date(st.last_scan_at).getTime()) / 60000) : null;
      const facts = { scanMinutes: scanAge ?? -1, lastAutoRunAt: iso(st?.last_auto_run_at) ?? '' };
      if (!e.autoEnabled) return add('auto_jobs', 'Auto-assignment jobs', 'DISABLED', `Auto-assignment is off (staff assign every guest).${scanAge != null ? ` Last queue scan ${scanAge} min ago.` : ''}`, null, null, facts);
      const stale = scanAge == null || scanAge > 15;
      add('auto_jobs', 'Auto-assignment jobs', stale ? 'ATTENTION_REQUIRED' : 'READY', scanAge == null ? 'No queue scan has run at this location.' : `Last queue scan ${scanAge} min ago; last auto-run ${facts.lastAutoRunAt || 'never'}.`,
        stale ? 'The background scan has not run in the last 15 minutes.' : null, stale ? 'Check that the worker is running (System Operations).' : null, facts);
    });
    await attempt('realtime_events', 'Real-time events', async () => {
      const r = (await sql<any>`select count(*) filter (where publish_status = 'failed')::int failed,
          count(*) filter (where publish_status in ('pending','claimed') and occurred_at < now() - interval '5 minutes')::int late
        from outbox_events where tenant_id = ${ctx.tenantId} and (branch_id = ${ctx.branchId} or branch_id is null)
          and (event_type ilike 'queue%' or event_type ilike '%queue_assign%') and occurred_at >= now() - interval '1 day'`.execute(this.d)).rows[0];
      const status: QueueHealthStatus = N(r.failed) ? 'FAILED' : N(r.late) ? 'ATTENTION_REQUIRED' : 'READY';
      add('realtime_events', 'Real-time events', status, `Queue events in the last day: ${N(r.failed)} failed, ${N(r.late)} waiting more than 5 minutes.`,
        status === 'READY' ? null : 'Some queue updates did not reach the other screens.', status === 'READY' ? null : 'Screens refresh on their own; check the event publisher in System Operations.', { failed: N(r.failed), late: N(r.late) });
    });
    await attempt('idempotency', 'Duplicate protection', async () => {
      const n = N((await sql<any>`select count(*)::int n from pg_indexes where indexname = 'uq_qad_idempotency'`.execute(this.d)).rows[0]?.n);
      add('idempotency', 'Duplicate protection', n ? 'READY' : 'FAILED', n ? 'A repeated decision with the same key is recorded once (unique key on decisions).' : 'The unique key on decisions is missing.',
        n ? null : 'A double tap could record a decision twice.', n ? null : 'Run the database migrations.');
    });
    await attempt('audit', 'Audit trail', async () => {
      const r = (await sql<any>`select (select count(*)::int from queue_assignment_decisions where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId} and created_at >= now() - interval '7 days') decisions,
          (select count(*)::int from queue_assignment_settings_versions where tenant_id = ${ctx.tenantId}) versions`.execute(this.d)).rows[0];
      add('audit', 'Audit trail', 'READY', `${N(r.decisions)} decision(s) in the last 7 days, each with who and when; ${N(r.versions)} settings version(s) kept.`, null, null, { decisions: N(r.decisions), versions: N(r.versions) });
    });

    // a switched-off part (auto-assignment, the kill switch) is a choice, not a fault — only a disabled add-on makes the whole DISABLED
    const overall = SEVERITY.find((st) => out.some((c) => c.status === st && !(st === 'DISABLED' && c.key !== 'entitlement'))) ?? 'READY';
    let runId: string | null = null;
    try {
      const ins: any = (await sql<any>`insert into ai_queue_health_runs (tenant_id, branch_id, overall, checks, checked_by)
        values (${ctx.tenantId}, ${ctx.branchId}, ${overall}, ${JSON.stringify(out)}::jsonb, ${UUID.test(String(ctx.userId)) ? ctx.userId : null}) returning id`.execute(this.d)).rows[0];
      runId = ins?.id ? String(ins.id) : null;
    } catch (e) { console.warn(`ai-queue health run not kept (the result is still shown): ${(e as Error)?.message ?? e}`); }
    return { runId, overall, checkedAt: at, checks: out, note: NOTE };
  }
}

const NOTE = 'This check only reads; it assigned no one and changed nothing.';
