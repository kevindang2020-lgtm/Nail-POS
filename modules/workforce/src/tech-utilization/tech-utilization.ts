import { branchTimeZone } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';

// Canonical technician utilization — the SINGLE source of truth shared by Overview, Serving, Reports, Team,
// Payroll, and the Live Operations Dashboard (build doc §50: these surfaces must never compute conflicting values).
//
// Definition: utilization% = min(100, round(busyMinutes / availableMinutes * 100)), where
//   busyMinutes      = sum of today's non-cancelled/no-show appointment duration_minutes for the technician
//   availableMinutes = today's technician_shifts window (end - start); if no shift rows exist for the day, fall
//                      back to the recurring weekly technician_schedules window for today's weekday (minus lunch).
// Returns null for a technician with no available time (we never invent a denominator).

export interface UtilScope { tenantId: string; branchId?: string | null; }

export async function loadTechUtilization(db: Kysely<any>, scope: UtilScope, date?: string): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  // The business day is the BRANCH's day when the caller doesn't pass one (Oct 3 2026 — was the database's UTC date).
  const day = date || businessDate(await branchTimeZone(db, scope.tenantId, scope.branchId ?? null));
  const busyRows = await db.selectFrom('pos_tech_appointments')
    .where('tenant_id', '=', scope.tenantId).where('appt_date', '=', day).where('status', 'not in', ['cancelled', 'no_show'])
    .$if(!!scope.branchId, (qb: any) => qb.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)])))
    .groupBy('technician_id').select((eb: any) => ['technician_id as technicianId', eb.fn.sum('duration_minutes').as('busyMin')]).execute().catch(() => []);
  const busyMap = new Map<string, number>((busyRows as any[]).map((r) => [String(r.technicianId), Number(r.busyMin || 0)]));

  const availMap = new Map<string, number>();
  const shiftRows = await db.selectFrom('technician_shifts')
    .where('tenant_id', '=', scope.tenantId).where('shift_date', '=', day)
    .$if(!!scope.branchId, (qb: any) => qb.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)])))
    .select(['technician_id as technicianId', sql`extract(epoch from (end_time::time - start_time::time))/60`.as('mins')]).execute().catch(() => []);
  for (const r of shiftRows as any[]) availMap.set(String(r.technicianId), Number(r.mins || 0));
  if (availMap.size === 0) {
    const dow = new Date(day + 'T00:00:00Z').getUTCDay();
    const schedAvail = await db.selectFrom('technician_schedules')
      .where('tenant_id', '=', scope.tenantId).where('day_of_week', '=', dow).where('is_working', '=', true)
      .$if(!!scope.branchId, (qb: any) => qb.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)])))
      .select(['technician_id as technicianId', sql`extract(epoch from (end_time::time - start_time::time))/60 - coalesce(extract(epoch from (lunch_end_time::time - lunch_start_time::time))/60, 0)`.as('mins')]).execute().catch(() => []);
    for (const r of schedAvail as any[]) availMap.set(String(r.technicianId), Number(r.mins || 0));
  }
  for (const [tid, avail] of availMap) out.set(tid, computeUtilization(busyMap.get(tid) || 0, avail));
  // techs with busy time but no availability window → explicit null (no fabricated denominator)
  for (const tid of busyMap.keys()) if (!out.has(tid)) out.set(tid, null);
  return out;
}

// Pure: the canonical clamp/rounding rule (unit-testable, shared with overview's utilFor).
export function computeUtilization(busyMinutes: number, availableMinutes: number): number | null {
  if (!availableMinutes || availableMinutes <= 0) return null;
  return Math.min(100, Math.round((busyMinutes / availableMinutes) * 100));
}
