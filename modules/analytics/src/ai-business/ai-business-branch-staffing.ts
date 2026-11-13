// ai-business-branch-staffing.ts — Extras · AI Business Assistant 09 (round 10): Multi-Branch Fairness — staffing normalisation.
// Per branch, the period's RECORDED technician shift time (technician_shifts with a clock-in and clock-out on the branch's own
// salon days) and how many technicians worked. The compare screen divides net sales and completed services by those staffed
// hours so a larger / longer-open branch is not "better" just for being bigger. There is no per-branch opening-hours table in
// the product, so staffed (clocked) hours are the operating-time basis — stated on screen. Read-only.
import { sql, type Kysely } from 'kysely';
import { branchTimeZone } from '@aipowersalon/database';
import { presetRange } from '@aipowersalon/reports';

export interface BranchStaffing { technicianCount: number; staffMinutes: number; openShifts: number }
export interface BranchStaffingSource {
  staffing(tenantId: string, branchIds: string[], period: { preset: string; from?: string; to?: string }, now?: Date): Promise<Record<string, BranchStaffing>>;
}
type Row = { technicians: number; minutes: number | string | null; open_shifts: number };

export class KyselyBranchStaffing implements BranchStaffingSource {
  constructor(private readonly db: Kysely<any>) {}
  async staffing(tenantId: string, branchIds: string[], period: { preset: string; from?: string; to?: string }, now: Date = new Date()): Promise<Record<string, BranchStaffing>> {
    const out: Record<string, BranchStaffing> = {};
    for (const b of branchIds) {
      const tz = await branchTimeZone(this.db, tenantId, b);
      const days = period.preset === 'custom' && period.from && period.to ? { from: period.from, to: period.to } : presetRange(period.preset, now, tz);
      const r = (await sql<Row>`select count(distinct s.technician_id)::int as technicians,
          coalesce(sum(greatest(0, extract(epoch from (s.end_time - s.start_time)) / 60)) filter (where s.start_time is not null and s.end_time is not null), 0)::bigint as minutes,
          count(*) filter (where s.start_time is not null and s.end_time is null)::int as open_shifts
        from technician_shifts s where s.tenant_id = ${tenantId} and s.branch_id = ${b}::uuid and s.shift_date between ${days.from}::date and ${days.to}::date
          and s.start_time is not null`.execute(this.db)).rows[0];
      out[b] = { technicianCount: Number(r?.technicians ?? 0), staffMinutes: Number(r?.minutes ?? 0), openShifts: Number(r?.open_shifts ?? 0) };
    }
    return out;
  }
}

/** per staffed hour — null (N/A) when no staffed time was recorded or the numerator is hidden */
export function perStaffHour(value: number | null, staffMinutes: number | null): number | null {
  if (value == null || staffMinutes == null || staffMinutes <= 0) return null;
  return Math.round((value * 60) / staffMinutes);
}
