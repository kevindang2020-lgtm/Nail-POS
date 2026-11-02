// team-birthdays.repository.ts — TM-08 (Four-Module Completion Guide §10.3, 30 Oct 2026): an OPTIONAL birthday, month + day
// only (a year is never asked for, stored or inferred), on team_staff_profiles (migration 727).
//
//   who sees      a staff-profile manager (technicians.edit or roles.manage) sees every recorded birthday; the member sees
//                 their own; colleagues see a birthday ONLY when the member chose "show to colleagues"
//                 (birthday_visible_to_team, default off — private unless shared)
//   who edits     a staff-profile manager, or the member themself (self-service: the same route, when the viewer IS the
//                 member — the self.profile.edit permission every staff member holds)
//   display       minimal: name + month/day + "in N days"; never a year, never an age
//   Feb 29        a valid birthday; in a non-leap year it is SHOWN on Feb 28 (documented, tested)
//   empty         "Not recorded" only when nobody visible to this viewer has one — never a placeholder
import { sql, type Kysely } from 'kysely';
import { err, canAny, teamPeriod, logGap, type TeamCtx } from '../team-screens/screen-kit';
import { writeAuditRow } from '../team-screens/audit-rows';
import { resolveMember, profileMatch } from './member-ref';

const MANAGE = ['technicians.edit', 'roles.manage'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** a month/day is valid in SOME year (Feb 29 included) */
export function validMonthDay(month: unknown, day: unknown): boolean {
  const m = Number(month), d = Number(day);
  return Number.isInteger(m) && Number.isInteger(d) && m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN[m - 1];
}
/** the next date (YYYY-MM-DD, on or after today) this month/day is celebrated; Feb 29 → Feb 28 in a non-leap year */
export function nextOccurrence(month: number, day: number, todayYmd: string): string {
  const [ty, tm, td] = todayYmd.split('-').map(Number);
  const on = (y: number) => { const d = month === 2 && day === 29 && !isLeap(y) ? 28 : day; return { y, m: month, d }; };
  let o = on(ty);
  if (o.m < tm || (o.m === tm && o.d < td)) o = on(ty + 1);
  return `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`;
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

export class TeamBirthdaysRepository {
  constructor(private readonly db: Kysely<any>) {}
  private manager(ctx: TeamCtx) { return canAny(ctx, ...MANAGE); }

  /** Upcoming Birthdays panel: the next `days` days (salon-local today), what this viewer may see */
  async upcoming(ctx: TeamCtx, q: { days?: unknown } = {}) {
    const T = ctx.tenantId; const days = Math.max(1, Math.min(90, Math.trunc(Number(q.days)) || 30));
    const today = (await teamPeriod(this.db, ctx, { preset: 'today' })).today; const mgr = this.manager(ctx);
    const rows = (await sql<any>`select p.user_id, p.technician_id, p.birthday_month, p.birthday_day, p.birthday_visible_to_team,
        coalesce(nullif(u.full_name, ''), nullif(t.full_name, ''), u.email, 'Team member') as name
      from team_staff_profiles p left join users u on u.id = p.user_id and u.tenant_id = p.tenant_id left join technicians t on t.id = p.technician_id and t.tenant_id = p.tenant_id
      where p.tenant_id = ${T} and p.birthday_month is not null
        and (u.id is null or coalesce(u.status, 'active') not in ('archived', 'deleted', 'inactive', 'suspended')) and (t.id is null or t.archived_at is null)
        and (u.id is not null or t.id is not null)
        and (${mgr} or p.birthday_visible_to_team or p.user_id = ${ctx.userId || null}::uuid)
      order by p.birthday_month, p.birthday_day, p.id limit 1000`.execute(this.db)).rows;
    const items = rows.map((r: any) => { const next = nextOccurrence(Number(r.birthday_month), Number(r.birthday_day), today);
      return { memberId: String(r.user_id ?? r.technician_id), name: String(r.name), month: Number(r.birthday_month), day: Number(r.birthday_day), date: next, inDays: daysBetween(today, next),
        shownOnFeb28: Number(r.birthday_month) === 2 && Number(r.birthday_day) === 29 && next.slice(5) === '02-28', private: !r.birthday_visible_to_team }; })
      .filter((x) => x.inDays <= days).sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name)).slice(0, 20);
    return { recorded: rows.length > 0, today, days, items, canManage: mgr };
  }

  private async row(ctx: TeamCtx, memberId: string) {
    const m = await resolveMember(this.db, ctx, memberId);
    const p = (await sql<any>`select p.id, p.birthday_month, p.birthday_day, p.birthday_visible_to_team, p.birthday_updated_at from team_staff_profiles p where p.tenant_id = ${ctx.tenantId} and ${profileMatch(ctx, m)}
      order by (p.user_id is not null) desc limit 1`.execute(this.db)).rows[0];
    return { m, p };
  }
  async get(ctx: TeamCtx, memberId: string) {
    const { m, p } = await this.row(ctx, memberId); const self = !!m.userId && m.userId === ctx.userId; const mgr = this.manager(ctx);
    const has = p?.birthday_month != null; const visible = has && (mgr || self || !!p.birthday_visible_to_team);
    return { memberId: m.memberId, recorded: has && visible, hidden: has && !visible, month: visible ? Number(p.birthday_month) : null, day: visible ? Number(p.birthday_day) : null,
      visibleToTeam: visible ? !!p.birthday_visible_to_team : null, updatedAt: visible && p.birthday_updated_at ? new Date(p.birthday_updated_at).toISOString() : null, canEdit: mgr || self };
  }
  async set(ctx: TeamCtx, memberId: string, b: { month?: unknown; day?: unknown; visibleToTeam?: unknown }, requestId: string) {
    const { m, p } = await this.row(ctx, memberId); const T = ctx.tenantId; const self = !!m.userId && m.userId === ctx.userId;
    if (!this.manager(ctx) && !(self && canAny(ctx, 'self.profile.edit'))) {
      await writeAuditRow(this.db, ctx, { module: 'workforce', action: 'team.staff.birthday.denied', resourceType: 'team_staff_profile', resourceId: m.memberId, status: 'denied', severity: 'warning',
        summary: 'Denied: edit a colleague\'s birthday', metadata: {}, requestId }).catch(logGap('team_birthday_denial_not_recorded'));
      throw err(403, 'FORBIDDEN', 'You can only change your own birthday.');
    }
    const clear = b.month == null && b.day == null;
    if (!clear && !validMonthDay(b.month, b.day)) throw err(422, 'BIRTHDAY_INVALID', 'Choose a real month and day (no year).');
    const month = clear ? null : Number(b.month), day = clear ? null : Number(b.day); const vis = b.visibleToTeam === true;
    const actor = ctx.userId || null;
    await this.db.transaction().execute(async (trx) => {
      if (p) await sql`update team_staff_profiles p set birthday_month = ${month}, birthday_day = ${day}, birthday_visible_to_team = ${clear ? false : vis}, birthday_updated_at = now(), birthday_updated_by = ${actor}::uuid, updated_by = ${actor}::uuid, updated_at = now()
          where p.tenant_id = ${T} and p.id = ${p.id}`.execute(trx);
      else await sql`insert into team_staff_profiles (tenant_id, user_id, technician_id, birthday_month, birthday_day, birthday_visible_to_team, birthday_updated_at, birthday_updated_by)
          values (${T}, ${m.userId}, ${m.userId ? null : m.technicianId}, ${month}, ${day}, ${clear ? false : vis}, now(), ${actor}::uuid)`.execute(trx);
      // the audit row says THAT it changed and who changed it — never the date itself
      await writeAuditRow(trx, ctx, { module: 'workforce', action: clear ? 'team.staff.birthday.cleared' : 'team.staff.birthday.set', resourceType: 'team_staff_profile', resourceId: m.memberId,
        summary: clear ? 'Birthday removed' : 'Birthday recorded (month/day)', metadata: { self, visibleToTeam: clear ? false : vis }, requestId });
    });
    return this.get(ctx, memberId);
  }
}
