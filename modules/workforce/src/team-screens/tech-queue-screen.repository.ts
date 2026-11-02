// tech-queue-screen.repository.ts — the read model beside the canonical Tech Queue board (/tech-queue, Oct 30 2026). The
// board itself (lanes, workload, waiting guests, AI insights, analytics, every action) stays on TechQueueController; this
// adds what the guide makes mandatory and the board did not have:
//   • LIVE QUEUE vs HISTORY over the ONE ticket table (pos_tech_queue_tickets) — open tickets in fair operational order
//     (assigned first-come, never newest-first), closed tickets newest first, nothing deleted or rewritten
//   • one search over technicians, live tickets and history (customer · phone any format · technician · service · ticket /
//     appointment / queue id) across every record of the salon, with explicit result scopes
//   • a ticket's timeline (its own timestamps, the queue status history and the linked checkout)
//   • Technician Assignment Details (status, qualified services, current guest, next assignment, break, recent history)
// Wait time is computed per phase and STOPS at a terminal event: an expired ticket shows how long it waited, not how long
// ago that was.
import { sql, type Kysely } from 'kysely';
import { N, iso, like, maskPhone, phoneDigits, paging, served, branchOf, teamPeriod, inPeriod, UUID, err, type TeamCtx, canAny } from './screen-kit';

export const TQ_OPEN = ['assigned', 'waiting_for_acceptance', 'accepted', 'ready_to_start', 'in_service', 'paused', 'delayed'];
export const TQ_CLOSED = ['service_done', 'declined', 'expired', 'cancelled', 'no_show'];
export const TQ_TABS = ['live', 'waiting', 'accepted', 'in_service', 'delayed', 'done_today', 'checkout_pending', 'history'] as const;
export const TQ_DATE_FIELDS = ['created', 'assigned', 'started', 'closed'] as const;
const can = canAny;

export class TechQueueScreenRepository {
  constructor(private readonly db: Kysely<any>) {}
  private br(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(q.branch_id = ${b} or q.branch_id is null)` : sql`true`; }
  /** minutes waited in the phase that matters, frozen at the terminal event */
  private waitSql() {
    return sql`round(extract(epoch from (case
        when q.status in ('assigned', 'waiting_for_acceptance', 'accepted', 'ready_to_start', 'delayed') then now()
        when q.started_at is not null then q.started_at
        else q.updated_at end) - coalesce(q.assigned_at, q.created_at)) / 60)::int`;
  }

  /** Assigned Tickets: one tab at a time. Live tabs are in operational order (first assigned first, then id); Service Done
   *  today / Checkout pending / History are newest first. Search reaches every ticket, not the page. */
  async tickets(ctx: TeamCtx, f: { tab?: string; q?: string; technicianId?: string; dateField?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const tab = (TQ_TABS as readonly string[]).includes(String(f.tab)) ? String(f.tab) : 'live';
    const hist = tab === 'history'; const per = await teamPeriod(this.db, ctx, hist ? f : { preset: 'today' }, hist ? 'week' : 'today');
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const { d, phoneish } = phoneDigits(raw); const isId = UUID.test(raw);
    const tid = f.technicianId && UUID.test(f.technicianId) ? f.technicianId : null;
    const df = (TQ_DATE_FIELDS as readonly string[]).includes(String(f.dateField)) ? String(f.dateField) : 'closed';
    const col = df === 'created' ? sql`q.created_at` : df === 'assigned' ? sql`q.assigned_at` : df === 'started' ? sql`q.started_at` : sql`q.updated_at`;
    const tabW = tab === 'live' ? sql`q.status = any(${TQ_OPEN})`
      : tab === 'waiting' ? sql`q.status in ('assigned', 'waiting_for_acceptance')` : tab === 'accepted' ? sql`q.status in ('accepted', 'ready_to_start')`
      : tab === 'in_service' ? sql`q.status in ('in_service', 'paused')` : tab === 'delayed' ? sql`(q.status = 'delayed' or coalesce(q.delay_status, 'none') <> 'none') and q.status = any(${TQ_OPEN})`
      : tab === 'done_today' ? sql`q.status = 'service_done' and ${inPeriod(sql`q.updated_at`, per)}`
      : tab === 'checkout_pending' ? sql`q.status = 'service_done' and tk.id is not null and tk.paid_at is null and tk.removed_at is null`
      : sql`q.status = any(${TQ_CLOSED}) and ${inPeriod(col, per)}`;
    const srch = raw === '' ? sql`true` : isId ? sql`(q.id = ${raw}::uuid or q.ticket_id = ${raw}::uuid or q.appointment_id = ${raw}::uuid or q.queue_item_id = ${raw}::uuid)`
      : sql`(coalesce(q.customer_name, '') ilike ${l} or coalesce(te.full_name, '') ilike ${l} or coalesce(tk.ticket_number, '') ilike ${l}
          or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(q.requested_services) = 'array' then q.requested_services else '[]'::jsonb end) e where coalesce(e->>'serviceName', e->>'name', '') ilike ${l})
          or (${phoneish} and right(regexp_replace(coalesce(q.customer_phone, ''), '\\D', '', 'g'), 10) like ${'%' + d + '%'}))`;
    const from = sql`from pos_tech_queue_tickets q left join technicians te on te.id = q.assigned_technician_id and te.tenant_id = q.tenant_id
      left join tickets tk on tk.id = q.ticket_id and tk.tenant_id = q.tenant_id`;
    const w = sql`q.tenant_id = ${T} and ${this.br(ctx)} and ${tabW} and ${srch} and (${tid}::uuid is null or q.assigned_technician_id = ${tid})`;
    const order = tab === 'live' || tab === 'waiting' || tab === 'accepted' || tab === 'in_service' || tab === 'delayed' ? sql`coalesce(q.assigned_at, q.created_at) asc, q.id asc` : sql`q.updated_at desc, q.id desc`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select q.id, q.customer_name, q.customer_phone, q.is_vip, q.source, q.priority, q.status, q.delay_status, q.requested_services, q.assigned_technician_id, te.full_name as tech,
        q.created_at, q.assigned_at, q.accepted_at, q.started_at, q.updated_at, q.appointment_id, q.ticket_id, q.queue_item_id, q.visit_part, tk.ticket_number, tk.paid_at, ${this.waitSql()} as wait
      ${from} where ${w} order by ${order} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const showPhone = can(ctx, 'customers.view');
    const via = (r: any) => (!raw ? null : isId ? 'id' : String(r.customer_name ?? '').toLowerCase().includes(raw.toLowerCase()) ? 'customer' : String(r.tech ?? '').toLowerCase().includes(raw.toLowerCase()) ? 'technician' : phoneish ? 'phone' : 'service');
    return { tab, period: hist ? per : null, items: rows.map((r: any) => ({ id: String(r.id), customer: r.customer_name ?? null, phone: showPhone ? r.customer_phone ?? null : maskPhone(r.customer_phone), vip: !!r.is_vip,
      source: String(r.source ?? ''), priority: String(r.priority ?? 'normal'), status: String(r.status), delay: r.delay_status && r.delay_status !== 'none' ? String(r.delay_status) : null,
      services: (Array.isArray(r.requested_services) ? r.requested_services : []).map((s: any) => String(s?.serviceName ?? s?.name ?? '')).filter(Boolean),
      technicianId: r.assigned_technician_id ? String(r.assigned_technician_id) : null, technician: r.tech ?? null, visitPart: r.visit_part ?? null,
      createdAt: iso(r.created_at), assignedAt: iso(r.assigned_at), acceptedAt: iso(r.accepted_at), startedAt: iso(r.started_at), updatedAt: iso(r.updated_at),
      waitMinutes: Math.max(0, N(r.wait)), waitFrozen: !TQ_OPEN.includes(String(r.status)) || !!r.started_at, ticketNumber: r.ticket_number ?? null, paid: !!r.paid_at, live: TQ_OPEN.includes(String(r.status)),
      appointmentId: r.appointment_id ? String(r.appointment_id) : null, matchedVia: via(r) })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** the counts behind the tabs (one statement) */
  async tabCounts(ctx: TeamCtx) {
    const T = ctx.tenantId; const per = await teamPeriod(this.db, ctx, { preset: 'today' });
    const r = (await sql<any>`select count(*) filter (where q.status = any(${TQ_OPEN}))::int as live, count(*) filter (where q.status in ('assigned', 'waiting_for_acceptance'))::int as waiting,
        count(*) filter (where q.status in ('accepted', 'ready_to_start'))::int as accepted, count(*) filter (where q.status in ('in_service', 'paused'))::int as in_service,
        count(*) filter (where (q.status = 'delayed' or coalesce(q.delay_status, 'none') <> 'none') and q.status = any(${TQ_OPEN}))::int as delayed,
        count(*) filter (where q.status = 'service_done' and ${inPeriod(sql`q.updated_at`, per)})::int as done_today,
        count(*) filter (where q.status = 'service_done' and tk.id is not null and tk.paid_at is null and tk.removed_at is null)::int as checkout_pending
      from pos_tech_queue_tickets q left join tickets tk on tk.id = q.ticket_id and tk.tenant_id = q.tenant_id where q.tenant_id = ${T} and ${this.br(ctx)}`.execute(this.db)).rows[0];
    return { live: N(r?.live), waiting: N(r?.waiting), accepted: N(r?.accepted), in_service: N(r?.in_service), delayed: N(r?.delayed), done_today: N(r?.done_today), checkout_pending: N(r?.checkout_pending) };
  }

  /** one ticket: identity, services, technician, every timestamp, the queue status history and the linked checkout */
  async ticket(ctx: TeamCtx, id: string) {
    const T = ctx.tenantId; if (!UUID.test(id)) throw err(404, 'TICKET_NOT_FOUND', 'That ticket is not in this salon.');
    const r = (await sql<any>`select q.id, q.customer_name, q.customer_phone, q.is_vip, q.source, q.priority, q.status, q.delay_status, q.delay_reason, q.notes, q.station, q.requested_services, q.assigned_technician_id, q.ticket_id, q.queue_item_id,
        q.appointment_id, q.version, q.created_at, q.assigned_at, q.accepted_at, q.started_at, q.updated_at, q.technician_notified_at, q.customer_notified_at, te.full_name as tech, tk.ticket_number, tk.status as ticket_status, tk.paid_at, tk.service_done_at, tk.total_cents from pos_tech_queue_tickets q
      left join technicians te on te.id = q.assigned_technician_id and te.tenant_id = q.tenant_id left join tickets tk on tk.id = q.ticket_id and tk.tenant_id = q.tenant_id
      where q.tenant_id = ${T} and q.id = ${id} and ${this.br(ctx)}`.execute(this.db)).rows[0];
    if (!r) throw err(404, 'TICKET_NOT_FOUND', 'That ticket is not in this salon.');
    const hist = r.queue_item_id ? (await sql<any>`select h.id, h.from_status, h.to_status, h.action, h.source, h.reason, h.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor, ft.full_name as from_tech, tt.full_name as to_tech
      from pos_queue_status_history h left join users u on u.id = h.actor_id left join technicians ft on ft.id = h.from_technician and ft.tenant_id = h.tenant_id left join technicians tt on tt.id = h.to_technician and tt.tenant_id = h.tenant_id
      where h.tenant_id = ${T} and h.queue_item_id = ${r.queue_item_id} order by h.created_at desc, h.id desc limit 50`.execute(this.db)).rows : [];
    const own = [['created', r.created_at], ['assigned', r.assigned_at], ['accepted', r.accepted_at], ['started', r.started_at], ['technician_notified', r.technician_notified_at], ['customer_notified', r.customer_notified_at],
      ...(TQ_CLOSED.includes(String(r.status)) ? [[String(r.status), r.updated_at]] : []), ...(r.paid_at ? [['paid', r.paid_at]] : [])].filter(([, at]) => !!at)
      .map(([k, at]) => ({ kind: String(k), at: iso(at) })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const showPhone = can(ctx, 'customers.view');
    return { id: String(r.id), customer: r.customer_name ?? null, phone: showPhone ? r.customer_phone ?? null : maskPhone(r.customer_phone), vip: !!r.is_vip, source: String(r.source ?? ''), priority: String(r.priority ?? 'normal'),
      status: String(r.status), delay: r.delay_status && r.delay_status !== 'none' ? { status: String(r.delay_status), reason: r.delay_reason ?? null } : null, notes: r.notes ?? null, station: r.station ?? null,
      services: (Array.isArray(r.requested_services) ? r.requested_services : []).map((s: any) => ({ serviceId: s?.serviceId ?? null, name: String(s?.serviceName ?? s?.name ?? ''), minutes: N(s?.estimatedDurationMinutes) || null })),
      technicianId: r.assigned_technician_id ? String(r.assigned_technician_id) : null, technician: r.tech ?? null, waitMinutes: null as number | null,
      checkout: r.ticket_id ? { ticketId: String(r.ticket_id), number: r.ticket_number ?? null, status: r.ticket_status ?? null, paidAt: iso(r.paid_at), totalCents: r.total_cents == null ? null : N(r.total_cents) } : null,
      appointmentId: r.appointment_id ? String(r.appointment_id) : null, version: N(r.version),
      timeline: own, history: hist.map((h: any) => ({ id: String(h.id), from: h.from_status ?? null, to: h.to_status ?? null, action: h.action ?? null, source: h.source ?? null, reason: h.reason ?? null, fromTech: h.from_tech ?? null, toTech: h.to_tech ?? null, actor: h.actor ?? null, at: iso(h.created_at) })) };
  }

  /** Technician Assignment Details: who she is, what she is doing, what is next, what she can do, what she did */
  async technician(ctx: TeamCtx, id: string, f: { page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; if (!UUID.test(id)) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    const b = branchOf(ctx);
    const t = (await sql<any>`select te.id, te.full_name, te.avatar_url, te.role_label, te.status, b.name as branch, ws.clock_status, ws.shift_status, ws.queue_status, ws.manual_unavailable, ws.break_started_at
      from technicians te left join branches b on b.id = te.branch_id and b.tenant_id = te.tenant_id left join technician_workforce_state ws on ws.technician_id = te.id and ws.tenant_id = te.tenant_id
      where te.tenant_id = ${T} and te.id = ${id} and (${b}::uuid is null or te.branch_id = ${b} or te.branch_id is null)`.execute(this.db)).rows[0];
    if (!t) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    const svc = (await sql<any>`select s.name from technician_services ts join services s on s.id = ts.service_id and s.tenant_id = ts.tenant_id where ts.tenant_id = ${T} and ts.technician_id = ${id} and s.status = 'active' order by lower(s.name) limit 40`.execute(this.db)).rows;
    const open = (await sql<any>`select q.id, q.customer_name, q.status, q.requested_services, q.assigned_at, q.started_at from pos_tech_queue_tickets q where q.tenant_id = ${T} and q.assigned_technician_id = ${id} and q.status = any(${TQ_OPEN})
      order by (q.status in ('in_service', 'paused')) desc, coalesce(q.assigned_at, q.created_at) asc, q.id asc limit 10`.execute(this.db)).rows;
    const per = await teamPeriod(this.db, ctx, { preset: 'today' });
    const appt = (await sql<any>`select a.id, a.customer_name, a.start_time, a.end_time, a.services from pos_tech_appointments a where a.tenant_id = ${T} and a.technician_id = ${id} and a.appt_date = ${per.today}::date
      and a.status in ('confirmed', 'booked', 'scheduled', 'pending', 'arrived', 'checked_in') and a.start_time >= to_char(now() at time zone ${per.tz}, 'HH24:MI') order by a.start_time, a.id limit 1`.execute(this.db)).rows[0];
    const { page, pageSize } = paging(f.page, f.pageSize, 6);
    const total = N((await sql<any>`select count(*)::int as n from pos_tech_queue_tickets q where q.tenant_id = ${T} and q.assigned_technician_id = ${id}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const recent = (await sql<any>`select q.id, q.customer_name, q.status, q.requested_services, q.source, coalesce(q.assigned_at, q.created_at) as at, q.updated_at, ${this.waitSql()} as wait from pos_tech_queue_tickets q
      where q.tenant_id = ${T} and q.assigned_technician_id = ${id} order by q.updated_at desc, q.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const names = (j: unknown) => (Array.isArray(j) ? j : []).map((s: any) => String(s?.serviceName ?? s?.name ?? '')).filter(Boolean);
    const cur = open.find((o: any) => o.status === 'in_service' || o.status === 'paused'); const next = open.filter((o: any) => o !== cur);
    const onBreak = t.clock_status === 'ON_BREAK' || t.queue_status === 'BREAK';
    return { technicianId: String(t.id), name: t.full_name ?? null, avatarUrl: t.avatar_url ?? null, role: t.role_label ?? null, branch: t.branch ?? null, account: String(t.status ?? ''),
      clock: t.clock_status ?? 'CLOCKED_OUT', shift: t.shift_status ?? 'OFF_SHIFT', queue: t.queue_status ?? 'OFF_SHIFT', manualUnavailable: !!t.manual_unavailable,
      onBreak, breakSince: onBreak ? iso(t.break_started_at) : null,
      assignable: t.clock_status === 'CLOCKED_IN' && t.queue_status === 'AVAILABLE' && !t.manual_unavailable && !cur,
      qualifiedServices: svc.map((s: any) => String(s.name)), qualifiedCount: svc.length,
      current: cur ? { id: String(cur.id), customer: cur.customer_name ?? null, services: names(cur.requested_services), startedAt: iso(cur.started_at) } : null,
      next: next.map((o: any) => ({ id: String(o.id), customer: o.customer_name ?? null, status: String(o.status), services: names(o.requested_services), assignedAt: iso(o.assigned_at) })),
      nextAppointment: appt ? { id: String(appt.id), customer: appt.customer_name ?? null, start: String(appt.start_time), end: appt.end_time ?? null, services: names(appt.services) } : null,
      recent: { items: recent.map((o: any) => ({ id: String(o.id), customer: o.customer_name ?? null, status: String(o.status), services: names(o.requested_services), source: String(o.source ?? ''), at: iso(o.at), closedAt: TQ_CLOSED.includes(String(o.status)) ? iso(o.updated_at) : null, waitMinutes: Math.max(0, N(o.wait)) })),
        page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages } };
  }

  /** one search, three scopes: TECHNICIAN · LIVE TICKET · HISTORY (never mixed) */
  async search(ctx: TeamCtx, q: { q?: string }) {
    const raw = String(q.q ?? '').trim().slice(0, 100);
    if (raw.length < 2) return { q: raw, technicians: { items: [], totalItems: 0 }, live: { items: [], totalItems: 0 }, history: { items: [], totalItems: 0 } };
    const T = ctx.tenantId; const l = like(raw); const { d, phoneish } = phoneDigits(raw); const b = branchOf(ctx);
    const tw = sql`te.tenant_id = ${T} and te.archived_at is null and (${b}::uuid is null or te.branch_id = ${b} or te.branch_id is null)
      and (te.full_name ilike ${l} or te.id::text = ${raw} or (${phoneish} and right(regexp_replace(coalesce(te.normalized_phone, te.phone_display, ''), '\\D', '', 'g'), 10) like ${'%' + d + '%'})
        or exists (select 1 from technician_services ts join services s on s.id = ts.service_id and s.tenant_id = ts.tenant_id where ts.tenant_id = ${T} and ts.technician_id = te.id and s.name ilike ${l}))`;
    const tn = N((await sql<any>`select count(*)::int as n from technicians te where te.tenant_id = ${T} and ${tw}`.execute(this.db)).rows[0]?.n);
    const tr = (await sql<any>`select te.id, te.full_name, te.avatar_url, ws.queue_status from technicians te left join technician_workforce_state ws on ws.technician_id = te.id and ws.tenant_id = te.tenant_id where te.tenant_id = ${T} and ${tw} order by lower(te.full_name), te.id limit 5`.execute(this.db)).rows;
    const [live, history] = await Promise.all([this.tickets(ctx, { tab: 'live', q: raw, pageSize: 5 }), this.tickets(ctx, { tab: 'history', q: raw, preset: 'all', pageSize: 5 })]);
    return { q: raw, technicians: { totalItems: tn, items: tr.map((r: any) => ({ technicianId: String(r.id), name: r.full_name ?? null, avatarUrl: r.avatar_url ?? null, queue: r.queue_status ?? 'OFF_SHIFT' })) },
      live: { totalItems: live.totalItems, items: live.items }, history: { totalItems: history.totalItems, items: history.items } };
  }
}
