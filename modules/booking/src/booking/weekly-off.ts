// weekly-off.ts — Technician Profile guide (Nov 5 2026, G3, migration 816): a manager's REPEATING weekly day off
// ("every Monday + Tuesday from Dec 1") applied by every schedule reader the same way.
//
// Precedence (one rule for Booking, Find Opening, the Live Technician Schedule, Tech Queue and the Technician App):
//   date override (technician_shift_overrides)  >  weekly day-off rule  >  weekly template (technician_schedules)  >  store hours
// A rule is a branch-local CALENDAR rule: it matches the weekday of the salon-local date (0 = Sunday … 6 = Saturday),
// inside [effective_from, effective_to]. A one-date working override still wins for that date only.
import { sql, type Kysely } from 'kysely';

export interface WeeklyOffRule { id: string; technicianId: string; branchId: string | null; weekdays: number[]; effectiveFrom: string; effectiveTo: string | null }

/** weekday of a YYYY-MM-DD calendar date (no time zone involved — it is already the salon-local date) */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** PURE: does one of these rules put the technician off on this salon-local date? */
export function weeklyOffOn(rules: WeeklyOffRule[], technicianId: string, date: string, branchId: string | null = null): WeeklyOffRule | null {
  const wd = weekdayOf(date);
  return rules.find((r) => r.technicianId === technicianId && (r.branchId == null || branchId == null || r.branchId === branchId)
    && r.effectiveFrom <= date && (r.effectiveTo == null || r.effectiveTo >= date) && r.weekdays.includes(wd)) ?? null;
}

/** The ACTIVE rules overlapping [from, to] for a salon (and branch, when given). A failed read is an error, never "no rule". */
export async function loadWeeklyOffRules(db: Kysely<any>, tenantId: string, branchId: string | null, from: string, to: string, technicianIds?: string[]): Promise<WeeklyOffRule[]> {
  const rows = (await sql<any>`select r.id, r.technician_id, r.branch_id, r.weekdays, to_char(r.effective_from, 'YYYY-MM-DD') as f, to_char(r.effective_to, 'YYYY-MM-DD') as t
    from technician_weekly_off_rules r where r.tenant_id = ${tenantId} and r.status = 'ACTIVE' and r.effective_from <= ${to}::date and (r.effective_to is null or r.effective_to >= ${from}::date)
      and (${branchId}::uuid is null or r.branch_id is null or r.branch_id = ${branchId}::uuid)
      ${technicianIds ? sql`and r.technician_id = any(${technicianIds}::uuid[])` : sql``}`.execute(db)).rows;
  return rows.map((r: any) => ({ id: String(r.id), technicianId: String(r.technician_id), branchId: r.branch_id ? String(r.branch_id) : null,
    weekdays: (Array.isArray(r.weekdays) ? r.weekdays : String(r.weekdays ?? '').replace(/[{}]/g, '').split(',').filter(Boolean)).map(Number), effectiveFrom: String(r.f), effectiveTo: r.t ? String(r.t) : null }));
}
/** technicians off by a weekly rule on `date` */
export async function weeklyOffTechs(db: Kysely<any>, tenantId: string, branchId: string | null, date: string, technicianIds?: string[]): Promise<Set<string>> {
  const rules = await loadWeeklyOffRules(db, tenantId, branchId, date, date, technicianIds);
  const out = new Set<string>();
  for (const r of rules) if (weeklyOffOn([r], r.technicianId, date, branchId)) out.add(r.technicianId);
  return out;
}
