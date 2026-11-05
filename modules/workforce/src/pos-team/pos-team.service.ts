// pos-team.service.ts — read-only roster of the tenant's user accounts for the Users & Roles screen.
// Scope is always the caller's tenant (from the session). Role/permission counts come from the RBAC catalog
// (rbac.ts), the single source of truth. Framework-free + fail-soft, like the other tenant read services.
import type { TeamUser, RoleSummary, TeamResult, TeamMemberRow, TeamPagination, POSTeamState, TeamMemberDetail } from '@aipowersalon/api-contracts/tenant';
export type { TeamUser, RoleSummary, TeamResult, TeamMemberRow, TeamPagination, POSTeamState, TeamMemberDetail };   // owned by packages/api-contracts (Constitution 13 §13)
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { ROLE_PERMISSIONS, type Role } from '@aipowersalon/permissions';

import { buildMediaUrl } from '@aipowersalon/media';
import { CompensationSnapshotRepository } from '../compensation/compensation-snapshot.repository';

export type TeamCtx = { tenantId?: string; userId?: string; role?: string };


export interface TeamFilters { search?: string; role?: string; status?: string; shift?: string; department?: string; tab?: string; page?: number; pageSize?: number }


// Roles a tenant actually staffs (super-admins live outside the tenant; customers aren't team).
const TENANT_ROLES: Role[] = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];

export class PosTeamService {
  constructor(private readonly db: Kysely<DB> | null) {}
  /** the ONE commission read (snapshot + posted adjustments per technician); a failing read is 0, never a re-priced guess */
  private async commissionByTechnician(tenantId: string, fromIso: string, toIso: string): Promise<Map<string, { commissionCents: number; tickets: number }>> {
    if (!this.db) return new Map();
    try { return await new CompensationSnapshotRepository(this.db).commissionByTechnician(tenantId, fromIso, toIso); } catch { return new Map(); }
  }

  async listTeam(ctx: TeamCtx): Promise<TeamResult> {
    const empty: TeamResult = { users: [], roles: [], summary: { total: 0, active: 0, admins: 0 } };
    if (!this.db || !ctx.tenantId) return empty;
    try {
      const rows = await this.db
        .selectFrom('users as u')
        // Sep 2026 merge: a person can be a technician at several salons — join only THIS salon's technician row
        .leftJoin('technicians as t', (join: any) => join.onRef('t.user_id', '=', 'u.id').onRef('t.tenant_id', '=', 'u.tenant_id'))
        .leftJoin('global_tech_profiles as gtp', (join: any) =>
          join.on((eb: any) => eb.or([
            eb('gtp.id', '=', sql<string>`t.global_tech_profile_id`),
            eb('gtp.user_id', '=', sql<string>`u.id`)
          ]))
        )
        .select(['u.id', 'u.full_name', 'u.first_name', 'u.last_name', 'u.email', 'u.role', 'u.status', 'u.branch_id', 'u.last_login_at', 'u.mfa_enabled', 'u.created_at',
          'u.avatar_url as user_avatar_url', 't.avatar_url as tech_avatar_url', 'gtp.avatar_url as gtp_avatar_url'])
        .where('u.tenant_id', '=', ctx.tenantId)
        .where('u.role', '!=', 'CUSTOMER')
        .orderBy('u.created_at', 'asc')
        .execute();
      const iso = (v: any) => (v ? new Date(v as any).toISOString() : null);
      const users: TeamUser[] = rows.map((r: any) => {
        const rawPhoto = r.user_avatar_url || r.tech_avatar_url || r.gtp_avatar_url || null;
        return {
          id: String(r.id),
          name: r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'User',
          email: r.email ?? null,
          role: r.role || 'STAFF',
          status: r.status || 'active',
          avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : null,
          branchId: r.branch_id ?? null,
          lastLoginAt: iso(r.last_login_at),
          mfaEnabled: !!r.mfa_enabled,
          createdAt: iso(r.created_at),
          isYou: String(r.id) === ctx.userId,
        };
      });
      const counts: Record<string, number> = {};
      users.forEach((u) => { counts[u.role] = (counts[u.role] || 0) + 1; });
      const roles: RoleSummary[] = TENANT_ROLES.map((r) => ({ role: r, permissionCount: ROLE_PERMISSIONS[r]?.length || 0, userCount: counts[r] || 0 }));
      const admins = (counts.OWNER || 0) + (counts.MANAGER || 0);
      return { users, roles, summary: { total: users.length, active: users.filter((u) => u.status === 'active').length, admins } };
    } catch {
      return empty;
    }
  }

  // Rich Team Management state. Roster = users (all staff) LEFT JOIN technicians (rich provider fields).
  // Per-provider services/revenue from ticket_service_lines (paid, last 30d); commission from the compensation
  // snapshot (the payroll authority, Oct 13 2026); performance from reviews; live status from technician_statuses; today's shift from
  // technician_schedules. Approvals from the real request queues. Birthdays/training have no staff store yet → empty.
  async getState(ctx: TeamCtx, f: TeamFilters = {}): Promise<POSTeamState> {
    const empty: POSTeamState = {
      kpis: { totalMembers: 0, activeToday: 0, onShiftNow: 0, avgPerformance: 0, totalServices: 0, totalCommissionCents: 0, pendingApprovals: 0, openPositions: 0 },
      rows: { items: [], pagination: { page: 1, pageSize: 8, totalItems: 0, totalPages: 1 } },
      tabs: [], facets: { roles: [], statuses: [], shifts: [], departments: [] },
      attendance: [], performance: { overall: 0, distribution: [] }, topPerformers: [], birthdays: [],
      shiftOverview: [], productivity: { servicesCompleted: 0, revenueCents: 0, commissionCents: 0 },
      approvals: [], training: { certificationsExpiring: 0, trainingInProgress: 0, newTrainings: 0 },
      trends: { members: null, performance: null, services: null, commission: null, prodServices: null, prodRevenue: null, prodCommission: null },
    };
    if (!this.db || !ctx.tenantId) return empty;
    const db = this.db; const tenantId = ctx.tenantId;
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const dow = new Date().getDay();
    try {
      // --- roster (users + technician enrichment) ---
      const staff = await db.selectFrom('users as u').leftJoin('technicians as t', 't.user_id', 'u.id')
        .leftJoin('global_tech_profiles as gtp', (join: any) =>
          join.on((eb: any) => eb.or([
            eb('gtp.id', '=', sql<string>`t.global_tech_profile_id`),
            eb('gtp.user_id', '=', sql<string>`u.id`)
          ]))
        )
        .where('u.tenant_id', '=', tenantId).where('u.role', '!=', 'CUSTOMER')
        .select(['u.id as userId', 'u.full_name as fullName', 'u.first_name as firstName', 'u.last_name as lastName', 'u.email as email', 'u.role as role', 'u.status as status', 'u.avatar_url as userAvatarUrl',
          't.id as technicianId', 't.phone_display as phone', 't.avatar_url as techAvatarUrl', 'gtp.avatar_url as gtpAvatarUrl', 't.role_label as roleLabel'])
        .orderBy('u.created_at', 'asc').execute().catch(() => [] as any[]);
      // dedupe by user (a user maps to at most one active tech for our purposes)
      const seen = new Set<string>(); const base = staff.filter((r: any) => { const k = String(r.userId); if (seen.has(k)) return false; seen.add(k); return true; });

      const techIds = base.map((r: any) => r.technicianId).filter(Boolean).map(String);
      const mapNum = (rows: any[], key: string, val: string) => { const m = new Map<string, number>(); for (const r of rows) m.set(String(r[key]), Number(r[val]) || 0); return m; };

      // --- services + revenue per provider (paid tickets, last 30d) ---
      const svcRows = techIds.length ? await db.selectFrom('ticket_service_lines as l').innerJoin('tickets as tk', 'tk.id', 'l.ticket_id')
        .where('tk.tenant_id', '=', tenantId).where('tk.paid_at', 'is not', null).where('tk.paid_at', '>=', since as any).where('l.technician_id', 'in', techIds)
        .select(['l.technician_id as tid', sql<number>`count(*)`.as('services'), sql<number>`coalesce(sum(l.line_total_cents),0)`.as('revenue')])
        .groupBy('l.technician_id').execute().catch(() => [] as any[]) : [];
      const svcMap = mapNum(svcRows, 'tid', 'services'); const revMap = mapNum(svcRows, 'tid', 'revenue');
      // Oct 13 2026 (FLOW duplicate D4 merged): commission per provider is the compensation SNAPSHOT's (the one payroll
      // authority: rules, discount allocation, posted reversals) over the same 30 days — it was sales × the technician's
      // CURRENT rate, which disagreed with payroll after any rule change, discount or refund.
      const comm = await this.commissionByTechnician(tenantId, since, new Date().toISOString());

      // --- trend windows (real period-over-period): prior 30d for KPIs, 7d/prior-7d for productivity ---
      const prior30 = new Date(Date.now() - 60 * 864e5).toISOString();
      const wk1 = new Date(Date.now() - 7 * 864e5).toISOString();
      const wk2 = new Date(Date.now() - 14 * 864e5).toISOString();
      const agg = async (lo: string, hi?: string) => {
        let q = db.selectFrom('ticket_service_lines as l').innerJoin('tickets as tk', 'tk.id', 'l.ticket_id')
          .where('tk.tenant_id', '=', tenantId).where('tk.paid_at', 'is not', null).where('tk.paid_at', '>=', lo as any);
        if (hi) q = q.where('tk.paid_at', '<', hi as any);
        const r = await q.select([sql<number>`count(*)`.as('services'), sql<number>`coalesce(sum(l.line_total_cents),0)`.as('revenue')]).executeTakeFirst().catch(() => undefined);
        return { services: Number(r?.services) || 0, revenue: Number(r?.revenue) || 0 };
      };
      const [aPrior30, aThis7, aPrior7] = await Promise.all([agg(prior30, since), agg(wk1), agg(wk2, wk1)]);
      // performance this-30d vs prior-30d (avg rating)
      const avgRating = async (lo: string, hi?: string) => {
        let q = db.selectFrom('reviews').where('tenant_id', '=', tenantId).where('is_hidden_by_manager', '=', false).where('created_at', '>=', lo as any);
        if (hi) q = q.where('created_at', '<', hi as any);
        const r = await q.select([sql<number>`avg(rating)`.as('avg')]).executeTakeFirst().catch(() => undefined);
        return r?.avg != null ? Number(r.avg) : null;
      };
      const [perfThis, perfPrior] = await Promise.all([avgRating(since), avgRating(prior30, since)]);
      // new members in the last 30d (for team-size growth)
      const newMembersRow = await db.selectFrom('users').where('tenant_id', '=', tenantId).where('role', '!=', 'CUSTOMER').where('created_at', '>=', since as any)
        .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
      const newMembers30 = Number((newMembersRow as any)?.n) || 0;

      // --- performance (avg review rating per provider) ---
      const revwRows = techIds.length ? await db.selectFrom('reviews').where('tenant_id', '=', tenantId).where('technician_id', 'in', techIds).where('is_hidden_by_manager', '=', false)
        .select(['technician_id as tid', sql<number>`avg(rating)`.as('avg')]).groupBy('technician_id').execute().catch(() => [] as any[]) : [];
      const perfMap = new Map<string, number>(); for (const r of revwRows) perfMap.set(String(r.tid), Math.round(Number(r.avg) * 10) / 10);

      // --- current live status per provider (latest) ---
      const statusRows = techIds.length ? await db.selectFrom('technician_statuses').where('tenant_id', '=', tenantId).where('technician_id', 'in', techIds)
        .select(['technician_id as tid', 'status', 'changed_at']).execute().catch(() => [] as any[]) : [];
      const statusMap = new Map<string, string>(); const statusTs = new Map<string, number>();
      for (const r of statusRows) { const k = String(r.tid); const ts = new Date(r.changed_at as any).getTime() || 0; if (!statusTs.has(k) || ts > (statusTs.get(k) || 0)) { statusTs.set(k, ts); statusMap.set(k, String(r.status)); } }

      // --- today's shift per provider ---
      const shiftRows = techIds.length ? await db.selectFrom('technician_schedules').where('tenant_id', '=', tenantId).where('day_of_week', '=', dow).where('is_working', '=', true).where('technician_id', 'in', techIds)
        .select(['technician_id as tid', 'start_time', 'end_time']).execute().catch(() => [] as any[]) : [];
      const shiftMap = new Map<string, { s: string; e: string }>(); for (const r of shiftRows) if (r.start_time && r.end_time) shiftMap.set(String(r.tid), { s: String(r.start_time), e: String(r.end_time) });

      // --- pending approvals (real request queues) ---
      const cnt = async (q: Promise<any>) => { const r = await q.catch(() => undefined); return Number(r?.n) || 0; };
      const skillReq = await cnt(db.selectFrom('technician_skill_change_requests').where('tenant_id', '=', tenantId).where('status', 'in', ['submitted', 'pending', 'under_review']).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst());   // Decision 7: new requests are 'submitted' ('pending' is the pre-475 name); 'more information required' waits on the technician, not the manager
      const ticketReq = await cnt(db.selectFrom('ticket_change_requests').where('tenant_id', '=', tenantId).where('status', '=', 'pending').select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst());

      // ---- assemble member rows ----
      const fmtTime = (t: string) => { const [h, m] = t.split(':'); let hh = parseInt(h, 10); const ap = hh >= 12 ? 'PM' : 'AM'; hh = hh % 12 || 12; return `${hh}:${m || '00'} ${ap}`; };
      const deptOf = (role: string, label?: string | null) => {
        const L = (label || '').toLowerCase(), R = (role || '').toUpperCase();
        if (/stylist|hair/.test(L)) return 'Hair Services';
        if (R === 'TECHNICIAN' || /nail|tech/.test(L)) return 'Nail Services';
        if (R === 'RECEPTION' || R === 'FRONT_DESK' || /reception|front/.test(L)) return 'Front Desk';
        if (R === 'MANAGER' || R === 'OWNER' || /manager|owner/.test(L)) return 'Management';
        return 'Support';
      };
      const mapStatus = (raw: string | undefined, hasShift: boolean) => {
        const s = (raw || '').toLowerCase();
        if (/in_service|available|service_done/.test(s)) return 'on_shift';
        if (/break|lunch/.test(s)) return 'on_break';
        if (/off_shift|offline/.test(s)) return hasShift ? 'on_shift' : 'off_today';
        return hasShift ? 'on_shift' : 'off_today';
      };
      const perfLabel = (n: number | null) => (n == null ? null : n >= 4.5 ? 'Excellent' : n >= 3.5 ? 'Very Good' : n >= 2.5 ? 'Good' : 'Needs Improvement');
      const roleDisplay = (role: string, label?: string | null) => label || ({ OWNER: 'Owner', MANAGER: 'Manager', RECEPTION: 'Receptionist', FRONT_DESK: 'Receptionist', TECHNICIAN: 'Nail Technician' } as Record<string, string>)[(role || '').toUpperCase()] || role;

      const allRows: TeamMemberRow[] = base.map((r: any) => {
        const tid = r.technicianId ? String(r.technicianId) : '';
        const isProvider = !!tid;
        const revenue = revMap.get(tid) || 0; const services = svcMap.get(tid) || 0;
        const commission = isProvider ? (comm.get(tid)?.commissionCents ?? 0) : 0;
        const sh = shiftMap.get(tid);
        const status = mapStatus(statusMap.get(tid), !!sh);
        const perf = perfMap.has(tid) ? perfMap.get(tid)! : null;
        const rawPhoto = r.userAvatarUrl || r.techAvatarUrl || r.gtpAvatarUrl || null;
        const photoUrl = rawPhoto ? buildMediaUrl(rawPhoto) : null;
        return {
          employeeId: r.technicianId ? `EMP-${String(r.technicianId).slice(0, 8)}` : `EMP-${String(r.userId).slice(0, 8)}`,
          userId: String(r.userId), technicianId: r.technicianId ? String(r.technicianId) : null,
          name: r.fullName || [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email || 'Team member',
          email: r.email ?? null, phone: r.phone ?? null, avatarUrl: photoUrl,
          role: roleDisplay(r.role, r.roleLabel), roleLevel: r.roleLabel && /level|senior|junior/i.test(r.roleLabel) ? r.roleLabel : null,
          department: deptOf(r.role, r.roleLabel), shift: sh ? `${fmtTime(sh.s)} - ${fmtTime(sh.e)}` : null,
          status, performanceScore: perf, performanceLabel: perfLabel(perf),
          servicesCount: services, revenueCents: revenue, commissionCents: commission, isProvider,
        };
      });

      // ---- tabs (classify) ----
      const isStylist = (r: TeamMemberRow) => r.department === 'Hair Services' || /stylist/i.test(r.role);
      const isNailTech = (r: TeamMemberRow) => r.department === 'Nail Services' && !isStylist(r);
      const isRecep = (r: TeamMemberRow) => /reception/i.test(r.role);
      const isMgr = (r: TeamMemberRow) => /manager|owner/i.test(r.role);
      const isAsst = (r: TeamMemberRow) => /assistant/i.test(r.role) || (!r.isProvider && !isRecep(r) && !isMgr(r));
      const tabs = [
        { id: '', label: 'All Members', count: allRows.length },
        { id: 'stylists', label: 'Stylists', count: allRows.filter(isStylist).length },
        { id: 'nail_technicians', label: 'Nail Technicians', count: allRows.filter(isNailTech).length },
        { id: 'receptionists', label: 'Receptionists', count: allRows.filter(isRecep).length },
        { id: 'assistants', label: 'Assistants', count: allRows.filter(isAsst).length },
        { id: 'managers', label: 'Managers', count: allRows.filter(isMgr).length },
      ];

      // ---- filters ----
      let filtered = allRows.slice();
      const tab = f.tab || '';
      if (tab === 'stylists') filtered = filtered.filter(isStylist);
      else if (tab === 'nail_technicians') filtered = filtered.filter(isNailTech);
      else if (tab === 'receptionists') filtered = filtered.filter(isRecep);
      else if (tab === 'assistants') filtered = filtered.filter(isAsst);
      else if (tab === 'managers') filtered = filtered.filter(isMgr);
      if (f.role) filtered = filtered.filter((r) => r.role === f.role);
      if (f.status) filtered = filtered.filter((r) => r.status === f.status);
      if (f.department) filtered = filtered.filter((r) => r.department === f.department);
      if (f.shift) filtered = filtered.filter((r) => (f.shift === 'unscheduled' ? !r.shift : !!r.shift));
      if (f.search) { const q = f.search.toLowerCase(); filtered = filtered.filter((r) => r.name.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q) || (r.phone || '').includes(q) || r.role.toLowerCase().includes(q)); }

      // ---- pagination ----
      const pageSize = Math.max(1, f.pageSize || 8); const totalItems = filtered.length; const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const page = Math.min(Math.max(1, f.page || 1), totalPages);
      const items = filtered.slice((page - 1) * pageSize, page * pageSize);

      // ---- KPIs ----
      const providers = allRows.filter((r) => r.isProvider);
      const rated = allRows.filter((r) => r.performanceScore != null);
      const avgPerformance = rated.length ? Math.round((rated.reduce((a, r) => a + (r.performanceScore || 0), 0) / rated.length) * 10) / 10 : 0;
      const totalServices = allRows.reduce((a, r) => a + r.servicesCount, 0);
      const totalCommission = allRows.reduce((a, r) => a + r.commissionCents, 0);
      const onShiftNow = allRows.filter((r) => r.status === 'on_shift').length;
      const activeToday = allRows.filter((r) => r.status === 'on_shift' || r.status === 'on_break').length;
      const pendingApprovals = skillReq + ticketReq;

      // ---- attendance breakdown ----
      const present = allRows.filter((r) => r.status === 'on_shift').length;
      const onBreak = allRows.filter((r) => r.status === 'on_break').length;
      const absent = allRows.filter((r) => r.status === 'absent').length;
      const off = allRows.length - present - onBreak - absent;
      const attendance = [
        { status: 'Present', count: present }, { status: 'On Break', count: onBreak },
        { status: 'Absent', count: absent }, { status: 'Off', count: Math.max(0, off) },
      ].filter((a) => a.count > 0 || a.status === 'Present');

      // ---- performance distribution + top performers ----
      const bucket = (lo: number, hi: number) => rated.filter((r) => (r.performanceScore || 0) >= lo && (r.performanceScore || 0) <= hi).length;
      const performance = {
        overall: avgPerformance,
        distribution: [
          { label: 'Excellent (4.5 - 5.0)', count: bucket(4.5, 5) }, { label: 'Very Good (3.5 - 4.4)', count: bucket(3.5, 4.49) },
          { label: 'Good (2.5 - 3.4)', count: bucket(2.5, 3.49) }, { label: 'Needs Improvement (<2.5)', count: bucket(0, 2.49) },
        ],
      };
      const topPerformers = rated.slice().sort((a, b) => (b.performanceScore || 0) - (a.performanceScore || 0)).slice(0, 3)
        .map((r) => ({ employeeId: r.employeeId, name: r.name, avatarUrl: r.avatarUrl, score: r.performanceScore || 0 }));

      // ---- shift overview (group today's shifts by start hour) ----
      const shiftBuckets = [
        { label: 'Morning Shift', time: '9 AM - 2 PM', lo: 5, hi: 11 },
        { label: 'Afternoon Shift', time: '2 PM - 7 PM', lo: 12, hi: 17 },
        { label: 'Evening Shift', time: '7 PM - 11 PM', lo: 18, hi: 23 },
      ];
      const shiftStartHours = [...shiftMap.values()].map((s) => parseInt(s.s.split(':')[0], 10));
      const shiftOverview = shiftBuckets.map((b) => {
        const members = shiftStartHours.filter((h) => h >= b.lo && h <= b.hi).length;
        return { label: b.label, time: b.time, members, present: members, presentLabel: `${members} Scheduled` };
      });

      // ---- approvals list ----
      const approvals = [
        { type: 'leave', label: 'Leave Requests', count: 0 },
        { type: 'skill_request', label: 'Skill Requests', count: skillReq },          // was labelled 'Shift Swap Requests'
        { type: 'ticket_change', label: 'Ticket Change Requests', count: ticketReq },   // was labelled 'Document Verification'
      ].filter((a) => a.count > 0);

      // Team Productivity is a "This Week" panel → last 7d. Commission is the snapshot's for those 7 days (D4), not revenue × a rate.
      const sumComm = (m: Map<string, { commissionCents: number }>) => [...m.values()].reduce((a, x) => a + x.commissionCents, 0);
      const [comm7, commPrior7, commPrior30] = await Promise.all([this.commissionByTechnician(tenantId, wk1, new Date().toISOString()), this.commissionByTechnician(tenantId, wk2, wk1), this.commissionByTechnician(tenantId, prior30, since)]);
      const productivity = { servicesCompleted: aThis7.services, revenueCents: aThis7.revenue, commissionCents: sumComm(comm7) };

      // ---- real period-over-period trends ----
      const pct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
      const priorMembers = allRows.length - newMembers30;
      const trends = {
        members: priorMembers > 0 ? Math.round((newMembers30 / priorMembers) * 1000) / 10 : null,
        performance: perfThis != null && perfPrior != null ? Math.round((perfThis - perfPrior) * 10) / 10 : null,
        services: pct(totalServices, aPrior30.services),
        commission: pct(totalCommission, sumComm(commPrior30)),   // real period-over-period commission (snapshot), D4
        prodServices: pct(aThis7.services, aPrior7.services),
        prodRevenue: pct(aThis7.revenue, aPrior7.revenue),
        prodCommission: pct(sumComm(comm7), sumComm(commPrior7)),
      };

      const facets = {
        roles: [...new Set(allRows.map((r) => r.role))].sort(),
        statuses: ['on_shift', 'on_break', 'off_today', 'absent'],
        shifts: ['scheduled', 'unscheduled'],
        departments: [...new Set(allRows.map((r) => r.department))].sort(),
      };

      return {
        kpis: { totalMembers: allRows.length, activeToday, onShiftNow, avgPerformance, totalServices, totalCommissionCents: totalCommission, pendingApprovals, openPositions: 0 },
        rows: { items, pagination: { page, pageSize, totalItems, totalPages } },
        tabs, facets, attendance, performance, topPerformers, birthdays: [], shiftOverview, productivity, approvals,
        training: { certificationsExpiring: 0, trainingInProgress: 0, newTrainings: 0 }, trends,
      };
    } catch {
      return empty;
    }
  }

  // Employee profile Overview for one member — real data, fail-soft. Looks up by user id (the row's userId).
  async getMemberDetail(ctx: TeamCtx, userId: string): Promise<TeamMemberDetail | null> {
    if (!this.db || !ctx.tenantId || !userId) return null;
    const db = this.db; const tenantId = ctx.tenantId;
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const dow = new Date().getDay();
    try {
      const u = await db.selectFrom('users as u')
        .leftJoin('technicians as t', 't.user_id', 'u.id')
        .leftJoin('global_tech_profiles as gtp', (join: any) =>
          join.on((eb: any) => eb.or([
            eb('gtp.id', '=', sql<string>`t.global_tech_profile_id`),
            eb('gtp.user_id', '=', sql<string>`u.id`)
          ]))
        )
        .where('u.tenant_id', '=', tenantId).where('u.id', '=', userId as any)
        .select(['u.id', 'u.full_name', 'u.first_name', 'u.last_name', 'u.email', 'u.role', 'u.status', 'u.branch_id', 'u.last_login_at', 'u.mfa_enabled', 'u.created_at',
          'u.avatar_url as userAvatarUrl', 't.avatar_url as techAvatarUrl', 'gtp.avatar_url as gtpAvatarUrl'])
        .executeTakeFirst().catch(() => undefined);
      if (!u) return null;
      const t = await db.selectFrom('technicians').where('tenant_id', '=', tenantId).where('user_id', '=', userId as any)
        .select(['id', 'phone_display', 'avatar_url', 'role_label', 'status']).executeTakeFirst().catch(() => undefined);
      const tid = t?.id ? String(t.id) : null;
      const rawPhoto = (u as any).userAvatarUrl || (u as any).techAvatarUrl || (u as any).gtpAvatarUrl || t?.avatar_url || null;
      const photoUrl = rawPhoto ? buildMediaUrl(rawPhoto) : null;

      const fmtTime = (x: string) => { const [h, m] = x.split(':'); let hh = parseInt(h, 10); const ap = hh >= 12 ? 'PM' : 'AM'; hh = hh % 12 || 12; return `${hh}:${m || '00'} ${ap}`; };
      const deptOf = (role: string, label?: string | null) => { const L = (label || '').toLowerCase(), R = (role || '').toUpperCase(); if (/stylist|hair/.test(L)) return 'Hair Services'; if (R === 'TECHNICIAN' || /nail|tech/.test(L)) return 'Nail Services'; if (R === 'RECEPTION' || R === 'FRONT_DESK' || /reception|front/.test(L)) return 'Front Desk'; if (R === 'MANAGER' || R === 'OWNER' || /manager|owner/.test(L)) return 'Management'; return 'Support'; };
      const roleDisplay = (role: string, label?: string | null) => label || ({ OWNER: 'Owner', MANAGER: 'Manager', RECEPTION: 'Receptionist', FRONT_DESK: 'Receptionist', TECHNICIAN: 'Nail Technician' } as Record<string, string>)[(role || '').toUpperCase()] || role;
      const perfLabel = (n: number | null) => (n == null ? null : n >= 4.5 ? 'Excellent' : n >= 3.5 ? 'Very Good' : n >= 2.5 ? 'Good' : 'Needs Improvement');

      let services = 0, revenue = 0, perf: number | null = null, reviewCount = 0, shiftStr: string | null = null, liveStatus: string | undefined; const skills: string[] = [];
      if (tid) {
        const sv = await db.selectFrom('ticket_service_lines as l').innerJoin('tickets as tk', 'tk.id', 'l.ticket_id')
          .where('tk.tenant_id', '=', tenantId).where('tk.paid_at', 'is not', null).where('tk.paid_at', '>=', since as any).where('l.technician_id', '=', tid as any)
          .select([sql<number>`count(*)`.as('services'), sql<number>`coalesce(sum(l.line_total_cents),0)`.as('revenue')]).executeTakeFirst().catch(() => undefined);
        services = Number(sv?.services) || 0; revenue = Number(sv?.revenue) || 0;
        const rv = await db.selectFrom('reviews').where('tenant_id', '=', tenantId).where('technician_id', '=', tid as any).where('is_hidden_by_manager', '=', false)
          .select([sql<number>`avg(rating)`.as('avg'), sql<number>`count(*)`.as('n')]).executeTakeFirst().catch(() => undefined);
        perf = rv?.avg != null ? Math.round(Number(rv.avg) * 10) / 10 : null; reviewCount = Number(rv?.n) || 0;
        const sh = await db.selectFrom('technician_schedules').where('tenant_id', '=', tenantId).where('technician_id', '=', tid as any).where('day_of_week', '=', dow).where('is_working', '=', true)
          .select(['start_time', 'end_time']).executeTakeFirst().catch(() => undefined);
        if (sh?.start_time && sh?.end_time) shiftStr = `${fmtTime(String(sh.start_time))} - ${fmtTime(String(sh.end_time))}`;
        const stt = await db.selectFrom('technician_statuses').where('tenant_id', '=', tenantId).where('technician_id', '=', tid as any).orderBy('changed_at', 'desc').select(['status']).executeTakeFirst().catch(() => undefined);
        liveStatus = stt?.status ? String(stt.status) : undefined;
        const sk = await db.selectFrom('technician_services as ts').innerJoin('services as sc', 'sc.id', 'ts.service_id')
          .where('ts.tenant_id', '=', tenantId).where('ts.technician_id', '=', tid as any).select(['sc.name']).limit(12).execute().catch(() => [] as any[]);
        for (const r of sk) if (r.name) skills.push(String(r.name));
      }
      const status = (() => { const s = (liveStatus || '').toLowerCase(); if (/in_service|available|service_done/.test(s)) return 'on_shift'; if (/break|lunch/.test(s)) return 'on_break'; return shiftStr ? 'on_shift' : 'off_today'; })();
      const commission = tid ? ((await this.commissionByTechnician(tenantId, since, new Date().toISOString())).get(tid)?.commissionCents ?? 0) : 0;   // the snapshot's (D4)
      const iso = (v: any) => (v ? new Date(v as any).toISOString() : null);
      return {
        userId: String(u.id), technicianId: tid, employeeId: tid ? `EMP-${tid.slice(0, 8)}` : `EMP-${String(u.id).slice(0, 8)}`,
        name: u.full_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'Team member',
        email: u.email ?? null, phone: t?.phone_display ?? null, avatarUrl: photoUrl,
        role: roleDisplay(u.role, t?.role_label), roleLevel: t?.role_label && /level|senior|junior/i.test(t.role_label) ? t.role_label : null,
        department: deptOf(u.role, t?.role_label), status, shift: shiftStr, isProvider: !!tid,
        hireDate: iso(u.created_at), branchId: u.branch_id ?? null,
        performanceScore: perf, performanceLabel: perfLabel(perf), reviewCount,
        servicesCount: services, revenueCents: revenue, commissionCents: commission, skills,
        access: { lastLoginAt: iso(u.last_login_at), mfaEnabled: !!u.mfa_enabled, accountStatus: u.status || 'active' },
      };
    } catch {
      return null;
    }
  }
}
