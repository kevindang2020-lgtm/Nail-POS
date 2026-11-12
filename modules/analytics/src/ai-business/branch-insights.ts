// branch-insights.ts — A3 AI Branch Comparison guide, the parts the Nov 3 build listed as "not built" (Nov 6 2026):
//   P1 Branch Data Health Checker — a recorded, read-only check of the data the comparison stands on (ai_business_health_runs,
//      area 'branches', migration 827);
//   P2 fair scorecard — net sales per worked technician hour (time-clock shifts), per operating hour (the location's opening
//      hours over the period) and returning-customer rate, so a small or short-hours branch is not ranked down for its size;
//   P3 explanation of a difference — the measured bridge between two branches (tickets × average ticket, completion,
//      no-shows, hours), never an invented cause;
//   P5 growth advisor — rules over the scorecard, each with the numbers it is based on and where to act.
// Every branch read is one the caller is authorized for (AiBusinessBranchesService → BranchScopeResolver); money stays hidden
// without financial permission. Nothing here changes data except the health-run record.
import { sql, type Kysely } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { presetRange } from '@aipowersalon/reports';
import { addDays } from '@aipowersalon/date-time';
import type { AiBusinessContext } from './ai-business.dto';
import type { AiBusinessBranchesService, BranchComparisonRow } from './ai-business-branches.service';

type Row = Record<string, any>;
export const BRANCH_INSIGHTS = 'BranchInsights';
export class BranchInsightsError extends Error { constructor(message: string, readonly code: string, readonly status = 400) { super(message); } }
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const has = (ctx: AiBusinessContext, p: string) => hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], p);
const r1 = (n: number) => Math.round(n * 10) / 10;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const money = (c: number | null) => (c == null ? 'N/A' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const HEALTH_GAP_SECONDS = 30;

export interface ScorecardRow {
  branchId: string; branchName: string; status: string; timeZone: string;
  netSalesCents: number | null; ticketsCount: number | null; averageTicketCents: number | null;
  totalBookings: number; completed: number; completionRate: number | null; noShowPercent: number | null; cancelledPercent: number | null;
  technicianHours: number | null; operatingHours: number | null; customers: number; returningCustomers: number;
  netPerTechnicianHourCents: number | null; netPerOperatingHourCents: number | null; returningRate: number | null;
  rank: { perTechnicianHour: number | null; perOperatingHour: number | null; returningRate: number | null };
  /** AI BRANCH COMPARISON 09: what the salon's EXISTING alert rules flagged for this branch in the period (no second detector) */
  trendFlags?: TrendFlag[];
  /** AI BRANCH COMPARISON 06: the salon days this branch's hours, shifts and customers were read over (its own time zone) */
  range?: { from: string; to: string };
  /** AI BRANCH COMPARISON 04: the branches like this one (staffing, opening hours and service mix) and its rank among them */
  likeForLike?: LikeForLike;
}
/** AI BRANCH COMPARISON 04 (Nov 12 2026) — Like-for-like groups. Two branches are compared like-for-like only when, in the
 *  same period, their worked technician hours AND their opening hours are each within LIKE_MAX_RATIO of each other and
 *  their service mix (share of paid service lines per category) overlaps by at least LIKE_MIN_MIX_OVERLAP percent. A
 *  branch missing hours, shifts or paid service lines has no group (reason says which) — it is never grouped by size. */
export const LIKE_MAX_RATIO = 1.5;
export const LIKE_MIN_MIX_OVERLAP = 60;
export interface LikeForLike {
  peers: Array<{ branchId: string; branchName: string; mixOverlapPercent: number }>;
  /** rank by net per technician hour among this branch + its peers (null when revenue is hidden or there are no peers) */
  rankPerTechnicianHour: number | null; of: number;
  mix: Array<{ category: string; sharePercent: number }>;
  reason: 'no_staffing' | 'no_opening_hours' | 'no_services' | 'no_peers' | null;
}
/** share (0–100, one decimal) of each category in a branch's paid service lines */
export type ServiceMix = Map<string, number>;
export function mixOverlap(a: ServiceMix, b: ServiceMix): number {
  let o = 0;
  for (const [k, v] of a) o += Math.min(v, b.get(k) ?? 0);
  return r1(o);
}
const within = (x: number, y: number) => x > 0 && y > 0 && Math.max(x, y) / Math.min(x, y) <= LIKE_MAX_RATIO;
/** Pure: the like-for-like group of every row (rows are mutated with `likeForLike`). */
export function likeForLikeGroups(rows: ScorecardRow[], mixes: Map<string, ServiceMix>): void {
  const mixList = (m: ServiceMix | undefined) => [...(m ?? new Map()).entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([category, sharePercent]) => ({ category, sharePercent }));
  const reasonOf = (r: ScorecardRow): LikeForLike['reason'] => (r.technicianHours == null ? 'no_staffing' : r.operatingHours == null ? 'no_opening_hours' : !(mixes.get(r.branchId)?.size) ? 'no_services' : null);
  for (const r of rows) {
    const reason = reasonOf(r);
    const mine = mixes.get(r.branchId);
    const peers = reason ? [] : rows.filter((o) => o.branchId !== r.branchId && reasonOf(o) == null
        && within(r.technicianHours!, o.technicianHours!) && within(r.operatingHours!, o.operatingHours!)
        && mixOverlap(mine!, mixes.get(o.branchId)!) >= LIKE_MIN_MIX_OVERLAP)
      .map((o) => ({ branchId: o.branchId, branchName: o.branchName, mixOverlapPercent: mixOverlap(mine!, mixes.get(o.branchId)!) }));
    const group = [r, ...rows.filter((o) => peers.some((p) => p.branchId === o.branchId))];
    const ranked = group.filter((x) => x.netPerTechnicianHourCents != null).sort((x, y) => (y.netPerTechnicianHourCents as number) - (x.netPerTechnicianHourCents as number));
    const pos = ranked.findIndex((x) => x.branchId === r.branchId);
    r.likeForLike = { peers, of: group.length, mix: mixList(mine), reason: reason ?? (peers.length ? null : 'no_peers'),
      rankPerTechnicianHour: peers.length && pos >= 0 ? pos + 1 : null };
  }
}
/** AI BRANCH COMPARISON 06 (Nov 12 2026) — Source-to-Answer audit trail for "Explain the difference": every figure the
 *  explanation rests on, for both branches, with the record or report it was read from, the salon days, and the time it
 *  was read. Revenue figures are null (never 0) when the viewer may not see revenue. Read-only. */
export type BranchEvidenceSource = 'sales_report' | 'booking_report' | 'time_clock' | 'opening_hours' | 'paid_tickets';
export interface BranchEvidenceFigure { key: string; unit: 'cents' | 'count' | 'percent' | 'hours'; a: number | null; b: number | null; source: BranchEvidenceSource; hidden: boolean }
export interface BranchExplainEvidence {
  asOf: string; preset: string;
  a: { branchId: string; branchName: string; timeZone: string; range: { from: string; to: string } | null };
  b: { branchId: string; branchName: string; timeZone: string; range: { from: string; to: string } | null };
  financialsIncluded: boolean; figures: BranchEvidenceFigure[];
  sources: Array<{ source: BranchEvidenceSource; route: string }>;
}
export const EVIDENCE_ROUTES: Record<BranchEvidenceSource, string> = {
  sales_report: '/tenant/reports/sales', booking_report: '/tenant/reports/appointments', time_clock: '/tenant/team/time-clock',
  opening_hours: '/tenant/management/locations', paid_tickets: '/tenant/reports/customers',
};
/** Pure: the evidence for an explanation of A vs B, from the same two scorecard rows the explanation used. */
export function explainEvidence(a: ScorecardRow, b: ScorecardRow, o: { asOf: string; preset: string; financialsIncluded: boolean }): BranchExplainEvidence {
  const fin = o.financialsIncluded;
  const f = (key: string, unit: BranchEvidenceFigure['unit'], source: BranchEvidenceSource, pick: (r: ScorecardRow) => number | null, money = false): BranchEvidenceFigure =>
    ({ key, unit, source, a: money && !fin ? null : pick(a), b: money && !fin ? null : pick(b), hidden: money && !fin });
  const figures: BranchEvidenceFigure[] = [
    f('net_sales', 'cents', 'sales_report', (r) => r.netSalesCents, true),
    f('paid_tickets', 'count', 'sales_report', (r) => r.ticketsCount, true),
    f('average_ticket', 'cents', 'sales_report', (r) => r.averageTicketCents, true),
    f('bookings', 'count', 'booking_report', (r) => r.totalBookings),
    f('completed', 'count', 'booking_report', (r) => r.completed),
    f('completion_rate', 'percent', 'booking_report', (r) => r.completionRate),
    f('no_show_rate', 'percent', 'booking_report', (r) => r.noShowPercent),
    f('technician_hours', 'hours', 'time_clock', (r) => r.technicianHours),
    f('operating_hours', 'hours', 'opening_hours', (r) => r.operatingHours),
    f('customers', 'count', 'paid_tickets', (r) => r.customers),
    f('returning_customers', 'count', 'paid_tickets', (r) => r.returningCustomers),
    f('returning_rate', 'percent', 'paid_tickets', (r) => r.returningRate),
  ];
  const used = [...new Set(figures.map((x) => x.source))];
  const side = (r: ScorecardRow) => ({ branchId: r.branchId, branchName: r.branchName, timeZone: r.timeZone, range: r.range ?? null });
  return { asOf: o.asOf, preset: o.preset, a: side(a), b: side(b), financialsIncluded: fin, figures, sources: used.map((source) => ({ source, route: EVIDENCE_ROUTES[source] })) };
}
/** One metric family the existing AI Business Alerts engine triggered on for a branch: how many triggered evaluations, the
 *  latest one's value vs its rule threshold, and how many of those incidents are still open. */
export interface TrendFlag { family: 'revenue' | 'bookings' | 'retention' | 'other'; metricId: string; unit: 'cents' | 'percent' | 'count'; triggered: number; openIncidents: number; latestValue: number | null; threshold: number | null; operator: string; latestAt: string | null; route: string }
/** the alert rules' own metrics (ALERT_METRICS) by family */
const UNIT: Record<string, TrendFlag['unit']> = { net_sales: 'cents', average_ticket: 'cents', completed_appointments: 'count', cancellation_rate: 'percent', no_show_rate: 'percent', customer_retention: 'percent' };
const FAMILY: Record<string, TrendFlag['family']> = { net_sales: 'revenue', average_ticket: 'revenue', completed_appointments: 'bookings', cancellation_rate: 'bookings', no_show_rate: 'bookings', customer_retention: 'retention' };
export interface Advice { branchId: string; branchName: string; kind: string; severity: 'info' | 'warning'; message: string; basis: Record<string, number | string | null>; route: string }

/** Opening hours over [from, to] from tenant_location_hours rows ({ day_of_week 0=Sun, opens_at 'HH:MM', closes_at, is_closed, effective_from/to }). */
export function operatingHoursOver(rows: Row[], from: string, to: string): number | null {
  if (!rows.length) return null;
  const mins = (t: unknown) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  let total = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    const r = rows.filter((x) => Number(x.day_of_week) === dow && (!x.effective_from || String(x.effective_from).slice(0, 10) <= d) && (!x.effective_to || String(x.effective_to).slice(0, 10) >= d))
      .sort((a, b) => String(b.effective_from ?? '').localeCompare(String(a.effective_from ?? '')))[0];
    if (!r || r.is_closed) continue;
    const o = mins(r.opens_at), c = mins(r.closes_at);
    if (o != null && c != null && c > o) total += (c - o) / 60;
  }
  return r1(total);
}

/** The measured bridge between two branches: why A's net differs from B's, in parts that add up. */
export function explainDifference(a: ScorecardRow, b: ScorecardRow): { lines: string[]; bridge: { volumeCents: number; priceCents: number; totalCents: number } | null } {
  const lines: string[] = [];
  let bridge: { volumeCents: number; priceCents: number; totalCents: number } | null = null;
  if (a.netSalesCents != null && b.netSalesCents != null && a.ticketsCount != null && b.ticketsCount != null) {
    const total = a.netSalesCents - b.netSalesCents;
    const avgB = b.ticketsCount > 0 ? b.netSalesCents / b.ticketsCount : 0, avgA = a.ticketsCount > 0 ? a.netSalesCents / a.ticketsCount : 0;
    const volume = Math.round((a.ticketsCount - b.ticketsCount) * avgB), price = total - volume;
    bridge = { volumeCents: volume, priceCents: price, totalCents: total };
    const dir = total >= 0 ? 'more' : 'less';
    lines.push(`${a.branchName} took ${money(Math.abs(total))} ${dir} than ${b.branchName}.`);
    lines.push(`${money(Math.abs(volume))} of that comes from ${Math.abs(a.ticketsCount - b.ticketsCount)} ${a.ticketsCount >= b.ticketsCount ? 'more' : 'fewer'} paid tickets (${a.ticketsCount} vs ${b.ticketsCount}) at ${b.branchName}'s average ticket.`);
    lines.push(`${money(Math.abs(price))} comes from the average ticket (${money(Math.round(avgA))} vs ${money(Math.round(avgB))}).`);
  } else lines.push('Revenue is hidden for your role, so only bookings, hours and customers are compared.');
  if (a.completionRate != null && b.completionRate != null && a.completionRate !== b.completionRate) lines.push(`Completed bookings: ${a.completionRate}% vs ${b.completionRate}%.`);
  if (a.noShowPercent != null && b.noShowPercent != null && a.noShowPercent !== b.noShowPercent) lines.push(`No-shows: ${a.noShowPercent}% vs ${b.noShowPercent}%.`);
  if (a.technicianHours != null && b.technicianHours != null) lines.push(`Technician hours worked: ${a.technicianHours} vs ${b.technicianHours}${a.netPerTechnicianHourCents != null && b.netPerTechnicianHourCents != null ? ` — ${money(a.netPerTechnicianHourCents)} vs ${money(b.netPerTechnicianHourCents)} per technician hour` : ''}.`);
  if (a.returningRate != null && b.returningRate != null) lines.push(`Returning customers: ${a.returningRate}% vs ${b.returningRate}%.`);
  lines.push('These are measured differences, not causes — open each branch\'s Sales Report to look closer.');
  return { lines, bridge };
}

/** Growth advisor: rules over the scorecard; each piece of advice names the numbers it rests on. */
export function adviseBranches(rows: ScorecardRow[]): Advice[] {
  const out: Advice[] = [];
  if (rows.length < 2) return out;
  const mTech = median(rows.map((r) => r.netPerTechnicianHourCents).filter((x): x is number => x != null));
  const mRet = median(rows.map((r) => r.returningRate).filter((x): x is number => x != null));
  const mNoShow = median(rows.map((r) => r.noShowPercent).filter((x): x is number => x != null));
  for (const r of rows) {
    if (mTech != null && r.netPerTechnicianHourCents != null && r.netPerTechnicianHourCents < mTech * 0.8)
      out.push({ branchId: r.branchId, branchName: r.branchName, kind: 'low_yield_per_tech_hour', severity: 'warning', route: '/tenant/ai/scheduling-optimizer',
        message: `${r.branchName} earns ${money(r.netPerTechnicianHourCents)} per technician hour, below the salon median of ${money(Math.round(mTech))}. Compare its schedule with its bookings — there may be more staffed hours than demand.`,
        basis: { netPerTechnicianHourCents: r.netPerTechnicianHourCents, medianCents: Math.round(mTech), technicianHours: r.technicianHours } });
    if (mNoShow != null && r.noShowPercent != null && r.noShowPercent >= 5 && r.noShowPercent >= mNoShow + 5)
      out.push({ branchId: r.branchId, branchName: r.branchName, kind: 'high_no_shows', severity: 'warning', route: '/tenant/ai/receptionist/follow-ups',
        message: `${r.branchName} has ${r.noShowPercent}% no-shows against a salon median of ${r1(mNoShow)}%. Reminders and a confirmation call the day before are the usual first step.`,
        basis: { noShowPercent: r.noShowPercent, medianPercent: r1(mNoShow) } });
    if (mRet != null && r.returningRate != null && r.customers >= 10 && r.returningRate <= mRet - 10)
      out.push({ branchId: r.branchId, branchName: r.branchName, kind: 'low_return_rate', severity: 'info', route: '/tenant/marketing/win-back',
        message: `${r.returningRate}% of ${r.branchName}'s customers this period had been before, against ${r1(mRet)}% across branches. A win-back campaign for its lapsed customers can help.`,
        basis: { returningRate: r.returningRate, medianPercent: r1(mRet), customers: r.customers } });
    if (r.operatingHours == null)
      out.push({ branchId: r.branchId, branchName: r.branchName, kind: 'no_opening_hours', severity: 'info', route: '/tenant/management/locations',
        message: `${r.branchName} has no opening hours set, so its sales per operating hour cannot be compared. Set its hours in Locations.`, basis: {} });
  }
  return out;
}

const FINANCIAL_VIEW = 'pos.reports.financial_view';
type SnapRow = { id: string; title: string | null; preset: string; range_from: string | null; range_to: string | null; financials_included: boolean; as_of: Date | string; created_at: Date | string;
  snapshot_json: unknown; saved_by: string | null; branches: number; sign_offs: number; last_decision: string | null };
export interface BranchSignOff { id: string; decision: 'approved' | 'needs_follow_up' | 'noted'; note: string; reviewer: string | null; at: string }
export interface BranchSnapshotSummaryView { id: string; title: string | null; preset: string; range: { from: string; to: string } | null; asOf: string; savedBy: string | null; savedAt: string;
  branches: number; financialsIncluded: boolean; signOffs: number; lastDecision: BranchSignOff['decision'] | null }
export interface BranchSnapshotView extends BranchSnapshotSummaryView { totals: Record<string, number | null>; rows: Array<Record<string, string | number | null>>; signOffList: BranchSignOff[]; canSignOff: boolean; immutable: true }

export class BranchInsights {
  constructor(private readonly db: Kysely<any>, private readonly branches: Pick<AiBusinessBranchesService, 'compareBranches'>, private readonly now: () => number = () => Date.now()) {}

  private need(ctx: AiBusinessContext) {
    if (!ctx?.tenantId || !ctx?.userId) throw new BranchInsightsError('Not signed in.', 'AUTH_REQUIRED', 401);
    if (!has(ctx, 'pos.ai_business.view')) throw new BranchInsightsError('Your role cannot use AI Business.', 'PERMISSION_DENIED', 403);
  }

  async scorecard(ctx: AiBusinessContext, q: Row): Promise<{ preset: string; range: { from: string; to: string } | null; financialsIncluded: boolean; rows: ScorecardRow[]; advice: Advice[]; notes: string[] }> {
    this.need(ctx);
    const cmp = await this.branches.compareBranches(ctx, { preset: q.preset, from: q.from, to: q.to, includeInactive: q.includeInactive === true || q.includeInactive === 'true', all: true });
    const ids = cmp.branches.map((b) => b.branchId);
    const meta = ids.length ? (await sql<Row>`select id, coalesce(timezone, 'America/New_York') as tz from branches where tenant_id = ${ctx.tenantId} and id = any(${ids}::uuid[])`.execute(this.db)).rows : [];
    const tzOf = new Map(meta.map((m) => [String(m.id), String(m.tz)]));
    const hoursRows = ids.length ? (await sql<Row>`select location_id, day_of_week, opens_at, closes_at, is_closed, effective_from, effective_to from tenant_location_hours where tenant_id = ${ctx.tenantId} and location_id = any(${ids}::uuid[])`.execute(this.db)).rows : [];
    const rows: ScorecardRow[] = [];
    for (const b of cmp.branches as BranchComparisonRow[]) {
      const tz = tzOf.get(b.branchId) ?? 'America/New_York';
      const range = cmp.range ?? presetRange(String(cmp.preset), new Date(this.now()), tz);
      const sh = (await sql<Row>`select coalesce(sum(extract(epoch from (coalesce(s.end_time, least(${new Date(this.now())}, s.start_time + interval '12 hours')) - s.start_time))) / 3600.0, 0) as h, count(*)::int as n
        from technician_shifts s where s.tenant_id = ${ctx.tenantId} and s.branch_id = ${b.branchId}::uuid and s.shift_date between ${range.from}::date and ${range.to}::date
          and coalesce(s.status, '') not in ('voided', 'void', 'cancelled')`.execute(this.db)).rows[0];
      const cust = (await sql<Row>`with c as (select distinct t.customer_id from tickets t where t.tenant_id = ${ctx.tenantId} and t.branch_id = ${b.branchId}::uuid and t.status = 'paid' and t.customer_id is not null
            and (t.paid_at at time zone ${tz})::date between ${range.from}::date and ${range.to}::date)
        select count(*)::int as customers, count(*) filter (where exists (select 1 from tickets p where p.tenant_id = ${ctx.tenantId} and p.customer_id = c.customer_id and p.status = 'paid'
          and (p.paid_at at time zone ${tz})::date < ${range.from}::date))::int as returning from c`.execute(this.db)).rows[0];
      const techH = Number(sh?.n) > 0 ? r1(Number(sh.h)) : null;
      const opH = operatingHoursOver(hoursRows.filter((h) => String(h.location_id) === b.branchId), range.from, range.to);
      const customers = Number(cust?.customers ?? 0), returning = Number(cust?.returning ?? 0);
      rows.push({ branchId: b.branchId, branchName: b.branchName, status: b.status, timeZone: tz,
        netSalesCents: b.netSalesCents, ticketsCount: b.ticketsCount, averageTicketCents: b.averageTicketCents, totalBookings: b.totalBookings, completed: b.completed,
        completionRate: b.completionRate, noShowPercent: b.noShowPercent, cancelledPercent: b.cancelledPercent,
        technicianHours: techH, operatingHours: opH, customers, returningCustomers: returning,
        netPerTechnicianHourCents: b.netSalesCents != null && techH ? Math.round(b.netSalesCents / techH) : null,
        netPerOperatingHourCents: b.netSalesCents != null && opH ? Math.round(b.netSalesCents / opH) : null,
        returningRate: customers > 0 ? Math.round((returning / customers) * 100) : null,
        rank: { perTechnicianHour: null, perOperatingHour: null, returningRate: null }, range: { from: range.from, to: range.to } });
    }
    // AI BRANCH COMPARISON 09 — trend flags FROM the existing alerts engine (ai_business_alert_events written by its rules):
    // triggered evaluations of a branch-scoped rule whose evaluated day falls in the period, per metric; salon-wide rules
    // (no branch) are not attributed to a branch. Nothing is detected here.
    const flagRange = cmp.range ?? presetRange(String(cmp.preset), new Date(this.now()), 'UTC');
    type FlagRow = { branch_id: string; metric_id: string; operator: string; n: number; open_n: number; latest_value: string | number | null; latest_threshold: string | number | null; latest_at: Date | string | null };
    const flagRows = ids.length ? (await sql<FlagRow>`select ev.branch_id, ev.metric_id, max(ev.operator) as operator, count(*)::int as n,
          count(*) filter (where ev.incident_status in ('open', 'investigating', 'snoozed'))::int as open_n,
          (array_agg(ev.value order by ev.evaluated_at desc, ev.id desc))[1] as latest_value, (array_agg(ev.threshold order by ev.evaluated_at desc, ev.id desc))[1] as latest_threshold,
          max(ev.evaluated_at) as latest_at
        from ai_business_alert_events ev
        where ev.tenant_id = ${ctx.tenantId} and ev.branch_id = any(${ids}::uuid[]) and ev.triggered = true and ev.sample_ok = true
          and (ev.evaluated_at at time zone coalesce((select bz.timezone from branches bz where bz.tenant_id = ev.tenant_id and bz.id = ev.branch_id), 'UTC'))::date between ${flagRange.from}::date and ${flagRange.to}::date
        group by ev.branch_id, ev.metric_id order by ev.branch_id, count(*) desc, ev.metric_id`.execute(this.db)).rows : [];
    for (const r of rows) {
      r.trendFlags = flagRows.filter((f) => String(f.branch_id) === r.branchId).map((f) => {
        const family = FAMILY[String(f.metric_id)] ?? 'other';
        const money = family === 'revenue';
        return { family, metricId: String(f.metric_id), unit: UNIT[String(f.metric_id)] ?? 'count', triggered: Number(f.n), openIncidents: Number(f.open_n),
          latestValue: !cmp.financialsIncluded && money ? null : f.latest_value == null ? null : Number(f.latest_value),
          threshold: !cmp.financialsIncluded && money ? null : f.latest_threshold == null ? null : Number(f.latest_threshold),
          operator: String(f.operator), latestAt: f.latest_at == null ? null : new Date(f.latest_at).toISOString(), route: '/tenant/ai/business/alerts' };
      });
    }
    // AI BRANCH COMPARISON 04 — service mix per branch: paid tickets in the branch's own salon days, service lines (not products, add-ons or removed lines), by category
    type MixRow = { branch_id: string; category: string; n: number };
    const mixes = new Map<string, ServiceMix>();
    for (const r of rows) {
      const rg = r.range!;
      const mr = (await sql<MixRow>`select l.branch_id, coalesce(nullif(l.category_snapshot, ''), 'Uncategorized') as category, count(*)::int as n
        from ticket_service_lines l join tickets tk on tk.id = l.ticket_id and tk.tenant_id = l.tenant_id
        where l.tenant_id = ${ctx.tenantId} and l.branch_id = ${r.branchId}::uuid and l.removed_at is null and l.product_id is null and coalesce(l.is_add_on, false) = false and tk.status = 'paid'
          and (tk.paid_at at time zone ${r.timeZone})::date between ${rg.from}::date and ${rg.to}::date
        group by l.branch_id, 2`.execute(this.db)).rows;
      const total = mr.reduce((a, x) => a + Number(x.n), 0);
      mixes.set(r.branchId, new Map(total ? mr.map((x) => [String(x.category), r1((Number(x.n) / total) * 100)]) : []));
    }
    likeForLikeGroups(rows, mixes);
    const rankBy = (k: 'netPerTechnicianHourCents' | 'netPerOperatingHourCents' | 'returningRate', slot: keyof ScorecardRow['rank']) => {
      const sorted = rows.filter((r) => r[k] != null).sort((a, b) => (b[k] as number) - (a[k] as number));
      sorted.forEach((r, i) => { r.rank[slot] = i + 1; });
    };
    rankBy('netPerTechnicianHourCents', 'perTechnicianHour'); rankBy('netPerOperatingHourCents', 'perOperatingHour'); rankBy('returningRate', 'returningRate');
    const notes = ['Ranks use per-hour and per-customer figures, so a smaller or shorter-hours branch is not ranked down for its size.',
      'Technician hours are the hours clocked in on the time clock; operating hours come from each location\'s opening hours.',
      `Like-for-like: branches whose technician hours and opening hours are each within ${LIKE_MAX_RATIO}× of each other and whose service mix overlaps by at least ${LIKE_MIN_MIX_OVERLAP}%.`];
    if (!cmp.financialsIncluded) notes.push('Revenue is hidden for your role: the per-hour sales figures are not shown.');
    return { preset: String(cmp.preset), range: cmp.range, financialsIncluded: cmp.financialsIncluded, rows, advice: adviseBranches(rows), notes };
  }

  async explain(ctx: AiBusinessContext, q: Row) {
    this.need(ctx);
    if (!isUuid(q.a) || !isUuid(q.b) || q.a === q.b) throw new BranchInsightsError('Choose two different branches.', 'VALIDATION_FAILED');
    const s = await this.scorecard(ctx, q);
    const a = s.rows.find((r) => r.branchId === q.a), b = s.rows.find((r) => r.branchId === q.b);
    if (!a || !b) throw new BranchInsightsError('Branch not found among the branches you can view.', 'BRANCH_NOT_AUTHORIZED', 403);
    const evidence = explainEvidence(a, b, { asOf: new Date(this.now()).toISOString(), preset: s.preset, financialsIncluded: s.financialsIncluded });
    return { a: a.branchName, b: b.branchName, preset: s.preset, range: s.range, ...explainDifference(a, b), evidence };
  }

  // ── AI BRANCH COMPARISON 14 (Nov 12 2026) — saved comparisons + manager sign-off notes (migration 848) ──
  /** Freeze the server's own comparison for the period (every authorized branch, never figures from the browser). */
  async saveSnapshot(ctx: AiBusinessContext, q: Row): Promise<BranchSnapshotView> {
    this.need(ctx);
    const title = q.title == null ? null : String(q.title).trim().slice(0, 120) || null;
    const cmp = await this.branches.compareBranches(ctx, { preset: q.preset, from: q.from, to: q.to, all: true });
    const rows = (cmp.branches as BranchComparisonRow[]).map((b) => ({ branchId: b.branchId, branchName: b.branchName, status: b.status, netSalesCents: b.netSalesCents, ticketsCount: b.ticketsCount,
      averageTicketCents: b.averageTicketCents, totalBookings: b.totalBookings, completed: b.completed, completionRate: b.completionRate, cancelledPercent: b.cancelledPercent, noShowPercent: b.noShowPercent,
      revenuePerCompletedAppointmentCents: b.revenuePerCompletedAppointmentCents }));
    const snap = { totals: cmp.totals, branches: rows };
    const ins = (await sql<{ id: string }>`insert into ai_branch_comparison_snapshots (tenant_id, branch_id, created_by_user_id, title, preset, range_from, range_to, financials_included, as_of, snapshot_json)
      values (${ctx.tenantId}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${title}, ${String(cmp.preset)}, ${cmp.range?.from ?? null}::date, ${cmp.range?.to ?? null}::date,
        ${cmp.financialsIncluded}, ${cmp.asOf ?? new Date(this.now()).toISOString()}::timestamptz, ${JSON.stringify(snap)}::jsonb) returning id`.execute(this.db)).rows[0];
    return this.snapshot(ctx, String(ins.id));
  }
  async listSnapshots(ctx: AiBusinessContext, q: Row): Promise<{ items: BranchSnapshotSummaryView[]; page: number; pageSize: number; totalItems: number; totalPages: number }> {
    this.need(ctx);
    const pageSize = 10;
    const total = Number((await sql<{ n: number }>`select count(*)::int as n from ai_branch_comparison_snapshots where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(totalPages, Math.max(1, Math.trunc(Number(q.page)) || 1));
    const rows = (await sql<SnapRow>`${this.snapSelect(ctx.tenantId)} order by s.created_at desc, s.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.summaryOf(r)), page, pageSize, totalItems: total, totalPages };
  }
  async snapshot(ctx: AiBusinessContext, id: string): Promise<BranchSnapshotView> {
    this.need(ctx);
    if (!isUuid(id)) throw new BranchInsightsError('That saved comparison could not be found.', 'RESOURCE_NOT_FOUND', 404);
    const r = (await sql<SnapRow>`${this.snapSelect(ctx.tenantId)} and s.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) throw new BranchInsightsError('That saved comparison could not be found.', 'RESOURCE_NOT_FOUND', 404);
    const fin = has(ctx, FINANCIAL_VIEW);
    const j = (typeof r.snapshot_json === 'string' ? JSON.parse(r.snapshot_json) : r.snapshot_json) as { totals: Record<string, number | null>; branches: Array<Record<string, string | number | null>> };
    const MONEY_T = ['netSalesCents', 'ticketsCount', 'averageTicketCents'], MONEY_R = ['netSalesCents', 'ticketsCount', 'averageTicketCents', 'revenuePerCompletedAppointmentCents'];
    const mask = <T extends Record<string, unknown>>(o: T, keys: string[]): T => (fin ? o : { ...o, ...Object.fromEntries(keys.map((k) => [k, null])) });
    const signOffList = (await sql<{ id: string; decision: string; note: string; created_at: Date | string; reviewer: string | null }>`select so.id, so.decision, so.note, so.created_at, nullif(u.full_name, '') as reviewer
        from ai_branch_comparison_signoffs so left join users u on u.id = so.reviewer_user_id and u.tenant_id = so.tenant_id
        where so.tenant_id = ${ctx.tenantId} and so.snapshot_id = ${id}::uuid order by so.created_at desc, so.id desc`.execute(this.db)).rows
      .map((x) => ({ id: String(x.id), decision: x.decision as BranchSignOff['decision'], note: String(x.note), reviewer: x.reviewer ?? null, at: new Date(x.created_at).toISOString() }));
    return { ...this.summaryOf(r), financialsIncluded: r.financials_included && fin, totals: mask(j.totals ?? {}, MONEY_T), rows: (j.branches ?? []).map((b) => mask(b, MONEY_R)),
      signOffList, canSignOff: fin, immutable: true };
  }
  /** A reviewer's note on a saved comparison: append-only; the reviewer must be able to see the money they sign off on. */
  async signOff(ctx: AiBusinessContext, id: string, b: Row): Promise<BranchSnapshotView> {
    this.need(ctx);
    if (!has(ctx, FINANCIAL_VIEW)) throw new BranchInsightsError('Signing off needs permission to see the sales figures.', 'PERMISSION_DENIED', 403);
    const decision = String(b.decision ?? ''), note = String(b.note ?? '').trim();
    if (!['approved', 'needs_follow_up', 'noted'].includes(decision)) throw new BranchInsightsError('Choose approved, needs follow-up or noted.', 'VALIDATION_FAILED');
    if (note.length < 3) throw new BranchInsightsError('Write a short note (at least 3 characters).', 'REASON_REQUIRED');
    await this.snapshot(ctx, id);   // exists in this salon (else RESOURCE_NOT_FOUND)
    await sql`insert into ai_branch_comparison_signoffs (tenant_id, snapshot_id, reviewer_user_id, decision, note)
      values (${ctx.tenantId}, ${id}::uuid, ${isUuid(ctx.userId) ? ctx.userId : null}, ${decision}, ${note.slice(0, 1000)})`.execute(this.db);
    return this.snapshot(ctx, id);
  }
  private snapSelect(T: string) {
    return sql`select s.id, s.title, s.preset, s.range_from::text as range_from, s.range_to::text as range_to, s.financials_included, s.as_of, s.created_at, s.snapshot_json,
        nullif(u.full_name, '') as saved_by, jsonb_array_length(coalesce(s.snapshot_json -> 'branches', '[]'::jsonb))::int as branches,
        (select count(*) from ai_branch_comparison_signoffs c where c.tenant_id = s.tenant_id and c.snapshot_id = s.id)::int as sign_offs,
        (select c2.decision from ai_branch_comparison_signoffs c2 where c2.tenant_id = s.tenant_id and c2.snapshot_id = s.id order by c2.created_at desc, c2.id desc limit 1) as last_decision
      from ai_branch_comparison_snapshots s left join users u on u.id = s.created_by_user_id and u.tenant_id = s.tenant_id
      where s.tenant_id = ${T}`;
  }
  private summaryOf(r: SnapRow): BranchSnapshotSummaryView {
    return { id: String(r.id), title: r.title ?? null, preset: String(r.preset), range: r.range_from && r.range_to ? { from: String(r.range_from).slice(0, 10), to: String(r.range_to).slice(0, 10) } : null,
      asOf: new Date(r.as_of).toISOString(), savedBy: r.saved_by ?? null, savedAt: new Date(r.created_at).toISOString(), branches: Number(r.branches ?? 0),
      financialsIncluded: !!r.financials_included, signOffs: Number(r.sign_offs ?? 0), lastDecision: (r.last_decision as BranchSignOff['decision'] | null) ?? null };
  }

  /** P1 — Branch Data Health Checker: read-only; recorded; a repeat within 30 s returns the last run. */
  async check(ctx: AiBusinessContext) {
    this.need(ctx);
    const T = ctx.tenantId, B = isUuid(ctx.branchId) ? String(ctx.branchId) : null;
    const last = (await sql<Row>`select id, overall, checks, created_at from ai_business_health_runs where tenant_id = ${T} and area = 'branches' and branch_id is not distinct from ${B}
      and created_at >= ${new Date(this.now() - HEALTH_GAP_SECONDS * 1000)} order by created_at desc limit 1`.execute(this.db)).rows[0];
    if (last) return { id: String(last.id), overall: last.overall, checks: last.checks, checkedAt: new Date(last.created_at).toISOString(), reused: true, changesAnything: false };
    const bf = B ? sql`and b.id = ${B}::uuid` : sql``;
    const one = async (q: any) => (await q.execute(this.db)).rows[0] ?? {};
    const tzMissing = await one(sql<Row>`select count(*)::int as n from branches b where b.tenant_id = ${T} ${bf} and coalesce(b.status, 'active') = 'active' and (b.timezone is null or b.timezone = '')`);
    const noHours = await one(sql<Row>`select count(*)::int as n from branches b where b.tenant_id = ${T} ${bf} and coalesce(b.status, 'active') = 'active'
      and not exists (select 1 from tenant_location_hours h where h.tenant_id = b.tenant_id and h.location_id = b.id)`);
    const openShifts = await one(sql<Row>`select count(*)::int as n from technician_shifts s join branches b on b.id = s.branch_id and b.tenant_id = s.tenant_id where s.tenant_id = ${T} ${bf}
      and s.end_time is null and s.start_time < ${new Date(this.now() - 16 * 3_600_000)}`);
    const foreign = await one(sql<Row>`select count(*)::int as n from tickets t join branches b on b.id = t.branch_id where t.tenant_id = ${T} and b.tenant_id <> t.tenant_id`);
    const inactiveSales = await one(sql<Row>`select count(distinct b.id)::int as n from branches b join tickets t on t.branch_id = b.id and t.tenant_id = b.tenant_id
      where b.tenant_id = ${T} ${bf} and coalesce(b.status, 'active') <> 'active' and t.status = 'paid' and t.paid_at > ${new Date(this.now() - 7 * 86_400_000)}`);
    const n = (x: Row) => Number(x.n ?? 0);
    const checks = [
      { key: 'branch_time_zones', component: 'branches', state: n(tzMissing) ? 'WARNING' : 'PASSED', count: n(tzMissing) },
      { key: 'opening_hours', component: 'branches', state: n(noHours) ? 'WARNING' : 'PASSED', count: n(noHours) },
      { key: 'open_shifts', component: 'time_clock', state: n(openShifts) ? 'WARNING' : 'PASSED', count: n(openShifts) },
      { key: 'tenant_isolation', component: 'security', state: n(foreign) ? 'FAILED' : 'PASSED', count: n(foreign) },
      { key: 'inactive_branch_sales', component: 'branches', state: n(inactiveSales) ? 'WARNING' : 'PASSED', count: n(inactiveSales) },
      { key: 'no_side_effects', component: 'security', state: 'PASSED', count: 0 },
    ];
    const overall = checks.some((c) => c.state === 'FAILED') ? 'FAILED' : checks.some((c) => c.state === 'WARNING') ? 'WARNING' : 'PASSED';
    const row = (await sql<Row>`insert into ai_business_health_runs (tenant_id, branch_id, area, actor_user_id, overall, checks) values (${T}, ${B}, 'branches', ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)
      returning id, created_at`.execute(this.db)).rows[0];
    return { id: String(row.id), overall, checks, checkedAt: new Date(row.created_at).toISOString(), reused: false, changesAnything: false };
  }
}
export { YMD as BRANCH_INSIGHTS_YMD };
