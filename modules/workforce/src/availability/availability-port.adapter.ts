// availability-port.adapter.ts — binds the pure `isTechnicianAvailableAt` (availability-core.ts) to the AvailabilityPort
// seam the eligibility engine codes against (workforce-status/workforce-ports.ts). Loads the facts for ONE technician /
// date — weekly schedule (technician_schedules), APPROVED time off (528/582), blocked times (035), an OPEN live break
// (technician_breaks, 580) — and answers in the port's vocabulary. Bound in eligibility/technician-eligibility.module.ts.
// Merge Oct 12 2026 (other chat's live-technician-schedule/availability-port.adapter.ts).
//
// Branch: NOT checked here — branch access is the eligibility engine's step 3 (user_branch_access / memberships /
// roster branch, multi-branch employment 578); a roster-branch comparison here would refuse a technician who works two
// branches. Time off scoped to another branch is still ignored for this branch.
import type { Kysely } from 'kysely';
import { branchTimeZone, type DB } from '@aipowersalon/database';
import { localDateTimeToEpochMs, utcDate } from '@aipowersalon/date-time';
import type { AvailabilityPort, AvailabilityQuery, AvailabilityVerdict } from '../workforce-status/workforce-ports';
import type { TechDaySchedule } from '../technicians/technicians.dto';
import { isTechnicianAvailableAt, DAY_NAMES_LOCAL, type ScheduleFacts, type UnavailableReason } from './availability-core';

const REASON: Record<UnavailableReason, string> = {
  BRANCH_MISMATCH: 'BRANCH_MISMATCH', TIME_OFF: 'TIME_OFF', NO_SCHEDULE: 'OFF_SCHEDULE', OFF_DAY: 'OFF_SCHEDULE', OUTSIDE_SHIFT: 'OFF_SCHEDULE',
  LUNCH: 'LUNCH', SCHEDULED_BREAK: 'LUNCH', BLOCKED: 'BLOCKED', ON_BREAK: 'ON_BREAK',
};
const hhmm = (v: unknown): string | undefined => (v == null ? undefined : String(v).slice(0, 5));
const json = (v: unknown): any => { if (!v) return undefined; try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return undefined; } };
const ymd = (v: unknown): string => (v instanceof Date ? utcDate(v) : String(v).slice(0, 10));   // a DATE column read back as a UTC-midnight Date

export async function loadScheduleFacts(db: Kysely<DB>, q: { tenantId: string; branchId: string | null; technicianId: string; dateIso: string }): Promise<ScheduleFacts | null> {
  const tech = await db.selectFrom('technicians').select(['id']).where('tenant_id', '=', q.tenantId).where('id', '=', q.technicianId).executeTakeFirst();
  if (!tech) return null;
  const tz = await branchTimeZone(db, q.tenantId, q.branchId);
  const rows: any[] = await db.selectFrom('technician_schedules')
    .select(['day_of_week', 'start_time', 'end_time', 'lunch_start_time', 'lunch_end_time', 'is_working', 'shifts', 'breaks'] as any)
    .where('tenant_id', '=', q.tenantId).where('technician_id', '=', q.technicianId).execute();
  const weekly: Record<string, TechDaySchedule> = {};
  for (const r of rows) {
    weekly[DAY_NAMES_LOCAL[Number(r.day_of_week) % 7]] = { isWorking: !!r.is_working, startTime: hhmm(r.start_time) || '09:00', endTime: hhmm(r.end_time) || '18:00', lunchStart: hhmm(r.lunch_start_time), lunchEnd: hhmm(r.lunch_end_time), shifts: json(r.shifts), breaks: json(r.breaks) };
  }
  const dayStart = localDateTimeToEpochMs(q.dateIso, '00:00', tz);
  const timeOff: any[] = await db.selectFrom('technician_time_off').select(['starts_at', 'ends_at', 'status', 'branch_id'])
    .where('tenant_id', '=', q.tenantId).where('technician_id', '=', q.technicianId).where('status', '=', 'approved')
    .where('ends_at', '>', new Date(dayStart - 86_400_000)).where('starts_at', '<', new Date(dayStart + 2 * 86_400_000)).execute();
  const blocks: any[] = await db.selectFrom('technician_blocked_times').select(['block_date', 'start_time', 'end_time'])
    .where('tenant_id', '=', q.tenantId).where('technician_id', '=', q.technicianId).where('block_date', '=', q.dateIso as any).execute();
  const breaks: any[] = await db.selectFrom('technician_breaks').select(['started_at', 'ended_at'])
    .where('tenant_id', '=', q.tenantId).where('technician_id', '=', q.technicianId).where('ended_at', 'is', null).execute();
  return {
    timezone: tz, weekly,
    timeOff: timeOff.map((t) => ({ startsAt: new Date(t.starts_at).toISOString(), endsAt: new Date(t.ends_at).toISOString(), status: String(t.status), branchId: t.branch_id ? String(t.branch_id) : null })),
    blockedTimes: blocks.map((b) => ({ date: ymd(b.block_date), startTime: String(b.start_time).slice(0, 5), endTime: String(b.end_time).slice(0, 5) })),
    liveBreaks: breaks.map((b) => ({ startedAt: new Date(b.started_at).toISOString(), endedAt: b.ended_at ? new Date(b.ended_at).toISOString() : null })),
    branchId: null,
    requestedBranchId: q.branchId,
  };
}

export class KyselyAvailabilityPort implements AvailabilityPort {
  constructor(private readonly db: Kysely<DB>) {}
  async isTechnicianAvailableAt(q: AvailabilityQuery): Promise<AvailabilityVerdict> {
    const facts = await loadScheduleFacts(this.db, q);
    if (!facts) return { available: false, reason: 'OFF_SCHEDULE' };
    const at = localDateTimeToEpochMs(q.dateIso, q.startTime, facts.timezone);
    if (!isFinite(at)) return { available: false, reason: 'OFF_SCHEDULE' };
    const r = isTechnicianAvailableAt(facts, at, q.durationMin);
    return r.available ? { available: true } : { available: false, reason: r.reason ? REASON[r.reason] : 'OFF_SCHEDULE' };
  }
}
