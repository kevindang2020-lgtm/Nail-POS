import { utcDate } from '@aipowersalon/date-time';
/** compensation-autobuild.adapter.ts — wires the three repos into AutoBuildPorts for payroll period auto-build. */
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AutoBuildPorts, AutoBuildTechnician, AutobuildTierPlan } from './compensation-payroll-autobuild';
import type { PeriodFacts } from './compensation-guarantee';
import { computeScheduledHours, type WeeklyTemplateRow, type BlockedWindow } from './compensation-scheduled-hours';
import { CompensationSnapshotRepository } from './compensation-snapshot.repository';
import { GuaranteePolicyRepository } from './compensation-guarantee.repository';
import { CompensationAdjustmentsRepository } from './compensation-adjustments.repository';
import { PayPlansRepository } from './compensation-pay-plans';

/** A technician_tier_plans row as the resolver reads it. */
interface TierPlanRow { technician_id?: string; mode: string; bands_json: unknown; branch_id: string | null; effective_start: unknown }

/** PURE: one technician's active tier rows → the plan (branch-specific first, then the most recently effective). Shared
 *  by the single and the batch path so both pick identically. Throws on unreadable bands JSON — each caller turns that
 *  into null for THAT technician (payroll then falls back to the per-line commission sum). */
function pickTierPlan(rows: TierPlanRow[]): AutobuildTierPlan | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => (a.branch_id ? 0 : 1) - (b.branch_id ? 0 : 1) || String(b.effective_start).localeCompare(String(a.effective_start)));
  const r = sorted[0];
  const raw: unknown = typeof r.bands_json === 'string' ? JSON.parse(r.bands_json) : r.bands_json;
  const bands = Array.isArray(raw) ? raw.map((x: { uptoCents?: unknown; ratePercent?: unknown }) => ({ uptoCents: x.uptoCents == null ? null : Number(x.uptoCents), ratePercent: Number(x.ratePercent) })) : [];
  if (!bands.length) return null;
  return { mode: r.mode === 'marginal' ? 'marginal' : 'entire', bands };
}

const dateOnly = (v: unknown) => (v instanceof Date ? utcDate(v) : String(v).slice(0, 10));
const CHUNK = 1000;
function chunked<T>(xs: T[]): T[][] { const out: T[][] = []; for (let at = 0; at < xs.length; at += CHUNK) out.push(xs.slice(at, at + CHUNK)); return out; }

export class PayrollAutoBuildAdapter implements AutoBuildPorts {
  private readonly snap: CompensationSnapshotRepository;
  private readonly guar: GuaranteePolicyRepository;
  private readonly adj: CompensationAdjustmentsRepository;
  private readonly plans: PayPlansRepository;
  constructor(private readonly db: Kysely<DB>) { this.snap = new CompensationSnapshotRepository(db); this.guar = new GuaranteePolicyRepository(db); this.adj = new CompensationAdjustmentsRepository(db); this.plans = new PayPlansRepository(db); }
  timezone(tenantId: string, branchId: string | null) { return this.snap.tenantTimezone(tenantId, branchId); }
  technicianSums(tenantId: string, fromIso: string, toIso: string, branchId?: string | null) { return this.snap.sumAllTechniciansPeriod(tenantId, fromIso, toIso, branchId); }
  resolveGuarantee(tenantId: string, technicianId: string, branchId: string | null, asOfIso: string) { return this.guar.resolveForTechnician(tenantId, technicianId, branchId, asOfIso); }
  netAdjustments(tenantId: string, technicianId: string, fromIso: string, toIso: string, periodId?: string | null) { return this.adj.netForTechnicianPeriod(tenantId, technicianId, fromIso, toIso, periodId); }
  // wave 2 (§38–§44, §59–§62): pay plans, the time clock, and the ledger split into bonus / deduction / other
  adjustmentBreakdown(tenantId: string, technicianId: string, fromIso: string, toIso: string, periodId?: string | null) { return this.adj.breakdownForTechnicianPeriod(tenantId, technicianId, fromIso, toIso, periodId); }
  payPlan(tenantId: string, technicianId: string, branchId: string | null, periodStart: string, periodEnd: string) { return this.plans.resolve(tenantId, technicianId, branchId, periodStart, periodEnd); }
  timeFacts(tenantId: string, technicianId: string, fromIso: string, toIso: string) { return this.plans.timeFacts(tenantId, technicianId, fromIso, toIso); }
  // §65 batch reads — one query per fact kind for the whole technician set (chunked at 1000), same filters and tenant scope
  resolveGuarantees(tenantId: string, technicians: AutoBuildTechnician[], asOfIso: string) { return this.guar.resolveForTechnicians(tenantId, technicians, asOfIso); }
  adjustmentBreakdowns(tenantId: string, technicianIds: string[], fromIso: string, toIso: string, periodId?: string | null) { return this.adj.breakdownForTechniciansPeriod(tenantId, technicianIds, fromIso, toIso, periodId); }
  payPlans(tenantId: string, technicians: AutoBuildTechnician[], periodStart: string, periodEnd: string) { return this.plans.resolveMany(tenantId, technicians, periodStart, periodEnd); }
  timeFactsForTechnicians(tenantId: string, technicianIds: string[], fromIso: string, toIso: string) { return this.plans.timeFactsMany(tenantId, technicianIds, fromIso, toIso); }
  async ledgerTechnicians(tenantId: string, fromIso: string, toIso: string, periodId: string | null, branchId: string | null): Promise<{ technicianId: string; branchId: string | null }[]> {
    const rows = await this.db.selectFrom('compensation_adjustments').select(['technician_id']).distinct()
      .where('tenant_id', '=', tenantId).where('technician_id', 'is not', null).where('status', 'in', ['posted', 'approved', 'applied'])
      .where((eb) => {
        const unrouted = eb.and([eb('period_id', 'is', null), eb('created_at', '>=', fromIso as any), eb('created_at', '<', toIso as any)]);
        return periodId ? eb.or([eb('period_id', '=', periodId), unrouted]) : unrouted;
      })
      .where((eb) => (branchId ? eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]) : eb.val(true)))
      .limit(1000).execute();
    return (rows as any[]).map((r) => ({ technicianId: r.technician_id, branchId }));
  }
  async planTechnicians(tenantId: string, branchId: string | null, periodStart: string, periodEnd: string): Promise<{ technicianId: string; branchId: string | null }[]> {
    const rows = await this.db.selectFrom('technician_pay_plans').select(['technician_id', 'branch_id'])
      .where('tenant_id', '=', tenantId).where('status', '=', 'active').where('pay_type', 'in', ['hourly', 'salary', 'hybrid'])
      .where((eb) => (branchId ? eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]) : eb.val(true)))
      .where('effective_start', '<=', periodEnd).where((eb) => eb.or([eb('effective_end', 'is', null), eb('effective_end', '>', periodStart)]))
      .execute();
    const seen = new Set<string>(); const out: { technicianId: string; branchId: string | null }[] = [];
    for (const r of rows) if (!seen.has(r.technician_id)) { seen.add(r.technician_id); out.push({ technicianId: r.technician_id, branchId: r.branch_id ?? branchId ?? null }); }
    return out;
  }

  // §7 real attendance facts for guarantee eligibility + proration, from technician_shifts (the time clock writes it).
  // Worked hours = SUM(end − start) over completed punches; eligible days = DISTINCT worked dates; scheduled days =
  // DISTINCT shift dates on record. scheduledHours is DELIBERATELY absent — the schema models a shift as a date plus
  // actual punches, with no scheduled start/end, so any scheduled-hours figure would be fabricated; the engine's
  // fail-safe then applies the full guarantee with a note. Best-effort: any failure resolves to null (a facts query
  // must never fail a payroll build), and "nothing on record" resolves to null so the same fail-safe applies.
  async periodFacts(tenantId: string, technicianId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<PeriodFacts | null> {
    try {
      const dateOnly = (v: unknown) => (v instanceof Date ? utcDate(v) : String(v).slice(0, 10));
      const from = dateOnly(fromIso); const to = dateOnly(toIso); const b = branchId ?? null;
      const res: any = await sql`
        SELECT
          COALESCE(SUM(CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL
                            THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0 END), 0) AS worked_hours,
          COUNT(DISTINCT CASE WHEN start_time IS NOT NULL THEN shift_date END) AS eligible_days,
          COUNT(DISTINCT shift_date) AS scheduled_days
        FROM technician_shifts
        WHERE tenant_id = ${tenantId} AND technician_id = ${technicianId}
          AND shift_date >= ${from} AND shift_date <= ${to}
          AND (CAST(${b} AS uuid) IS NULL OR branch_id = CAST(${b} AS uuid))
      `.execute(this.db);
      const r: any = res?.rows?.[0]; if (!r) return null;
      const hoursWorked = Number(r.worked_hours ?? 0);
      const eligibleDays = Number(r.eligible_days ?? 0);
      let scheduledDays = Number(r.scheduled_days ?? 0);
      let scheduledHours: number | undefined;
      // Scheduled hours from the weekly template (technician_schedules, migration 003) minus blocked windows
      // (technician_blocked_times, 035). Separately guarded: a template/blocks failure leaves the punch-derived
      // facts intact. Template present → it is the TRUE denominator (scheduledHours + template scheduledDays);
      // absent → scheduledHours stays undefined (engine fail-safe) and scheduledDays stays punch-row-derived.
      try {
        const tRes: any = await sql`
          SELECT day_of_week, start_time::text AS start_time, end_time::text AS end_time,
                 lunch_start_time::text AS lunch_start_time, lunch_end_time::text AS lunch_end_time, is_working
          FROM technician_schedules
          WHERE tenant_id = ${tenantId} AND technician_id = ${technicianId}
            AND (CAST(${b} AS uuid) IS NULL OR branch_id = CAST(${b} AS uuid))
        `.execute(this.db);
        const bRes: any = await sql`
          SELECT block_date::text AS block_date, start_time, end_time
          FROM technician_blocked_times
          WHERE tenant_id = ${tenantId} AND technician_id = ${technicianId}
            AND block_date >= ${from} AND block_date <= ${to}
            AND (CAST(${b} AS uuid) IS NULL OR branch_id = CAST(${b} AS uuid))
        `.execute(this.db);
        const sched = computeScheduledHours(
          (tRes?.rows ?? []).map((x: any) => ({
            dayOfWeek: Number(x.day_of_week), startTime: x.start_time, endTime: x.end_time,
            lunchStart: x.lunch_start_time, lunchEnd: x.lunch_end_time, isWorking: !!x.is_working,
          })),
          (bRes?.rows ?? []).map((x: any) => ({ date: String(x.block_date), startTime: String(x.start_time), endTime: String(x.end_time) })),
          from, to,
        );
        if (sched) { scheduledHours = sched.scheduledHours; scheduledDays = sched.scheduledDays; }
      } catch { /* template unavailable — punch-derived facts stand; engine fail-safe covers scheduledHours */ }
      if (scheduledDays <= 0 && hoursWorked <= 0) return null; // nothing on record → engine fail-safe decides
      return { clockedIn: eligibleDays > 0 || hoursWorked > 0, hoursWorked, eligibleHours: hoursWorked, eligibleDays, scheduledDays, ...(scheduledHours != null ? { scheduledHours } : {}) };
    } catch { return null; }
  }

  /** §65 periodFacts for the whole set: three reads per 1000 technicians (punch aggregates GROUPED BY technician, the
   *  weekly templates, the blocked windows) instead of three per technician, assembled per technician with periodFacts'
   *  exact rules — same SQL expressions, same tenant + branch scope, same guards: an outer failure means no facts for
   *  anyone (each single call would have returned null), a template / blocks failure leaves the punch-derived facts. */
  async periodFactsForTechnicians(tenantId: string, technicianIds: string[], fromIso: string, toIso: string, branchId?: string | null): Promise<Map<string, PeriodFacts | null>> {
    const out = new Map<string, PeriodFacts | null>();
    const ids = [...new Set(technicianIds)];
    if (!ids.length) return out;
    try {
      const from = dateOnly(fromIso); const to = dateOnly(toIso); const b = branchId ?? null;
      const punches = new Map<string, { worked_hours: unknown; eligible_days: unknown; scheduled_days: unknown }>();
      for (const part of chunked(ids)) {
        const res = await sql<{ technician_id: string; worked_hours: unknown; eligible_days: unknown; scheduled_days: unknown }>`
          SELECT technician_id,
            COALESCE(SUM(CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL
                              THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0 END), 0) AS worked_hours,
            COUNT(DISTINCT CASE WHEN start_time IS NOT NULL THEN shift_date END) AS eligible_days,
            COUNT(DISTINCT shift_date) AS scheduled_days
          FROM technician_shifts
          WHERE tenant_id = ${tenantId} AND technician_id IN (${sql.join(part)})
            AND shift_date >= ${from} AND shift_date <= ${to}
            AND (CAST(${b} AS uuid) IS NULL OR branch_id = CAST(${b} AS uuid))
          GROUP BY technician_id
        `.execute(this.db);
        for (const r of res.rows) punches.set(String(r.technician_id), r);
      }
      let templates: Map<string, WeeklyTemplateRow[]> | null = null;
      let blocks: Map<string, BlockedWindow[]> | null = null;
      try {
        const tBy = new Map<string, WeeklyTemplateRow[]>(); const bBy = new Map<string, BlockedWindow[]>();
        for (const part of chunked(ids)) {
          const tRes = await sql<{ technician_id: string; day_of_week: unknown; start_time: string; end_time: string; lunch_start_time: string | null; lunch_end_time: string | null; is_working: unknown }>`
            SELECT technician_id, day_of_week, start_time::text AS start_time, end_time::text AS end_time,
                   lunch_start_time::text AS lunch_start_time, lunch_end_time::text AS lunch_end_time, is_working
            FROM technician_schedules
            WHERE tenant_id = ${tenantId} AND technician_id IN (${sql.join(part)})
              AND (CAST(${b} AS uuid) IS NULL OR branch_id = CAST(${b} AS uuid))
          `.execute(this.db);
          for (const x of tRes.rows) {
            const id = String(x.technician_id); const list = tBy.get(id) ?? [];
            list.push({ dayOfWeek: Number(x.day_of_week), startTime: x.start_time, endTime: x.end_time, lunchStart: x.lunch_start_time, lunchEnd: x.lunch_end_time, isWorking: !!x.is_working });
            tBy.set(id, list);
          }
          const bRes = await sql<{ technician_id: string; block_date: string; start_time: unknown; end_time: unknown }>`
            SELECT technician_id, block_date::text AS block_date, start_time, end_time
            FROM technician_blocked_times
            WHERE tenant_id = ${tenantId} AND technician_id IN (${sql.join(part)})
              AND block_date >= ${from} AND block_date <= ${to}
              AND (CAST(${b} AS uuid) IS NULL OR branch_id = CAST(${b} AS uuid))
          `.execute(this.db);
          for (const x of bRes.rows) {
            const id = String(x.technician_id); const list = bBy.get(id) ?? [];
            list.push({ date: String(x.block_date), startTime: String(x.start_time), endTime: String(x.end_time) });
            bBy.set(id, list);
          }
        }
        templates = tBy; blocks = bBy;
      } catch { templates = null; blocks = null; /* template unavailable — punch-derived facts stand; engine fail-safe covers scheduledHours */ }
      for (const id of ids) {
        const r = punches.get(id);   // no punch rows ⇒ the single query's aggregate row of zeros
        const hoursWorked = Number(r?.worked_hours ?? 0);
        const eligibleDays = Number(r?.eligible_days ?? 0);
        let scheduledDays = Number(r?.scheduled_days ?? 0);
        let scheduledHours: number | undefined;
        if (templates && blocks) {
          let sched: ReturnType<typeof computeScheduledHours> = null;
          try { sched = computeScheduledHours(templates.get(id) ?? [], blocks.get(id) ?? [], from, to); } catch { sched = null; /* as the single path: punch-derived facts stand */ }
          if (sched) { scheduledHours = sched.scheduledHours; scheduledDays = sched.scheduledDays; }
        }
        if (scheduledDays <= 0 && hoursWorked <= 0) { out.set(id, null); continue; }   // nothing on record → engine fail-safe decides
        out.set(id, { clockedIn: eligibleDays > 0 || hoursWorked > 0, hoursWorked, eligibleHours: hoursWorked, eligibleDays, scheduledDays, ...(scheduledHours != null ? { scheduledHours } : {}) });
      }
    } catch { return new Map(); }
    return out;
  }

  // §2 the active tiered plan for a technician as of the period end (branch-specific wins over an all-branches plan).
  // Best-effort: any failure resolves to null, so payroll falls back to the per-line commission sum.
  async resolveTierPlan(tenantId: string, technicianId: string, branchId: string | null, asOfIso: string): Promise<AutobuildTierPlan | null> {
    try {
      const res = await sql<TierPlanRow>`
        select mode, bands_json, branch_id, effective_start from technician_tier_plans
        where tenant_id = ${tenantId} and technician_id = ${technicianId} and status = 'active'
          and (branch_id = ${branchId} or branch_id is null)
          and effective_start <= ${asOfIso} and (effective_end is null or effective_end >= ${asOfIso})`.execute(this.db);
      return pickTierPlan(res.rows);
    } catch { return null; }
  }

  /** §65 resolveTierPlan for the whole set: one read per 1000 technicians (every branch), then each technician keeps the
   *  rows the single query would have returned (their branch, or all-branches) and picks with the same rule. */
  async resolveTierPlans(tenantId: string, technicians: AutoBuildTechnician[], asOfIso: string): Promise<Map<string, AutobuildTierPlan | null>> {
    const out = new Map<string, AutobuildTierPlan | null>();
    try {
      const byTech = new Map<string, TierPlanRow[]>();
      for (const part of chunked([...new Set(technicians.map((t) => t.technicianId))])) {
        const res = await sql<TierPlanRow>`
          select technician_id, mode, bands_json, branch_id, effective_start from technician_tier_plans
          where tenant_id = ${tenantId} and technician_id in (${sql.join(part)}) and status = 'active'
            and effective_start <= ${asOfIso} and (effective_end is null or effective_end >= ${asOfIso})`.execute(this.db);
        for (const r of res.rows) { const id = String(r.technician_id); const list = byTech.get(id) ?? []; list.push(r); byTech.set(id, list); }
      }
      // `branch_id = $branch` is never true for a null branch, so a technician without a branch sees all-branches rows only
      for (const t of technicians) {
        let plan: AutobuildTierPlan | null;
        // per technician, as the single call: unreadable bands make THIS technician's plan null, not the whole set's
        try { plan = pickTierPlan((byTech.get(t.technicianId) ?? []).filter((r) => r.branch_id == null || (t.branchId != null && r.branch_id === t.branchId))); } catch { plan = null; }
        out.set(t.technicianId, plan);
      }
    } catch { return new Map(); }
    return out;
  }
}
