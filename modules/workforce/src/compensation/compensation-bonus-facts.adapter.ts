/**
 * compensation-bonus-facts.adapter.ts — gathers a technician's measurable bonus facts for a period. Derives service
 * production from the immutable compensation snapshots (grossServiceCents), the average rating from the reviews table
 * (the same source Owner Staff Performance reads), and attendance days from the technician_shifts records the time clock
 * writes (distinct worked days = shifts with a start_time), and membership sales from customer_memberships assigned to
 * the technician. The remaining §17 metrics (retail sales, rebooking count) each live in a separate module and are
 * follow-on wiring; until wired they read as 0, so those bonuses simply don't qualify yet. Each fact is fetched in its
 * own guarded block so one source failing never blocks the others, and any miss leaves the fact absent (reads as 0
 * downstream — never blocks payroll).
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { CompensationSnapshotRepository } from './compensation-snapshot.repository';
import { CompensationAdjustmentsRepository } from './compensation-adjustments.repository';
import type { BonusFacts } from './compensation-bonus';
import type { AdjustmentEntry } from './compensation-adjustments';
import type { BonusRuleCtx } from './compensation-bonus-rules.repository';

export function makeBonusFactsLoader(db: Kysely<DB>) {
  const snap = new CompensationSnapshotRepository(db);
  return async (ctx: BonusRuleCtx, technicianId: string, fromIso: string, toIso: string): Promise<BonusFacts> => {
    const facts: BonusFacts = {};
    try {
      const sums = await snap.sumAllTechniciansPeriod(ctx.tenantId, fromIso, toIso, ctx.branchId ?? null);
      const t = sums.find((s) => s.technicianId === technicianId);
      facts.serviceProductionCents = t?.sums.grossServiceCents ?? 0;
    } catch { /* leave serviceProductionCents absent → reads 0 */ }
    try {
      const r: any = await db.selectFrom('reviews')
        .select((eb: any) => eb.fn.avg('rating').as('avg'))
        .where('tenant_id', '=', ctx.tenantId)
        .where('technician_id', '=', technicianId)
        .where('created_at', '>=', fromIso as any)
        .where('created_at', '<=', toIso as any)
        .executeTakeFirst();
      if (r?.avg != null) facts.ratingAvg = Number(r.avg);
    } catch { /* leave ratingAvg absent → reads 0 */ }
    try {
      const r: any = await db.selectFrom('technician_shifts')
        .select(sql<number>`count(distinct shift_date)`.as('days'))
        .where('tenant_id', '=', ctx.tenantId)
        .where('technician_id', '=', technicianId)
        .where('shift_date', '>=', fromIso.slice(0, 10))
        .where('shift_date', '<=', toIso.slice(0, 10))
        .where('start_time', 'is not', null)
        .executeTakeFirst();
      if (r?.days != null) facts.attendanceDays = Number(r.days);
    } catch { /* leave attendanceDays absent → reads 0 */ }
    try {
      const r: any = await db.selectFrom('customer_memberships')
        .select(sql<number>`count(*)`.as('n'))
        .where('tenant_id', '=', ctx.tenantId)
        .where('assigned_technician_id', '=', technicianId)
        .where('created_at', '>=', fromIso as any)
        .where('created_at', '<=', toIso as any)
        .executeTakeFirst();
      if (r?.n != null) facts.membershipCount = Number(r.n);
    } catch { /* leave membershipCount absent → reads 0 */ }
    return facts;
  };
}

/** Persists an approved bonus as a 'bonus' compensation adjustment (§17), so payroll picks it up as net adjustment. */
export function makeBonusAdjustmentAppender(db: Kysely<DB>) {
  const adj = new CompensationAdjustmentsRepository(db);
  return async (ctx: BonusRuleCtx, entry: AdjustmentEntry): Promise<boolean> => {
    try { const n = await adj.append(ctx.tenantId, ctx.branchId ?? null, [entry]); return n > 0; } catch { return false; }
  };
}

/**
 * Resolves a built payroll period into the date bounds + technician list a bonus period-review needs. Reads
 * payroll_periods (dates) + payroll_lines (the technicians in the period). Returns null if the period isn't found.
 * Date bounds are widened to cover the full first and last day so timestamp-based facts aren't clipped.
 */
export function makeBonusPeriodResolver(db: Kysely<DB>) {
  const toDateStr = (v: any): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  return async (ctx: BonusRuleCtx, periodId: string): Promise<{ fromIso: string; toIso: string; technicianIds: string[] } | null> => {
    try {
      const period: any = await db.selectFrom('payroll_periods').select(['period_start', 'period_end']).where('id', '=', periodId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
      if (!period) return null;
      const lines: any[] = await db.selectFrom('payroll_lines').select(['technician_id']).where('period_id', '=', periodId).where('tenant_id', '=', ctx.tenantId).execute();
      const technicianIds = [...new Set(lines.map((l) => l.technician_id))];
      return { fromIso: `${toDateStr(period.period_start)}T00:00:00.000Z`, toIso: `${toDateStr(period.period_end)}T23:59:59.999Z`, technicianIds };
    } catch { return null; }
  };
}
