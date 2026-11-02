// tech-self-service.ts — the Technician App's own-data reads that were missing (workforce audit #26/#99). Merged Oct 12 2026
// from the other chat's tech/tech-self-service.ts (tables: technician_shifts, technician_breaks 580, technician_workforce_state 579,
// ticket_compensation_snapshots, reviews).
//   Time Clock, Performance, Tips, My Customers.
//
// Rules shared by all four:
//   • the technician is resolved from the SESSION (tenant + user → technicians.id); never from client input;
//   • every number comes from the canonical stores — punches (technician_shifts), breaks (technician_breaks), the
//     immutable compensation snapshots (ticket_compensation_snapshots), reviews — nothing is re-derived from rates;
//   • "today"/"this week" are in the SALON'S timezone (half-open windows), like earnings;
//   • customers are shown as first name + last initial with visit history only — no phone, no email (the salon's
//     customer relationship, not hers).
import { sql, type Kysely } from 'kysely';
import { branchTimeZone } from '@aipowersalon/database';
import type { TechTimeClockView, TechPerformanceView, TechTipsView, TechCustomerRow } from '@aipowersalon/api-contracts/tenant';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
export type { TechTimeClockView, TechPerformanceView, TechTipsView, TechCustomerRow };   // owned by packages/api-contracts (Constitution 13 §13)

/** The salon's civil timezone (business-branch settings; the same resolver earnings and the time clock use). */
const resolveTenantTimezone = (db: Kysely<any>, tenantId: string, branchId: string | null) => branchTimeZone(db, tenantId, branchId);

export class TechSelfServiceError extends Error { constructor(public code: 'not_technician' | 'invalid', msg: string) { super(msg); this.name = 'TechSelfServiceError'; } }
export interface TechSelfCtx { tenantId: string; branchId?: string | null; userId: string }

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);
const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

export async function myTechnicianId(db: Kysely<any>, ctx: TechSelfCtx): Promise<string> {
  const r: any = await db.selectFrom('technicians').select('id').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('is_active', '=', true).executeTakeFirst();
  if (!r?.id) throw withCode(new TechSelfServiceError('not_technician', 'No active technician profile for this account at this salon.'), 'NO_TECHNICIAN_PROFILE');
  return r.id as string;
}

/** Salon-local day / ISO-week (Mon) bounds as timestamptz SQL fragments. */
/** Salon-day boundaries from ONE clock: the same `now` the minute arithmetic uses (it was the database's now() for the
 *  window and the process clock for the punch — two clocks, and a test that failed in the salon's first two hours). */
function bounds(tz: string, now: Date = new Date()) {
  const at = sql`${now.toISOString()}::timestamptz`;
  return {
    dayStart: sql`date_trunc('day', ${at} AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`,
    weekStart: sql`date_trunc('week', ${at} AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`,
    daysAgo: (d: number) => sql`(date_trunc('day', ${at} AT TIME ZONE ${tz}) - (${d} * interval '1 day')) AT TIME ZONE ${tz}`,
  };
}

export async function techTimeClock(db: Kysely<any>, ctx: TechSelfCtx, now = new Date()): Promise<TechTimeClockView> {
  const tid = await myTechnicianId(db, ctx);
  const tz = await resolveTenantTimezone(db, ctx.tenantId, ctx.branchId ?? null);
  const b = bounds(tz, now);
  const state: any = await db.selectFrom('technician_workforce_state').select(['clock_status']).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', tid).executeTakeFirst().catch(() => null);
  const shifts: any[] = await db.selectFrom('technician_shifts').select(['start_time', 'end_time'])
    .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', tid).where('start_time', 'is not', null)
    .where((eb: any) => eb.or([eb('start_time', '>=', b.weekStart), eb('end_time', 'is', null)])).orderBy('start_time', 'asc').execute();
  const breaks: any[] = await db.selectFrom('technician_breaks').select(['kind', 'started_at', 'ended_at'])
    .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', tid).where('started_at', '>=', b.dayStart).orderBy('started_at', 'asc').execute().catch(() => []);
  const dayStartRow: any = await sql<{ d: Date }>`select ${b.dayStart} as d`.execute(db);
  const dayStart = new Date(dayStartRow.rows[0].d);
  const punch = (s: any) => { const st = new Date(s.start_time); const en = s.end_time ? new Date(s.end_time) : now; return { start: st.toISOString(), end: s.end_time ? new Date(s.end_time).toISOString() : null, minutes: minutesBetween(st, en) }; };
  const all = shifts.map(punch);
  const today = all.filter((p) => new Date(p.start).getTime() >= dayStart.getTime() || p.end === null);
  const br = breaks.map((x) => { const st = new Date(x.started_at); const en = x.ended_at ? new Date(x.ended_at) : now; return { kind: String(x.kind || 'break'), start: st.toISOString(), end: x.ended_at ? en.toISOString() : null, minutes: minutesBetween(st, en) }; });
  const breakMinutes = br.reduce((a, x) => a + x.minutes, 0);
  return {
    clockStatus: state?.clock_status || (today.some((p) => p.end === null) ? 'CLOCKED_IN' : 'CLOCKED_OUT'), timezone: tz,
    today: { punches: today, breaks: br, workedMinutes: Math.max(0, today.reduce((a, p) => a + p.minutes, 0) - breakMinutes), breakMinutes },
    weekWorkedMinutes: all.reduce((a, p) => a + p.minutes, 0),
  };
}

export async function techPerformance(db: Kysely<any>, ctx: TechSelfCtx, days = 30): Promise<TechPerformanceView> {
  const windowDays = [7, 30, 90].includes(days) ? days : 30;
  const tid = await myTechnicianId(db, ctx);
  const tz = await resolveTenantTimezone(db, ctx.tenantId, ctx.branchId ?? null);
  const since = bounds(tz).daysAgo(windowDays - 1);
  const agg: any = await sql<any>`select count(*)::int as lines, count(distinct ticket_id)::int as tickets,
      coalesce(sum(gross_price_cents - discount_cents),0)::bigint as sales, coalesce(sum(card_tip_cents + cash_tip_cents),0)::bigint as tips
    from ticket_compensation_snapshots where tenant_id = ${ctx.tenantId} and technician_id = ${tid} and snapshot_at >= ${since}`.execute(db);
  const a = agg.rows[0] || {};
  const rev: any = await sql<any>`select avg(rating)::float as avg, count(*)::int as cnt from reviews
    where tenant_id = ${ctx.tenantId} and technician_id = ${tid} and coalesce(is_hidden_by_manager,false) = false and created_at >= ${since}`.execute(db).catch(() => ({ rows: [{}] }));
  const ret: any = await sql<any>`with mine as (
      select t.customer_id, count(distinct s.ticket_id) as visits from ticket_compensation_snapshots s join tickets t on t.id = s.ticket_id and t.tenant_id = s.tenant_id
      where s.tenant_id = ${ctx.tenantId} and s.technician_id = ${tid} and s.snapshot_at >= ${since} and t.customer_id is not null group by t.customer_id)
    select count(*)::int as customers, count(*) filter (where visits > 1)::int as returning from mine`.execute(db).catch(() => ({ rows: [{}] }));
  const r = rev.rows[0] || {}; const rc = ret.rows[0] || {};
  const sales = n(a.sales); const tickets = n(a.tickets); const tips = n(a.tips);
  return {
    windowDays, servicesCompleted: n(a.lines), ticketsServed: tickets, salesCents: sales, averageTicketCents: tickets ? Math.round(sales / tickets) : 0,
    tipsCents: tips, tipRatePercent: sales > 0 ? Math.round((tips / sales) * 1000) / 10 : null,
    rating: { average: r.avg != null ? Math.round(Number(r.avg) * 10) / 10 : null, count: n(r.cnt) },
    returningCustomerPercent: n(rc.customers) ? Math.round((n(rc.returning) / n(rc.customers)) * 100) : null,
  };
}

export async function techTips(db: Kysely<any>, ctx: TechSelfCtx, days = 14): Promise<TechTipsView> {
  const windowDays = [7, 14, 30].includes(days) ? days : 14;
  const tid = await myTechnicianId(db, ctx);
  const tz = await resolveTenantTimezone(db, ctx.tenantId, ctx.branchId ?? null);
  const since = bounds(tz).daysAgo(windowDays - 1);
  const rows: any = await sql<any>`select to_char((snapshot_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') as d,
      coalesce(sum(card_tip_cents),0)::bigint as card, coalesce(sum(cash_tip_cents),0)::bigint as cash
    from ticket_compensation_snapshots where tenant_id = ${ctx.tenantId} and technician_id = ${tid} and snapshot_at >= ${since}
    group by 1 order by 1 desc`.execute(db);
  const byDay = (rows.rows as any[]).map((r) => ({ date: String(r.d), cardCents: n(r.card), cashCents: n(r.cash) }));
  const cardCents = byDay.reduce((x, r) => x + r.cardCents, 0); const cashCents = byDay.reduce((x, r) => x + r.cashCents, 0);
  return { windowDays, totalCents: cardCents + cashCents, cardCents, cashCents, byDay };
}

/** VietnamesePOS §41 (Oct 28 2026 audit): the Tech app's customer search folds accents ("nguyen lan" finds "Nguyễn Lan") and
 *  matches across first + last name; a typed % or _ is a literal character, not a wildcard. */
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => '\\' + c);
export async function techCustomers(db: Kysely<any>, ctx: TechSelfCtx, search?: string): Promise<TechCustomerRow[]> {
  const tid = await myTechnicianId(db, ctx);
  const q = (search || '').trim().slice(0, 60);
  const rows: any = await sql<any>`select t.customer_id as cid, c.first_name, c.last_name, count(distinct s.ticket_id)::int as visits, max(s.snapshot_at) as last_at
    from ticket_compensation_snapshots s
    join tickets t on t.id = s.ticket_id and t.tenant_id = s.tenant_id
    join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
    where s.tenant_id = ${ctx.tenantId} and s.technician_id = ${tid} and s.snapshot_at >= now() - interval '365 days'
      and (${q ? sql`vi_fold(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) like '%' || vi_fold(${likeEscape(q)}) || '%'` : sql`true`})
    group by t.customer_id, c.first_name, c.last_name order by max(s.snapshot_at) desc limit 100`.execute(db);
  const list = rows.rows as any[];
  const ids = list.map((r) => r.cid);
  const svc = new Map<string, string[]>();
  if (ids.length) {
    const lines: any = await sql<any>`select t.customer_id as cid, l.service_name_snapshot as name, s.snapshot_at as at
      from ticket_compensation_snapshots s join tickets t on t.id = s.ticket_id and t.tenant_id = s.tenant_id
      join ticket_service_lines l on l.id = s.service_line_id and l.tenant_id = s.tenant_id
      where s.tenant_id = ${ctx.tenantId} and s.technician_id = ${tid} and t.customer_id in (${sql.join(ids)}) order by s.snapshot_at desc`.execute(db).catch(() => ({ rows: [] }));
    for (const l of lines.rows) { const arr = svc.get(l.cid) ?? []; if (l.name && arr.length < 3 && !arr.includes(l.name)) arr.push(l.name); svc.set(l.cid, arr); }
  }
  // customerKey is an opaque per-technician handle, not the customer id (she cannot use it against other endpoints).
  return list.map((r, i) => ({
    customerKey: `c${i + 1}`, displayName: `${String(r.first_name || '').trim()}${r.last_name ? ' ' + String(r.last_name).trim().charAt(0).toUpperCase() + '.' : ''}`.trim() || 'Customer',
    visits: n(r.visits), lastVisitAt: iso(r.last_at), lastServices: svc.get(r.cid) ?? [],
  }));
}
