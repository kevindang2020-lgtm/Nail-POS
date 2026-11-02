/**
 * compensation-pay-plans.ts — hourly / salary / hybrid compensation (Payroll mandate §38–§45) and the configured deduction
 * types (§59–§61). Oct 12 2026, wave 2.
 *
 * PURE:
 *  • computeHourly — worked minutes from the time clock's server timestamps (§39: start/end instants, never device time),
 *    unpaid breaks subtracted unless the plan says breaks are paid (§41), POTENTIAL overtime minutes per tenant-local week
 *    over the plan's threshold (§42: flagged for review / export, never paid automatically), hourly pay = paid minutes ×
 *    rate / 60 rounded to the cent. Instants, not naive local clock arithmetic, so a DST night is exact (§127).
 *  • salaryForPeriod — a salary plan's amount for a pay period, prorated by covered civil days when the plan starts or ends
 *    inside the period (deterministic, integer cents).
 *  • componentsFor — which earning components a pay type includes (§44): commission | hourly | salary | hybrid.
 * Kysely: PayPlansRepository (plans + deduction types + the time-clock reads). The EXCLUDE constraint (613) refuses an
 * overlapping active plan; the service turns that into PAY_PLAN_CONFLICT.
 */
import { sql, type Kysely } from 'kysely';
import { canMoveToSql, type DB } from '@aipowersalon/database';
import { TECHNICIAN_PAY_PLAN } from '../workforce-lifecycles';
import { ymdOf } from '../payroll/payroll.dto';
import { addDays, epochToLocalDate, zonedParts } from '@aipowersalon/date-time';

export type PayType = 'commission' | 'hourly' | 'salary' | 'hybrid';
export const PAY_TYPES: readonly PayType[] = ['commission', 'hourly', 'salary', 'hybrid'];
export interface PayPlan {
  id: string; technicianId: string; branchId: string | null; payType: PayType;
  hourlyRateCents: number | null; salaryCentsPerPeriod: number | null; breaksPaid: boolean; overtimeWeeklyMinutes: number;
  effectiveStart: string; effectiveEnd: string | null; status: 'active' | 'archived'; note: string | null; createdAt?: string;
}

/** PURE §44: the components a pay type pays. No plan ⇒ commission only (today's behaviour, unchanged). */
export function componentsFor(plan: Pick<PayPlan, 'payType' | 'hourlyRateCents' | 'salaryCentsPerPeriod'> | null): { commission: boolean; hourly: boolean; salary: boolean } {
  if (!plan) return { commission: true, hourly: false, salary: false };
  switch (plan.payType) {
    case 'hourly': return { commission: false, hourly: true, salary: false };
    case 'salary': return { commission: false, hourly: false, salary: true };
    case 'hybrid': return { commission: true, hourly: plan.hourlyRateCents != null, salary: plan.salaryCentsPerPeriod != null };
    default: return { commission: true, hourly: false, salary: false };
  }
}

export interface ShiftInterval { startMs: number; endMs: number }
export interface HourlyResult { workedMinutes: number; breakMinutes: number; paidMinutes: number; potentialOvertimeMinutes: number; hourlyPayCents: number }

/** Monday (YYYY-MM-DD) of the tenant-local week an instant falls in. */
function weekKey(ms: number, tz: string): string {
  const day = epochToLocalDate(ms, tz);
  const wd = zonedParts(new Date(ms), tz).weekday;   // 0 = Sunday
  return addDays(day, -((wd + 6) % 7));
}

/** PURE §38–§42. Shifts must be CLOSED (an open punch is a validation issue, not a guess). */
export function computeHourly(shifts: ShiftInterval[], breaks: ShiftInterval[], plan: { hourlyRateCents: number; breaksPaid: boolean; overtimeWeeklyMinutes: number }, tz: string): HourlyResult {
  let workedMs = 0, breakMs = 0;
  const paidByWeek = new Map<string, number>();
  for (const s of shifts) {
    if (!(s.endMs > s.startMs)) continue;
    const span = s.endMs - s.startMs;
    let inside = 0;
    for (const b of breaks) {
      const lo = Math.max(s.startMs, b.startMs), hi = Math.min(s.endMs, b.endMs);
      if (hi > lo) inside += hi - lo;
    }
    inside = Math.min(inside, span);
    workedMs += span; breakMs += inside;
    const paid = plan.breaksPaid ? span : span - inside;
    const k = weekKey(s.startMs, tz);
    paidByWeek.set(k, (paidByWeek.get(k) ?? 0) + paid);
  }
  const workedMinutes = Math.floor(workedMs / 60000);
  const breakMinutes = Math.floor(breakMs / 60000);
  const paidMinutes = Math.floor((plan.breaksPaid ? workedMs : workedMs - breakMs) / 60000);
  let potentialOvertimeMinutes = 0;
  for (const ms of paidByWeek.values()) potentialOvertimeMinutes += Math.max(0, Math.floor(ms / 60000) - plan.overtimeWeeklyMinutes);
  const rate = Math.max(0, Math.round(plan.hourlyRateCents));
  return { workedMinutes, breakMinutes, paidMinutes, potentialOvertimeMinutes, hourlyPayCents: Math.round((paidMinutes * rate) / 60) };
}

const dayIndex = (ymd: string) => Math.round(Date.parse(ymd + 'T00:00:00Z') / 86_400_000);
/** PURE §43: salary for a pay period [periodStart, periodEnd] (inclusive civil dates), prorated by the days the plan covers. */
export function salaryForPeriod(salaryCents: number, period: { start: string; end: string }, plan: { effectiveStart: string; effectiveEnd: string | null }): number {
  const pS = dayIndex(period.start), pE = dayIndex(period.end) + 1;          // half-open
  const qS = dayIndex(plan.effectiveStart.slice(0, 10)), qE = plan.effectiveEnd ? dayIndex(plan.effectiveEnd.slice(0, 10)) : Number.POSITIVE_INFINITY;
  const days = pE - pS; if (days <= 0) return 0;
  const covered = Math.max(0, Math.min(pE, qE) - Math.max(pS, qS));
  if (covered >= days) return Math.max(0, Math.round(salaryCents));
  return Math.round((Math.max(0, Math.round(salaryCents)) * covered) / days);
}

const isoDate = ymdOf;
const mapPlan = (r: any): PayPlan => ({
  id: r.id, technicianId: r.technician_id, branchId: r.branch_id ?? null, payType: r.pay_type,
  hourlyRateCents: r.hourly_rate_cents == null ? null : Number(r.hourly_rate_cents), salaryCentsPerPeriod: r.salary_cents_per_period == null ? null : Number(r.salary_cents_per_period),
  breaksPaid: !!r.breaks_paid, overtimeWeeklyMinutes: Number(r.overtime_weekly_minutes ?? 2400),
  effectiveStart: isoDate(r.effective_start), effectiveEnd: r.effective_end ? isoDate(r.effective_end) : null, status: r.status, note: r.note ?? null,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
});
export interface DeductionType { id: string; key: string; label: string; enabled: boolean; maxCentsPerPeriod: number | null }
const mapDeduction = (r: any): DeductionType => ({ id: r.id, key: r.key, label: r.label, enabled: !!r.enabled, maxCentsPerPeriod: r.max_cents_per_period == null ? null : Number(r.max_cents_per_period) });

export class PayPlansRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async list(tenantId: string, technicianId?: string): Promise<PayPlan[]> {
    let q = this.db.selectFrom('technician_pay_plans').select(['id', 'technician_id', 'branch_id', 'pay_type', 'hourly_rate_cents', 'salary_cents_per_period', 'breaks_paid', 'overtime_weekly_minutes', 'effective_start', 'effective_end', 'status', 'note', 'created_at'])
      .where('tenant_id', '=', tenantId);
    if (technicianId) q = q.where('technician_id', '=', technicianId);
    return (await q.orderBy('effective_start', 'desc').limit(500).execute()).map(mapPlan);
  }

  /** The active plan covering the period END (branch-specific beats salon-wide; latest start wins). */
  async resolve(tenantId: string, technicianId: string, branchId: string | null, periodStart: string, periodEnd: string): Promise<PayPlan | null> {
    const rows = await this.db.selectFrom('technician_pay_plans').select(['id', 'technician_id', 'branch_id', 'pay_type', 'hourly_rate_cents', 'salary_cents_per_period', 'breaks_paid', 'overtime_weekly_minutes', 'effective_start', 'effective_end', 'status', 'note', 'created_at'])
      .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).where('status', '=', 'active')
      .where((eb) => (branchId ? eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]) : eb('branch_id', 'is', null)))
      .where('effective_start', '<=', periodEnd)
      .where((eb) => eb.or([eb('effective_end', 'is', null), eb('effective_end', '>', periodStart)]))
      .execute();
    if (!rows.length) return null;
    const plans = rows.map(mapPlan).sort((a, b) => (a.branchId ? 0 : 1) - (b.branchId ? 0 : 1) || b.effectiveStart.localeCompare(a.effectiveStart));
    return plans[0];
  }

  /** §65: resolve() for a whole technician set — one read per 1000 technicians (every branch), then each technician picks
   *  in memory with resolve()'s exact rule (their branch or salon-wide when they have a branch, salon-wide only when not;
   *  branch-specific beats salon-wide; latest start wins). */
  async resolveMany(tenantId: string, technicians: { technicianId: string; branchId: string | null }[], periodStart: string, periodEnd: string): Promise<Map<string, PayPlan | null>> {
    const out = new Map<string, PayPlan | null>();
    const ids = [...new Set(technicians.map((t) => t.technicianId))];
    const byTech = new Map<string, PayPlan[]>();
    for (let at = 0; at < ids.length; at += 1000) {
      const rows = await this.db.selectFrom('technician_pay_plans').select(['id', 'technician_id', 'branch_id', 'pay_type', 'hourly_rate_cents', 'salary_cents_per_period', 'breaks_paid', 'overtime_weekly_minutes', 'effective_start', 'effective_end', 'status', 'note', 'created_at'])
        .where('tenant_id', '=', tenantId).where('technician_id', 'in', ids.slice(at, at + 1000)).where('status', '=', 'active')
        .where('effective_start', '<=', periodEnd)
        .where((eb) => eb.or([eb('effective_end', 'is', null), eb('effective_end', '>', periodStart)]))
        .execute();
      for (const r of rows) { const plan = mapPlan(r); const list = byTech.get(plan.technicianId) ?? []; list.push(plan); byTech.set(plan.technicianId, list); }
    }
    for (const t of technicians) {
      const mine = (byTech.get(t.technicianId) ?? []).filter((plan) => (t.branchId ? plan.branchId === t.branchId || plan.branchId == null : plan.branchId == null));
      out.set(t.technicianId, mine.length ? mine.sort((a, b) => (a.branchId ? 0 : 1) - (b.branchId ? 0 : 1) || b.effectiveStart.localeCompare(a.effectiveStart))[0] : null);
    }
    return out;
  }

  async create(tenantId: string, userId: string | null, p: Omit<PayPlan, 'id' | 'status' | 'createdAt'>): Promise<PayPlan> {
    const r = await this.db.insertInto('technician_pay_plans').values({
      tenant_id: tenantId, branch_id: p.branchId, technician_id: p.technicianId, pay_type: p.payType,
      hourly_rate_cents: p.hourlyRateCents, salary_cents_per_period: p.salaryCentsPerPeriod, breaks_paid: p.breaksPaid,
      overtime_weekly_minutes: p.overtimeWeeklyMinutes, effective_start: p.effectiveStart, effective_end: p.effectiveEnd,
      note: p.note, created_by: userId, updated_by: userId,
    }).returning(['id', 'technician_id', 'branch_id', 'pay_type', 'hourly_rate_cents', 'salary_cents_per_period', 'breaks_paid', 'overtime_weekly_minutes', 'effective_start', 'effective_end', 'status', 'note', 'created_at'])
      .executeTakeFirstOrThrow();
    return mapPlan(r);
  }

  /** End a plan: archive it (never deleted — §125). Through the status machine (active → archived). */
  async archive(tenantId: string, userId: string | null, id: string): Promise<PayPlan | null> {
    const r = await this.db.updateTable('technician_pay_plans').set({ status: 'archived', updated_by: userId, updated_at: sql`now()` })
      .where('tenant_id', '=', tenantId).where('id', '=', id).where(canMoveToSql(TECHNICIAN_PAY_PLAN, 'archived') as any)
      .returning(['id', 'technician_id', 'branch_id', 'pay_type', 'hourly_rate_cents', 'salary_cents_per_period', 'breaks_paid', 'overtime_weekly_minutes', 'effective_start', 'effective_end', 'status', 'note', 'created_at'])
      .executeTakeFirst();
    return r ? mapPlan(r) : null;
  }

  /** CLOSED punches that START inside [fromIso, toIso) and their breaks — the time clock is authoritative (§39). */
  async timeFacts(tenantId: string, technicianId: string, fromIso: string, toIso: string): Promise<{ shifts: ShiftInterval[]; breaks: ShiftInterval[]; openShifts: number }> {
    const rows = await this.db.selectFrom('technician_shifts').select(['id', 'start_time', 'end_time'])
      .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId)
      .where('start_time', '>=', fromIso as any).where('start_time', '<', toIso as any).execute();
    const shifts: ShiftInterval[] = []; let openShifts = 0;
    for (const r of rows as any[]) {
      if (!r.end_time) { openShifts++; continue; }
      shifts.push({ startMs: new Date(r.start_time).getTime(), endMs: new Date(r.end_time).getTime() });
    }
    const br = await this.db.selectFrom('technician_breaks').select(['started_at', 'ended_at'])
      .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId)
      .where('started_at', '<', toIso as any).where('ended_at', 'is not', null).where('ended_at', '>', fromIso as any).execute();
    return { shifts, breaks: (br as any[]).map((b) => ({ startMs: new Date(b.started_at).getTime(), endMs: new Date(b.ended_at).getTime() })), openShifts };
  }

  /** §65: timeFacts() for a whole technician set — two reads per 1000 technicians (punches, breaks), same windows and
   *  tenant scope, grouped per technician in memory. A technician with nothing on the clock is absent. */
  async timeFactsMany(tenantId: string, technicianIds: string[], fromIso: string, toIso: string): Promise<Map<string, { shifts: ShiftInterval[]; breaks: ShiftInterval[]; openShifts: number }>> {
    const out = new Map<string, { shifts: ShiftInterval[]; breaks: ShiftInterval[]; openShifts: number }>();
    const of = (id: string) => { let e = out.get(id); if (!e) { e = { shifts: [], breaks: [], openShifts: 0 }; out.set(id, e); } return e; };
    const ids = [...new Set(technicianIds)];
    for (let at = 0; at < ids.length; at += 1000) {
      const part = sql.join(ids.slice(at, at + 1000));
      const sh = await sql<{ technician_id: string; start_time: Date | string; end_time: Date | string | null }>`
        select technician_id, start_time, end_time from technician_shifts
        where tenant_id = ${tenantId} and technician_id in (${part}) and start_time >= ${fromIso} and start_time < ${toIso}`.execute(this.db);
      for (const r of sh.rows) {
        const e = of(String(r.technician_id));
        if (!r.end_time) { e.openShifts++; continue; }
        e.shifts.push({ startMs: new Date(r.start_time).getTime(), endMs: new Date(r.end_time).getTime() });
      }
      const br = await sql<{ technician_id: string; started_at: Date | string; ended_at: Date | string }>`
        select technician_id, started_at, ended_at from technician_breaks
        where tenant_id = ${tenantId} and technician_id in (${part}) and started_at < ${toIso} and ended_at is not null and ended_at > ${fromIso}`.execute(this.db);
      for (const b of br.rows) of(String(b.technician_id)).breaks.push({ startMs: new Date(b.started_at).getTime(), endMs: new Date(b.ended_at).getTime() });
    }
    return out;
  }

  async deductionTypes(tenantId: string): Promise<DeductionType[]> {
    return (await this.db.selectFrom('compensation_deduction_types').select(['id', 'key', 'label', 'enabled', 'max_cents_per_period'])
      .where('tenant_id', '=', tenantId).orderBy('key').limit(100).execute()).map(mapDeduction);
  }

  async upsertDeductionType(tenantId: string, userId: string | null, d: { key: string; label: string; enabled: boolean; maxCentsPerPeriod: number | null }): Promise<DeductionType> {
    const r = await this.db.insertInto('compensation_deduction_types')
      .values({ tenant_id: tenantId, key: d.key, label: d.label, enabled: d.enabled, max_cents_per_period: d.maxCentsPerPeriod, created_by: userId, updated_by: userId })
      .onConflict((oc) => oc.columns(['tenant_id', 'key']).doUpdateSet({ label: d.label, enabled: d.enabled, max_cents_per_period: d.maxCentsPerPeriod, updated_by: userId, updated_at: sql`now()` }))
      .returning(['id', 'key', 'label', 'enabled', 'max_cents_per_period']).executeTakeFirstOrThrow();
    return mapDeduction(r);
  }
}
