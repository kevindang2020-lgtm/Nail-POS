// technicians.kysely.repository.ts — production TechniciansRepositoryPort over Postgres (Kysely).
// Real, tenant/branch-scoped over technicians, technician_schedules, technician_services (service mapping),
// technician_statuses/shifts (working/shift status), and ticket_service_lines (today's sales). Scope is session-derived.
//
// Schema notes (honest):
//  - skillGroups, app access and the permission matrix are REAL as of migration 377 (technician_skills,
//    technician_app_settings, technician_permissions). They used to return hardcoded defaults and silently drop
//    every write — a manager toggled "can process payment", got a 200, reloaded, and it was gone.
//  - rating is REAL as of migration 376: global_tech_profiles.overall_rating, reached via
//    technicians.global_tech_profile_id. A technician with no global profile yet has no rating — null, not 0.
//    (0 and "no rating" are different facts and a 0 star-rating is a slander.)
//  - APP ACCESS AND PERMISSIONS ARE ONE THING. Every can* toggle on the App Access screen IS a
//    TECH_PERMISSION_KEY, so the can* flags are DERIVED from the permission matrix, never stored twice. They
//    used to disagree already: defAppAccess said canEditNotes:true while defPermissions said edit_service_notes
//    was off.
//  - reviewCount and tips still default to 0; setShift is still derived from technician_statuses/shifts.
import { sql, type Kysely } from 'kysely';
import type { WorkforceStatusService } from '../workforce-status/workforce-status.service';
import type { ClockStatus, ServiceState } from '../workforce-status/workforce-status-core';
import { identityKeys } from '../tech-profile/global-tech-identity-core';   // pure — the ONE phone/email normalizer for technicians
import { defaultCommissionForTenant } from '../compensation/compensation-rule-loader';
import { ValidationError } from './technicians.service';
import type { DB } from '@aipowersalon/database';
import { branchTimeZone } from '@aipowersalon/database';
import { businessDate, dayStartMs } from '@aipowersalon/date-time';
import type { TechniciansContext, TechniciansRepositoryPort, QualifiedTechnician } from './technicians.repository';
import { POSTechniciansFullState, POSTechnicianRow, POSTechnicianDetail, TechnicianFilters, TechnicianListItem, TechnicianListResponse, TechLifecycleStatus, TechWorkingStatus, TechShiftStatus, TechnicianStatus, TechnicianSchedule, ScheduleVersionConflict, TechnicianShift, TechnicianSkills, TechnicianServicesMap, TechnicianCommissionConfig, TechnicianPayrollSummary, TechnicianAppAccess, TechnicianPermissions, CreateTechnicianRequest, UpdateTechnicianRequest, POSTechniciansKpisFull, TechnicianKpis, TechnicianInsights, Pagination } from './technicians.dto';
import { TECH_PERMISSION_KEYS, effectiveTechPermissions } from '@aipowersalon/permissions';
import { clampPageSize, clampPage, foldVi, withCode } from '@aipowersalon/api-contracts';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
const defPermissions = (): TechnicianPermissions => ({ matrix: TECH_PERMISSION_KEYS.map((k) => ({ permission: k, allowed: ROLE_DEFAULT_TECH_PERMS.has(k) })) });
const DEFAULT_SECTIONS = ['Home', 'Schedule', 'Tickets', 'Earnings', 'More'];

// The App Access screen's can* toggles ARE permissions. This is the single map between the two vocabularies, so
// the two screens cannot drift apart again.
const ACCESS_TO_PERMISSION: Record<string, string> = {
  canAcceptTicket: 'pos.tech.accept_ticket',
  canStartService: 'pos.tech.start_service',
  canMarkDone: 'pos.tech.mark_done',
  canRequestBreak: 'pos.tech.request_break',
  canViewEarnings: 'pos.tech.view_earnings',
  canEditNotes: 'pos.tech.edit_service_notes',
  canProcessPayment: 'pos.tech.process_payment',
};

/** The TECHNICIAN role's own defaults — what a technician can do before a salon says otherwise. */
const ROLE_DEFAULT_TECH_PERMS = new Set(['pos.tech.view_schedule', 'pos.tech.accept_ticket', 'pos.tech.start_service', 'pos.tech.mark_done', 'pos.tech.request_break', 'pos.tech.view_earnings']);

/** Role defaults + this salon's overrides = what this technician may actually do HERE. */
function effectiveSet(overrides: { permission: string; allowed: boolean }[]): Set<string> {
  return new Set(effectiveTechPermissions([...ROLE_DEFAULT_TECH_PERMS], overrides));
}

interface Tech {
  technicianId: string; firstName: string; lastName: string; displayName: string; phone: string; email: string; avatarUrl?: string;
  status: TechLifecycleStatus; workingStatus: TechWorkingStatus; shiftStatus: TechShiftStatus; commissionPercent: number;
  serviceIds: string[]; serviceCategoryIds: string[]; hasSchedule: boolean; todaySalesCents: number; role?: string; branchId?: string | null; createdAt: string; updatedAt: string;
  // real as of 376/377 — these were `[]`, `true`, `false` and `0` literals in the mapper
  skillGroups: string[]; appEnabled: boolean; perms: Set<string>; rating: number | null;
  /** ONE-PAY: today's money from the compensation snapshot + posted ledger (branch day) — never sales × a rate */
  todayCommissionCents: number; todayTipsCents: number;
}

import { buildMediaUrl } from '@aipowersalon/media';
import { CompensationSnapshotRepository } from '../compensation/compensation-snapshot.repository';

export class KyselyTechniciansRepository implements TechniciansRepositoryPort {
  constructor(public readonly db: Kysely<DB>, private readonly workforce?: WorkforceStatusService | null) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;
  /** The instant the BRANCH's day began, at its own midnight — "today" for the KPIs. The database's own day is UTC:
   *  after 8 pm in New York the evening dropped out of today (Oct 6 2026). */
  private async dayStart(ctx: { tenantId: string; branchId?: string | null }): Promise<Date> {
    return new Date(dayStartMs(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null), new Date(this.now())));
  }
  /** Today's (branch day) commission + tips per technician from the compensation authority. */
  private async todayMoney(ctx: TechniciansContext): Promise<Map<string, { commissionCents: number; tipsCents: number }>> {
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null);
    const from = dayStartMs(tz, new Date(this.now())); const to = dayStartMs(tz, new Date(from + 26 * 3600_000));   // the branch's civil day [00:00, next 00:00) — DST-safe
    return new CompensationSnapshotRepository(this.db).commissionByTechnician(ctx.tenantId, new Date(from).toISOString(), new Date(to).toISOString(), ctx.branchId || null);
  }
  private scoped(qb: any, ctx: TechniciansContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }
  private bool(v?: string) { return v === 'true' || v === 'yes' || v === '1'; }

  /** The roster with every column the Team screen reads. 200-technician mandate §26 (Oct 23 2026): `onlyId` reads ONE
   *  technician — detail / row / shift / profile reads used to load and map the whole roster (≈12 set queries over 200
   *  people) to find one; the list screen still reads the whole scope (its KPIs and filters need it), in set queries. */
  private async load(ctx: TechniciansContext, onlyId?: string): Promise<Tech[]> {
    let base = this.scoped(this.db.selectFrom('technicians as tech'), ctx, 'tech');
    if (onlyId) base = base.where('tech.id', '=', onlyId);
    const rows = await base
      .leftJoin('users as u', 'u.id', 'tech.user_id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`tech.user_id`)
        ]))
      )
      .select([
        'tech.id', 'tech.user_id', 'tech.first_name', 'tech.last_name', 'tech.full_name', 'tech.phone_display', 'tech.email', 'tech.status', 'tech.role_label', 'tech.branch_id', 'tech.default_commission_split_percent', 'tech.created_at', 'tech.updated_at', 'tech.global_tech_profile_id',
        'tech.avatar_url as tech_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'u.avatar_url as user_avatar_url'
      ]).orderBy('tech.full_name').orderBy('tech.id').execute().catch(() => []);
    const seen = new Set<string>(); rows.splice(0, rows.length, ...rows.filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true))));   // one row per technician (the OR profile join can match twice)
    const ids = rows.map((r: any) => r.id);
    // Live status comes from the ONE authoritative workforce state (579). A technician with no row yet (never touched
    // since the migration) falls back to the legacy compat row (through WorkforceStatusService, which backfills the row
    // on first touch) + the OPEN punch, exactly as before.
    const wfRows = ids.length ? await this.db.selectFrom('technician_workforce_state').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', ids)
      .select(['technician_id', 'employment_status', 'clock_status', 'queue_status', 'service_state']).execute().catch(() => [] as any[]) : [];
    const wfBy: Record<string, { clock: ClockStatus; queue: string; service: ServiceState }> = {};
    for (const w of wfRows) wfBy[w.technician_id] = { clock: w.clock_status, queue: w.queue_status, service: w.service_state };
    const missing = ids.filter((id: string) => !wfBy[id]);
    let statBy: Record<string, string> = {};
    if (missing.length && this.workforce) statBy = await this.workforce.legacyStatusMap(ctx.tenantId, ctx.branchId || null, missing).catch(() => ({}));
    else if (missing.length) {
      const stat = await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', missing).select(['technician_id', 'status', 'changed_at']).orderBy('changed_at', 'asc').execute().catch(() => []);
      for (const st of stat) statBy[st.technician_id] = st.status; // latest changed_at wins
    }
    const shifts = missing.length ? await this.scoped(this.db.selectFrom('technician_shifts'), ctx).where('technician_id', 'in', missing).where('end_time', 'is', null).where('status', '=', 'active').select(['technician_id', 'status']).execute().catch(() => []) : [];
    const shiftBy: Record<string, string> = {}; for (const s of shifts) shiftBy[s.technician_id] = s.status;
    const svc = ids.length ? await this.scoped(this.db.selectFrom('technician_services'), ctx).where('technician_id', 'in', ids).select(['technician_id', 'service_id']).execute().catch(() => []) : [];
    const svcBy: Record<string, string[]> = {}; for (const s of svc) (svcBy[s.technician_id] ||= []).push(s.service_id);
    // service_id → category_id map (for the serviceCategory filter — real data via the services table)
    const svcIds = [...new Set(svc.map((s: any) => s.service_id))];
    const svcCats = svcIds.length ? await this.scoped(this.db.selectFrom('services'), ctx).where('id', 'in', svcIds).select(['id', 'category_id']).execute().catch(() => []) : [];
    const catBySvc: Record<string, string> = {}; for (const s of svcCats) catBySvc[s.id] = s.category_id;
    const catsBy: Record<string, string[]> = {};
    for (const [techId, sids] of Object.entries(svcBy)) catsBy[techId] = [...new Set(sids.map((id) => catBySvc[id]).filter(Boolean))];
    // schedule presence (for the missingSchedule filter — a tech with zero configured schedule rows)
    const sched = ids.length ? await this.scoped(this.db.selectFrom('technician_schedules'), ctx).where('technician_id', 'in', ids).select(['technician_id']).execute().catch(() => []) : [];
    const hasSchedule = new Set<string>(sched.map((s: any) => s.technician_id));
    const sales = ids.length ? await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('technician_id', 'in', ids).where('created_at', '>=', (await this.dayStart(ctx)))   // since the branch's midnight (was the session's UTC date)
      .groupBy('technician_id').select((eb: any) => ['technician_id', eb.fn.sum('line_total_cents').as('sales')]).execute().catch(() => []) : [];
    const salesBy: Record<string, number> = {}; for (const s of sales) salesBy[s.technician_id] = Number(s.sales);
    // ONE-PAY (Oct 13 2026): commission + tips are the compensation AUTHORITY's — the snapshot and posted ledger over the
    // branch day (CompensationSnapshotRepository.commissionByTechnician) — never today's sales × the CURRENT rate.
    const money = ids.length ? await this.todayMoney(ctx) : new Map<string, { commissionCents: number; tipsCents: number }>();

    // ── the four things that used to be literals in the mapper (migrations 376/377) ──
    const skl = ids.length ? await this.db.selectFrom('technician_skills').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', ids).select(['technician_id', 'skill_group']).execute().catch(() => []) : [];
    const sklBy: Record<string, string[]> = {}; for (const k of skl) (sklBy[k.technician_id] ||= []).push(k.skill_group);

    const app = ids.length ? await this.db.selectFrom('technician_app_settings').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', ids).select(['technician_id', 'app_enabled']).execute().catch(() => []) : [];
    const appBy: Record<string, boolean> = {}; for (const a of app) appBy[a.technician_id] = !!a.app_enabled;

    const prm = ids.length ? await this.db.selectFrom('technician_permissions').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', ids).select(['technician_id', 'permission_key', 'allowed']).execute().catch(() => []) : [];
    const prmBy: Record<string, { permission: string; allowed: boolean }[]> = {};
    for (const x of prm) (prmBy[x.technician_id] ||= []).push({ permission: x.permission_key, allowed: !!x.allowed });

    // The rating is the technician's OWN — it lives on the global profile and follows her between salons.
    // NULL when she has no global profile yet. `0` would be a slander, not a fact.
    const gtpIds = rows.map((r: any) => r.global_tech_profile_id).filter(Boolean);
    const ratings = gtpIds.length ? await this.db.selectFrom('global_tech_profiles').where('id', 'in', gtpIds).select(['id', 'overall_rating']).execute().catch(() => []) : [];
    const ratingByProfile: Record<string, number | null> = {};
    for (const g of ratings) ratingByProfile[g.id] = g.overall_rating == null ? null : Number(g.overall_rating);

    const mapWork = (s?: string): TechWorkingStatus => (s === 'available' || s === 'in_service' || s === 'on_break' ? s : 'off_today');
    const workFromWf = (w: { queue: string; service: ServiceState }): TechWorkingStatus =>
      w.queue === 'SERVING' ? 'in_service' : w.queue === 'BREAK' ? 'on_break' : (w.queue === 'AVAILABLE' || w.queue === 'ASSIGNED') ? 'available' : 'off_today';
    return rows.map((r: any) => {
      const wf = wfBy[r.id];
      const rawPhoto = r.tech_avatar_url || r.gtp_avatar_url || r.user_avatar_url || null;
      const photoUrl = rawPhoto ? buildMediaUrl(rawPhoto) : null;
      return {
        technicianId: r.id, firstName: r.first_name || '', lastName: r.last_name || '', displayName: r.full_name || r.first_name || '',
        phone: r.phone_display || '', email: r.email || '', avatarUrl: photoUrl || undefined, status: (r.status as TechLifecycleStatus) || 'active',
        workingStatus: wf ? workFromWf(wf) : mapWork(statBy[r.id]),
        shiftStatus: (wf ? (wf.clock !== 'CLOCKED_OUT' ? 'on_shift' : 'clocked_out') : (shiftBy[r.id] ? 'on_shift' : 'clocked_out')) as TechShiftStatus,
        commissionPercent: Number(r.default_commission_split_percent || 0), todayCommissionCents: money.get(r.id)?.commissionCents ?? 0, todayTipsCents: money.get(r.id)?.tipsCents ?? 0, serviceIds: svcBy[r.id] || [], serviceCategoryIds: catsBy[r.id] || [], hasSchedule: hasSchedule.has(r.id), todaySalesCents: salesBy[r.id] || 0, role: r.role_label || undefined, branchId: r.branch_id ?? null,
        createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
        skillGroups: sklBy[r.id] || [],
        appEnabled: appBy[r.id] ?? true,
        perms: effectiveSet(prmBy[r.id] || []),
        rating: r.global_tech_profile_id ? (ratingByProfile[r.global_tech_profile_id] ?? null) : null,
      };
    });
  }
  private workToLegacy(t: Tech): TechnicianStatus {
    if (t.status !== 'active') return 'inactive';
    return ({ available: 'available', in_service: 'in_service', on_break: 'on_break', off_today: 'off_shift', scheduled_later: 'off_shift' } as Record<TechWorkingStatus, TechnicianStatus>)[t.workingStatus];
  }
  private toRow(ctx: TechniciansContext, t: Tech): POSTechnicianRow {
    return {
      technicianId: t.technicianId, tenantId: ctx.tenantId, branchId: ctx.branchId, firstName: t.firstName, lastName: t.lastName, displayName: t.displayName,
      avatarUrl: t.avatarUrl,
      phone: t.phone, email: t.email, status: t.status, workingStatus: t.workingStatus, shiftStatus: t.shiftStatus, role: t.role, skillGroups: t.skillGroups,
      servicesCount: t.serviceIds.length, todaySalesCents: t.todaySalesCents, todayTipsCents: t.todayTipsCents, estimatedCommissionCents: t.todayCommissionCents,
      ...(t.rating == null ? {} : { rating: t.rating }),     // omitted, not zeroed, when she has no rating yet
      techAppEnabled: t.appEnabled, canProcessPayment: t.perms.has('pos.tech.process_payment'),
      createdAt: t.createdAt, updatedAt: t.updatedAt,
    };
  }
  private filtered(all: Tech[], f: TechnicianFilters): Tech[] {
    let r = all.slice();
    if (f.search) { const q = foldVi(f.search);   /* WP-E §41: accent-insensitive ("nguyen" finds "Nguyễn") */ r = r.filter((t) => [t.displayName, t.firstName, t.lastName, t.phone, t.email].some((x) => foldVi(x).includes(q))); }
    if (f.status) r = r.filter((t) => t.status === f.status);
    if (f.workingStatus) r = r.filter((t) => t.workingStatus === f.workingStatus);
    if (f.shiftStatus) r = r.filter((t) => t.shiftStatus === f.shiftStatus);
    // These three used to be dishonest. `canProcessPayment` was the worst of them:
    //     r.filter(() => !this.bool(f.canProcessPayment))   // "no schema → none can process payment"
    // — a filter that answered a question about the data by ignoring the data. All three are real now.
    if (f.canProcessPayment !== undefined) { const want = this.bool(f.canProcessPayment); r = r.filter((t) => t.perms.has('pos.tech.process_payment') === want); }
    if (f.techAppEnabled !== undefined) { const want = this.bool(f.techAppEnabled); r = r.filter((t) => t.appEnabled === want); }
    if (f.skillGroup) r = r.filter((t) => t.skillGroups.includes(f.skillGroup!));
    if (f.serviceCategory) r = r.filter((t) => t.serviceCategoryIds.includes(f.serviceCategory!));
    if (this.bool(f.missingSchedule)) r = r.filter((t) => !t.hasSchedule);
    if (this.bool(f.missingMapping)) r = r.filter((t) => t.serviceIds.length === 0);
    // §34: role and branch on the server (the Team tabs filtered only the 20 rows of the page on screen)
    if (f.role) r = r.filter((t) => (t.role || 'Unassigned') === f.role);
    if (f.branchId) r = r.filter((t) => t.branchId === f.branchId || t.branchId == null);
    return r;
  }

  /** §34: the branches this caller may filter by — the session's own branch when branch-scoped, else the tenant's. */
  private async branchFacet(ctx: TechniciansContext): Promise<{ branchId: string; name: string }[]> {
    let q = this.db.selectFrom('branches').select(['id', 'name']).where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where('id', '=', ctx.branchId);
    const rows: Array<{ id: unknown; name: unknown }> = await q.orderBy('name').limit(500).execute();   // a failed read fails the request (never an empty facet that hides branches)
    return rows.map((b) => ({ branchId: String(b.id), name: String(b.name || b.id) }));
  }

  async query(ctx: TechniciansContext, f: TechnicianFilters): Promise<POSTechniciansFullState> {
    const [all, branches] = await Promise.all([this.load(ctx), this.branchFacet(ctx)]);
    const matched = this.filtered(all, f);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const pagination: Pagination = { page, pageSize, totalItems, totalPages };
    const listItems: TechnicianListItem[] = pageRows.map((t) => ({ technicianId: t.technicianId, fullName: `${t.firstName} ${t.lastName}`.trim(), phone: t.phone, roleLabel: 'Technician', status: this.workToLegacy(t), specialties: t.skillGroups, todayAppointments: 0, todaySalesCents: t.todaySalesCents, rating: t.rating ?? 0, reviewCount: 0 }));
    // Averaged over the technicians who actually HAVE a rating. Including the unrated as 0 would drag the salon's
    // average down every time it hired somebody, which is not a fact about the salon.
    const rated = all.map((t) => t.rating).filter((r): r is number => r != null);
    const avgRatingReal = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 100) / 100 : 0;
    const rowItems = pageRows.map((t) => this.toRow(ctx, t));
    const active = all.filter((t) => t.status === 'active');
    const kpis: TechnicianKpis = {
      totalTechnicians: all.length, totalTechniciansTrendCount: 0, availableNow: active.filter((t) => t.workingStatus === 'available').length, availableNowPercent: 0,
      inService: active.filter((t) => t.workingStatus === 'in_service').length, inServicePercent: 0, onBreakOrLunch: active.filter((t) => t.workingStatus === 'on_break').length, onBreakOrLunchPercent: 0,
      averageRating: avgRatingReal, averageRatingDelta: 0, todaysSalesCents: all.reduce((a, t) => a + t.todaySalesCents, 0), todaysSalesTrendPercent: 0,
    };
    // Total services completed today = service lines on tickets that reached service_done today (tenant/branch scoped).
    const doneTodayRows = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('service_done_at', '>=', (await this.dayStart(ctx)))
      .select('id').execute().catch(() => []);
    const doneTodayIds = doneTodayRows.map((r: any) => r.id).filter(Boolean);
    let totalServicesCompletedToday = 0;
    if (doneTodayIds.length) {
      const cntRow = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx)
        .where('ticket_id', 'in', doneTodayIds)
        .select(sql<number>`count(*)`.as('n')).executeTakeFirst().catch(() => undefined);
      totalServicesCompletedToday = Math.max(0, Math.round(Number(cntRow?.n || 0)));
    }
    const kpisFull: POSTechniciansKpisFull = {
      totalTechnicians: all.length, activeTechnicians: active.length, availableNow: active.filter((t) => t.workingStatus === 'available').length,
      inService: active.filter((t) => t.workingStatus === 'in_service').length, onBreak: active.filter((t) => t.workingStatus === 'on_break').length, offToday: all.filter((t) => t.workingStatus === 'off_today').length,
      avgRating: avgRatingReal, todaySalesCents: all.reduce((a, t) => a + t.todaySalesCents, 0), todayTipsCents: all.reduce((a, t) => a + t.todayTipsCents, 0), estimatedCommissionCents: all.reduce((a, t) => a + t.todayCommissionCents, 0),
      totalServicesCompletedToday,
    };
    const insights: TechnicianInsights = {
      utilizationRatePercent: 0, utilizationTrendPercent: 0, averageTicketValueCents: 0, averageTicketTrendPercent: 0, customerRating: avgRatingReal, customerRatingDelta: 0,
      attendancePercent: all.length ? Math.round((active.length / all.length) * 100) : 0, presentTechnicians: active.filter((t) => t.shiftStatus === 'on_shift').length, totalTechnicians: all.length,
      helperMergeCount: 0, helperMergeTrendPercent: 0, payrollSnapshotCents: all.reduce((a, t) => a + t.todayCommissionCents, 0), sparklineData: [],
    };
    return {
      kpis, technicians: { items: listItems, pagination } as TechnicianListResponse, insights,
      filters: { statuses: ['active', 'inactive', 'suspended', 'archived'], roles: ['Technician', 'Senior Technician'], specialties: [] },
      kpisFull, rows: { items: rowItems, pagination },
      teamSummary: (() => {
        const rb = { excellent: 0, veryGood: 0, good: 0, needs: 0, unrated: 0 };
        for (const t of all) { const v = t.rating; if (v == null) rb.unrated++; else if (v >= 4.5) rb.excellent++; else if (v >= 3.5) rb.veryGood++; else if (v >= 2.5) rb.good++; else rb.needs++; }
        const roleCounts: Record<string, number> = {}; for (const t of all) { const rl = t.role || 'Unassigned'; roleCounts[rl] = (roleCounts[rl] || 0) + 1; }
        return {
          topPerformers: all.filter((t) => t.todaySalesCents > 0).sort((a, b) => b.todaySalesCents - a.todaySalesCents || a.technicianId.localeCompare(b.technicianId)).slice(0, 5).map((t) => ({ technicianId: t.technicianId, displayName: t.displayName, todaySalesCents: t.todaySalesCents, rating: t.rating ?? null })),
          ratingBuckets: rb, roleCounts, servicesMapped: all.reduce((a, t) => a + t.serviceIds.length, 0),
        };
      })(),
      filterFacets: { statuses: ['active', 'inactive', 'suspended', 'archived'], roles: ['Technician', 'Senior Technician'], skillGroups: [...new Set(all.flatMap((t) => t.skillGroups))].sort(), serviceCategories: ['Manicures', 'Pedicures', 'Enhancements'], shiftStatuses: ['on_shift', 'not_clocked_in', 'clocked_out'], appAccessStatuses: ['enabled', 'disabled'], branches },
    };
  }

  async detail(ctx: TechniciansContext, id: string): Promise<POSTechnicianDetail | null> {
    const all = await this.load(ctx, id); const t = all.find((x) => x.technicianId === id); if (!t) return null;
    return {
      ...this.toRow(ctx, t), schedule: (await this.getSchedule(ctx, id))!, shift: { shiftStatus: t.shiftStatus, onBreak: t.workingStatus === 'on_break' },
      skills: { skillGroups: t.skillGroups }, services: { serviceIds: t.serviceIds }, commission: { defaultPercent: t.commissionPercent, byService: [], byCategory: [], tipHandling: 'keep', payrollPeriod: 'biweekly' },
      appAccess: (await this.getAppAccess(ctx, id))!, permissions: (await this.getPermissions(ctx, id))!,
      payroll: (await this.payrollSummary(ctx, id))!, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: t.updatedAt }],
    };
  }

  async create(ctx: TechniciansContext, req: CreateTechnicianRequest): Promise<POSTechnicianRow> {
    const fullName = req.displayName || `${req.firstName} ${req.lastName}`.trim();
    // ONE tenant-default reader (compensation-rule-loader.defaultCommissionForTenant): a new technician inherits
    // tenants.default_commission_percent (platform fallback only when the salon never set one). No literal rate here.
    const commPct = req.defaultCommissionPercent;
    const finalComm = commPct != null && Number.isFinite(commPct) ? commPct : (await defaultCommissionForTenant(this.db, ctx.tenantId)).commissionValue;

    // ONE normalizer. technicians.normalized_phone / email, users.normalized_phone / email and the global profile's
    // keys are all written from identityKeys() — the same function the identity lookup matches on. Two normalizers
    // (toStoredCustomerPhone here, a bare regex in update(), identityKeys in the identity service) is how a
    // technician's phone stopped matching her own account.
    const keys = identityKeys({ phone: req.phone, email: req.email });
    await this.assertServicesBelongToTenant(ctx, req.serviceIds);

    const ins = await this.db.insertInto('technicians').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId, first_name: req.firstName, last_name: req.lastName, full_name: fullName,
      normalized_phone: keys.normalizedPhone, phone_display: req.phone || null, email: keys.emailNormalized, role_label: 'Technician',
      status: req.status || 'active', commission_type: 'percent', commission_value: finalComm, default_commission_split_percent: finalComm, is_active: (req.status || 'active') === 'active',
    }).returning(['id']).executeTakeFirstOrThrow();
    const tid = ins.id;
    if (req.serviceIds?.length) await this.db.insertInto('technician_services').values(req.serviceIds.map((sid) => ({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: tid, service_id: sid, is_primary: false }))).execute();
    return (await this.toRowById(ctx, tid))!;
  }

  /**
   * Every serviceId must be one of THIS salon's services. A client could otherwise map a technician to another
   * tenant's service id — a cross-tenant reference the tenant-scoped reads would then silently drop or, worse,
   * join through. Refused as a validation error, not quietly filtered.
   */
  private async assertServicesBelongToTenant(ctx: TechniciansContext, serviceIds?: string[] | null): Promise<void> {
    const ids = [...new Set((serviceIds ?? []).map((x) => String(x)).filter(Boolean))];
    if (!ids.length) return;
    const rows = await this.db.selectFrom('services').select('id').where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute().catch(() => []);
    const ok = new Set(rows.map((r) => String(r.id)));
    const bad = ids.filter((id) => !ok.has(id));
    if (bad.length) throw withCode(new ValidationError('One or more services do not belong to this salon.'), 'SERVICES_NOT_IN_SALON');
  }

  /**
   * Phone / email edits on the roster propagate to the technician's LOGIN at this salon (users) and to her global
   * identity keys — but the global keys only when they were BLANK or were this salon's own value to begin with
   * (equal to what the roster row held). A salon correcting the number it hired her on is syncing; a salon
   * overwriting a number the technician set on her own public profile is not, and that write is skipped.
   * A key another live profile already holds is refused by uq_gtp_phone_hash / uq_gtp_email — surfaced as a
   * validation error rather than a 500, and nothing on the roster row is changed when that happens.
   */
  private async syncIdentityKeys(ctx: TechniciansContext, id: string, prev: { normalized_phone: string | null; email: string | null; user_id: string | null; global_tech_profile_id: string | null }, keys: ReturnType<typeof identityKeys>, touched: { phone: boolean; email: boolean }): Promise<void> {
    if (!touched.phone && !touched.email) return;
    await this.db.transaction().execute(async (trx) => {
      const patch: any = { updated_at: sql`now()` };
      if (touched.phone) patch.normalized_phone = keys.normalizedPhone;
      if (touched.email) patch.email = keys.emailNormalized;
      await trx.updateTable('technicians').set(patch).where('id', '=', id).where('tenant_id', '=', ctx.tenantId).execute();

      if (prev.user_id) {
        const up: any = { updated_at: sql`now()` };
        if (touched.phone) up.normalized_phone = keys.normalizedPhone;
        if (touched.email) up.email = keys.emailNormalized;
        await trx.updateTable('users').set(up).where('id', '=', prev.user_id).where('tenant_id', '=', ctx.tenantId).execute();
      }

      if (prev.global_tech_profile_id) {
        if (touched.phone) {
          await sql`update global_tech_profiles set normalized_phone = ${keys.normalizedPhone}, phone_hash = ${keys.phoneHash}, updated_at = now()
                     where id = ${prev.global_tech_profile_id} and (normalized_phone is null or normalized_phone is not distinct from ${prev.normalized_phone})`.execute(trx);
        }
        if (touched.email) {
          await sql`update global_tech_profiles set email_normalized = ${keys.emailNormalized}, updated_at = now()
                     where id = ${prev.global_tech_profile_id} and (email_normalized is null or email_normalized is not distinct from ${prev.email})`.execute(trx);
        }
      }
    }).catch((e: any) => {
      if (String(e?.code) === '23505' || /unique|duplicate key/i.test(String(e?.message))) {
        throw withCode(new ValidationError('That phone or email already belongs to another technician account.'), 'CONTACT_IN_USE_TECHNICIAN');
      }
      throw e;
    });
  }
  private async toRowById(ctx: TechniciansContext, id: string): Promise<POSTechnicianRow | null> {
    const all = await this.load(ctx, id); const t = all.find((x) => x.technicianId === id); return t ? this.toRow(ctx, t) : null;
  }
  async update(ctx: TechniciansContext, id: string, req: UpdateTechnicianRequest): Promise<POSTechnicianRow | null> {
    await this.assertServicesBelongToTenant(ctx, req.serviceIds);
    const prev: any = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', id)
      .select(['normalized_phone', 'email', 'user_id', 'global_tech_profile_id']).executeTakeFirst().catch(() => undefined);
    const patch: any = { updated_at: sql`now()` };
    if (req.fullName != null) { const [fn, ...rest] = req.fullName.split(' '); patch.first_name = fn; patch.last_name = rest.join(' '); patch.full_name = req.fullName; }
    // phone/email: the display value lands here; the NORMALIZED keys go through syncIdentityKeys (one normalizer,
    // propagated to users + the global profile) once the row update has succeeded.
    if (req.phone != null) patch.phone_display = req.phone;
    const keys = identityKeys({ phone: req.phone ?? null, email: req.email ?? null });
    if (prev && (req.phone != null || req.email != null)) {
      await this.syncIdentityKeys(ctx, id, prev, keys, { phone: req.phone != null, email: req.email != null });
    }
    // Commission is NOT written here (mandate §94 / their workforce audit P0 #2) — only setCommission (admin-code gated)
    // touches default_commission_split_percent / commission_value. The service strips the field; this is the backstop.
    const res = await this.scoped(this.db.updateTable('technicians'), ctx).set(patch).where('id', '=', id).executeTakeFirst();
    const updated = Number(res?.numUpdatedRows ?? 0) > 0;
    if (req.serviceIds != null) { await this.markExactEligibility(ctx, id); await this.scoped(this.db.deleteFrom('technician_services'), ctx).where('technician_id', '=', id).execute(); if (req.serviceIds.length) await this.db.insertInto('technician_services').values(req.serviceIds.map((sid) => ({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: id, service_id: sid, is_primary: false }))).execute(); }
    return updated || req.serviceIds != null ? this.toRowById(ctx, id) : null;
  }
  async setLifecycle(ctx: TechniciansContext, id: string, status: TechLifecycleStatus): Promise<POSTechnicianRow | null> {
    const res = await this.scoped(this.db.updateTable('technicians'), ctx).set({ status, is_active: status === 'active', archived_at: status === 'archived' ? sql`now()` : null, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst();
    if (!Number(res?.numUpdatedRows ?? 0)) return null;
    return this.toRowById(ctx, id);
  }
  private async exists(ctx: TechniciansContext, id: string) { const r = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', id).select('id').executeTakeFirst().catch(() => undefined); return !!r; }
  async usage(ctx: TechniciansContext, id: string) {
    if (!(await this.exists(ctx, id))) return null;
    const t = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('technician_id', '=', id).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    const n = Number(t?.n || 0); return { ticketLines: n, serviceLines: n, reportRefs: 0 };
  }

  // ---- schedule (real, technician_schedules) ----
  async getSchedule(ctx: TechniciansContext, id: string): Promise<TechnicianSchedule | null> {
    if (!(await this.exists(ctx, id))) return null;
    const rows = await this.scoped(this.db.selectFrom('technician_schedules'), ctx).where('technician_id', '=', id)
      .select(['day_of_week', 'start_time', 'end_time', 'lunch_start_time', 'lunch_end_time', 'is_working', 'shifts', 'breaks', 'version']).execute().catch(() => []);
    const weekly: Record<string, any> = {};
    for (const r of rows) {
      const name = DAY_NAMES[Number(r.day_of_week) % 7];
      let shifts = undefined;
      let breaks = undefined;
      try { if (r.shifts) shifts = typeof r.shifts === 'string' ? JSON.parse(r.shifts) : r.shifts; } catch {}
      try { if (r.breaks) breaks = typeof r.breaks === 'string' ? JSON.parse(r.breaks) : r.breaks; } catch {}
      weekly[name] = { isWorking: !!r.is_working, startTime: r.start_time || '09:00', endTime: r.end_time || '18:00', lunchStart: r.lunch_start_time || undefined, lunchEnd: r.lunch_end_time || undefined, shifts, breaks };
    }
    const version = rows.reduce((m: number, r: any) => Math.max(m, Number(r.version ?? 0)), 0);
    return { weekly, unavailableDates: await this.approvedTimeOffDates(ctx, id), branchId: ctx.branchId, version };
  }
  /** The branch-local dates covered by APPROVED time off (582) from today onward — no longer a hard-coded []. */
  private async approvedTimeOffDates(ctx: TechniciansContext, id: string): Promise<string[]> {
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null);
    const rows = await this.db.selectFrom('technician_time_off').select(['starts_at', 'ends_at'])
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', id).where('status', '=', 'approved')
      .where('ends_at', '>=', new Date(this.now())).orderBy('starts_at', 'asc').limit(200).execute().catch(() => [] as any[]);
    const out = new Set<string>();
    for (const r of rows) {
      const start = new Date(r.starts_at).getTime(); const end = new Date(r.ends_at).getTime() - 1;
      for (let t = start, n = 0; t <= end && n < 366; t += 86_400_000, n++) out.add(businessDate(tz, new Date(t)));
      out.add(businessDate(tz, new Date(end)));
    }
    return [...out].sort();
  }
  /**
   * Replace the weekly schedule as one unit. BUILD_PLAN Phase 10 (Constitution 1 §40): the delete + insert now run in ONE
   * transaction under a row lock on the technician (two saves used to interleave and could leave a mixed or empty week),
   * every new row carries version = previous + 1, and an `expectedVersion` that is not the stored one is refused
   * (ScheduleVersionConflict → 409 VERSION_CONFLICT) — the stale editor reloads instead of overwriting.
   */
  async setSchedule(ctx: TechniciansContext, id: string, s: TechnicianSchedule): Promise<TechnicianSchedule | null> {
    if (!(await this.exists(ctx, id))) return null;
    const expected = s.expectedVersion === undefined || s.expectedVersion === null ? null : Number(s.expectedVersion);
    await this.db.transaction().execute(async (trx) => {
      await sql`select id from technicians where id = ${id} and tenant_id = ${ctx.tenantId} for update`.execute(trx);
      // ONE weekly schedule per technician per weekday in the salon (uq_technician_schedules_tenant_tech_dow is tenant-wide,
      // not per branch). The technician is in this branch's scope (exists() above), so her week is replaced WHEREVER its
      // rows were written: a technician transferred from another location used to keep that location's rows, and saving
      // her week at the new location died on the unique key (a 500 — found by the 200-technician M5 pilot, Oct 24 2026).
      const cur = Number((await trx.selectFrom('technician_schedules').where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', id)
        .select((eb: any) => eb.fn.coalesce(eb.fn.max('version'), sql`0`).as('v')).executeTakeFirst() as any)?.v ?? 0);
      if (expected !== null && expected !== cur) throw new ScheduleVersionConflict(cur);
      await trx.deleteFrom('technician_schedules').where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', id).execute();
      const vals = Object.entries(s.weekly || {}).map(([day, d]: any) => ({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: id, day_of_week: Math.max(0, DAY_NAMES.indexOf(day)), start_time: d.startTime || null, end_time: d.endTime || null, lunch_start_time: d.lunchStart || null, lunch_end_time: d.lunchEnd || null, is_working: !!d.isWorking, shifts: d.shifts ? JSON.stringify(d.shifts) : null, breaks: d.breaks ? JSON.stringify(d.breaks) : null, version: cur + 1 }));
      if (vals.length) await trx.insertInto('technician_schedules').values(vals).execute();
    });
    return (await this.getSchedule(ctx, id))!;
  }
  // ---- shift: derived (accepted, see header note) ----
  async getShift(ctx: TechniciansContext, id: string): Promise<TechnicianShift | null> { const all = await this.load(ctx, id); const t = all.find((x) => x.technicianId === id); return t ? { shiftStatus: t.shiftStatus, onBreak: t.workingStatus === 'on_break' } : null; }
  /**
   * The duplicate client-time clock path is GONE (Technician Profile merge). `PATCH /pos/technicians/:id/shifts` now
   * routes through TimeClockService (server time, one open punch — 580 dropped the (tenant, technician, shift_date)
   * unique this upsert keyed on — and the workforce state) in TechniciansService.setShift; this adapter only reads.
   * The in-memory adapter keeps a local implementation for the no-database path.
   */
  async setShift(ctx: TechniciansContext, id: string, _s: TechnicianShift): Promise<TechnicianShift | null> {
    if (!(await this.exists(ctx, id))) return null;
    throw new ValidationError('Clock changes go through the time clock (POST /pos/time-clock/clock-in|clock-out|break-start|break-end).');
  }

  // ---- skills (real, technician_skills — migration 377) ----
  async getSkills(ctx: TechniciansContext, id: string): Promise<TechnicianSkills | null> {
    if (!(await this.exists(ctx, id))) return null;
    const rows = await this.db.selectFrom('technician_skills').where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', id)
      .select(['skill_group']).orderBy('skill_group').execute().catch(() => []);
    return { skillGroups: rows.map((r: any) => r.skill_group) };
  }
  async setSkills(ctx: TechniciansContext, id: string, s: TechnicianSkills): Promise<TechnicianSkills | null> {
    if (!(await this.exists(ctx, id))) return null;
    const groups = [...new Set((s.skillGroups || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 40);
    await this.db.deleteFrom('technician_skills').where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', id).execute();
    if (groups.length) {
      await this.db.insertInto('technician_skills')
        .values(groups.map((g) => ({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, technician_id: id, skill_group: g })))
        .onConflict((oc: any) => oc.columns(['tenant_id', 'technician_id', 'skill_group']).doNothing()).execute();
    }
    return this.getSkills(ctx, id);
  }

  /** This salon's overrides for one technician. Only overrides are stored — the role supplies the rest. */
  private async overridesFor(ctx: TechniciansContext, id: string): Promise<{ permission: string; allowed: boolean }[]> {
    const rows = await this.db.selectFrom('technician_permissions')
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', id)
      .select(['permission_key', 'allowed']).execute().catch(() => []);
    return rows.map((r: any) => ({ permission: r.permission_key, allowed: !!r.allowed }));
  }

  /** Write the matrix. An `allowed:false` on a role default is a real row — a salon revoking what the role grants. */
  private async writeOverrides(ctx: TechniciansContext, id: string, matrix: { permission: string; allowed: boolean }[]) {
    const known = new Set<string>(TECH_PERMISSION_KEYS as readonly string[]);
    const rows = matrix.filter((m) => known.has(m.permission));
    if (!rows.length) return;
    await this.db.insertInto('technician_permissions')
      .values(rows.map((m) => ({
        tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, technician_id: id,
        permission_key: m.permission, allowed: !!m.allowed, updated_by_user_id: ctx.userId, updated_at: sql`now()`,
      })))
      .onConflict((oc: any) => oc.columns(['tenant_id', 'technician_id', 'permission_key']).doUpdateSet({
        allowed: (eb: any) => eb.ref('excluded.allowed'), updated_by_user_id: ctx.userId, updated_at: sql`now()`,
      })).execute();
  }
  // ---- services (real, technician_services) ----
  async getServices(ctx: TechniciansContext, id: string): Promise<TechnicianServicesMap | null> {
    if (!(await this.exists(ctx, id))) return null;
    const rows = await this.scoped(this.db.selectFrom('technician_services'), ctx).where('technician_id', '=', id).select(['service_id']).execute().catch(() => []);
    return { serviceIds: rows.map((r: any) => r.service_id) };
  }
  async listQualified(ctx: TechniciansContext, serviceId: string): Promise<QualifiedTechnician[]> {
    if (!serviceId) return [];
    const all = await this.load(ctx);   // reuses the tenant/branch-scoped roster loader (incl. technician_services mapping)
    return all.filter((t) => t.status === 'active' && t.serviceIds.includes(serviceId))
      .map((t) => ({ technicianId: t.technicianId, displayName: t.displayName, workingStatus: t.workingStatus, shiftStatus: t.shiftStatus, status: t.status }));
  }
  /** An explicit service list (even an empty one) ends the pre-631 "no mapping yet" leniency of the eligibility engine. */
  private async markExactEligibility(ctx: TechniciansContext, id: string): Promise<void> {
    await this.db.updateTable('technicians').set({ service_eligibility_mode: 'exact' }).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).execute();
  }
  async setServices(ctx: TechniciansContext, id: string, s: TechnicianServicesMap): Promise<TechnicianServicesMap | null> {
    if (!(await this.exists(ctx, id))) return null;
    await this.assertServicesBelongToTenant(ctx, s.serviceIds);
    await this.markExactEligibility(ctx, id);
    await this.scoped(this.db.deleteFrom('technician_services'), ctx).where('technician_id', '=', id).execute();
    if (s.serviceIds.length) await this.db.insertInto('technician_services').values(s.serviceIds.map((sid) => ({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: id, service_id: sid, is_primary: false }))).execute();
    return { serviceIds: s.serviceIds };
  }
  // ---- commission (real, on technicians) ----
  async getCommission(ctx: TechniciansContext, id: string): Promise<TechnicianCommissionConfig | null> {
    const r = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', id).select(['default_commission_split_percent']).executeTakeFirst().catch(() => undefined);
    return r ? { defaultPercent: Number(r.default_commission_split_percent || 0), byService: [], byCategory: [], tipHandling: 'keep', payrollPeriod: 'biweekly' } : null;
  }
  async setCommission(ctx: TechniciansContext, id: string, c: TechnicianCommissionConfig): Promise<TechnicianCommissionConfig | null> {
    const res = await this.scoped(this.db.updateTable('technicians'), ctx).set({ default_commission_split_percent: c.defaultPercent, commission_value: c.defaultPercent, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) ? c : null;
  }
  async payrollSummary(ctx: TechniciansContext, id: string): Promise<TechnicianPayrollSummary | null> {
    const all = await this.load(ctx, id); const t = all.find((x) => x.technicianId === id); if (!t) return null;
    // ONE-PAY: the snapshot's commission + tips for today (the period's own figures live on the payroll lines)
    return { periodLabel: 'Current period', salesCents: t.todaySalesCents, tipsCents: t.todayTipsCents, commissionCents: t.todayCommissionCents, estimatedTodayCents: t.todayCommissionCents, closed: false };
  }
  // ---- app access / permissions: no schema (accepted/defaults) ----
  // ---- app access (real, technician_app_settings + the ONE permission matrix — migration 377) ----
  //
  // The can* flags are DERIVED from technician_permissions, not stored here. Storing them twice is how the App
  // Access screen and the Permissions screen end up disagreeing, and a manager who turns payment off in one and
  // sees it on in the other has no way to tell which is real.
  async getAppAccess(ctx: TechniciansContext, id: string): Promise<TechnicianAppAccess | null> {
    if (!(await this.exists(ctx, id))) return null;
    const cfg: any = await this.db.selectFrom('technician_app_settings')
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', id)
      .select(['app_enabled', 'pin_enabled', 'allowed_sections', 'allowed_branches']).executeTakeFirst().catch(() => undefined);
    const perms = effectiveSet(await this.overridesFor(ctx, id));
    // loginEmail is users.email — DERIVED, never copied into a second column that could go stale.
    const login: any = await this.db.selectFrom('technicians as t').leftJoin('users as u', 'u.id', 't.user_id')
      .where('t.tenant_id', '=', ctx.tenantId).where('t.id', '=', id)
      .select(['u.email as user_email', 't.email as tech_email']).executeTakeFirst().catch(() => undefined);
    const j = (v: any, d: string[]) => { try { const x = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(x) && x.length ? x : d; } catch { return d; } };
    return {
      enabled: cfg ? !!cfg.app_enabled : true,
      loginEmail: String(login?.user_email || login?.tech_email || ''),
      pinEnabled: cfg ? !!cfg.pin_enabled : true,
      allowedBranches: j(cfg?.allowed_branches, []),
      allowedSections: j(cfg?.allowed_sections, DEFAULT_SECTIONS),
      canAcceptTicket: perms.has(ACCESS_TO_PERMISSION.canAcceptTicket),
      canStartService: perms.has(ACCESS_TO_PERMISSION.canStartService),
      canMarkDone: perms.has(ACCESS_TO_PERMISSION.canMarkDone),
      canRequestBreak: perms.has(ACCESS_TO_PERMISSION.canRequestBreak),
      canViewEarnings: perms.has(ACCESS_TO_PERMISSION.canViewEarnings),
      canEditNotes: perms.has(ACCESS_TO_PERMISSION.canEditNotes),
      canProcessPayment: perms.has(ACCESS_TO_PERMISSION.canProcessPayment),
    };
  }
  async setAppAccess(ctx: TechniciansContext, id: string, a: TechnicianAppAccess): Promise<TechnicianAppAccess | null> {
    if (!(await this.exists(ctx, id))) return null;
    await this.db.insertInto('technician_app_settings').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, technician_id: id,
      app_enabled: !!a.enabled, pin_enabled: !!a.pinEnabled,
      allowed_sections: JSON.stringify(a.allowedSections ?? DEFAULT_SECTIONS),
      allowed_branches: JSON.stringify(a.allowedBranches ?? []),
      updated_by_user_id: ctx.userId, updated_at: sql`now()`,
    }).onConflict((oc: any) => oc.columns(['tenant_id', 'technician_id']).doUpdateSet({
      app_enabled: !!a.enabled, pin_enabled: !!a.pinEnabled,
      allowed_sections: JSON.stringify(a.allowedSections ?? DEFAULT_SECTIONS),
      allowed_branches: JSON.stringify(a.allowedBranches ?? []),
      branch_id: ctx.branchId || null, updated_by_user_id: ctx.userId, updated_at: sql`now()`,
    })).execute();

    // the can* toggles land in the ONE place permissions live
    await this.writeOverrides(ctx, id, Object.entries(ACCESS_TO_PERMISSION)
      .map(([flag, permission]) => ({ permission, allowed: !!(a as any)[flag] })));

    return this.getAppAccess(ctx, id);
  }

  // ---- permissions (real, technician_permissions — migration 377) ----
  async getPermissions(ctx: TechniciansContext, id: string): Promise<TechnicianPermissions | null> {
    if (!(await this.exists(ctx, id))) return null;
    const perms = effectiveSet(await this.overridesFor(ctx, id));
    return { matrix: TECH_PERMISSION_KEYS.map((k) => ({ permission: k, allowed: perms.has(k) })) };
  }
  async setPermissions(ctx: TechniciansContext, id: string, p: TechnicianPermissions): Promise<TechnicianPermissions | null> {
    if (!(await this.exists(ctx, id))) return null;
    await this.writeOverrides(ctx, id, p.matrix);
    return this.getPermissions(ctx, id);
  }

  async exportRows(ctx: TechniciansContext, f: TechnicianFilters): Promise<{ headers: string[]; rows: (string | number)[][] }> {
    const all = await this.load(ctx); const rows = this.filtered(all, f);
    return { headers: ['Id', 'Name', 'Status', 'Working', 'Skills', 'Services', 'TodaySales', 'Rating', 'TechApp'], rows: rows.map((t) => [t.technicianId, `${t.firstName} ${t.lastName}`, t.status, t.workingStatus, '', t.serviceIds.length, t.todaySalesCents, 0, 'yes']) };
  }
}
