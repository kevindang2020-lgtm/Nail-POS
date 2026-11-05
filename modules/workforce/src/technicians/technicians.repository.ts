// technicians.repository.ts — persistence port + in-memory adapter for POS Technicians.
// A tenant-scoped, MUTABLE roster so create/edit/status/schedule/skills/commission changes genuinely persist.
// Filters (§19) are applied server-side. A different tenant sees its own (empty) roster — isolation.
import { POSTechniciansFullState, POSTechnicianRow, POSTechnicianDetail, TechnicianFilters, TechnicianListItem, TechnicianListResponse, TechLifecycleStatus, TechWorkingStatus, TechShiftStatus, TechnicianStatus, TechnicianSchedule, ScheduleVersionConflict, TechnicianShift, TechnicianSkills, TechnicianServicesMap, TechnicianCommissionConfig, TechnicianPayrollSummary, TechnicianAppAccess, TechnicianPermissions, CreateTechnicianRequest, UpdateTechnicianRequest, POSTechniciansKpisFull, TechnicianKpis, TechnicianInsights, Pagination } from './technicians.dto';
import { TECH_PERMISSION_KEYS } from '@aipowersalon/permissions';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { QualifiedTechnician } from '@aipowersalon/api-contracts/tenant';
import type { QualifiedTechnician } from '@aipowersalon/api-contracts/tenant';

export interface TechniciansContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

interface Tech {
  technicianId: string; firstName: string; lastName: string; displayName: string; phone: string; email: string;
  status: TechLifecycleStatus; workingStatus: TechWorkingStatus; shiftStatus: TechShiftStatus;
  skillGroups: string[]; serviceIds: string[]; todaySalesCents: number; todayTipsCents: number; estimatedCommissionCents: number;
  rating: number; reviewCount: number; techAppEnabled: boolean; canProcessPayment: boolean; createdAt: string; updatedAt: string;
  schedule: TechnicianSchedule; shift: TechnicianShift; commission: TechnicianCommissionConfig; appAccess: TechnicianAppAccess;
  permissions: TechnicianPermissions; usage: { ticketLines: number; serviceLines: number; reportRefs: number };
}


export interface TechniciansRepositoryPort {
  query(ctx: TechniciansContext, f: TechnicianFilters): Promise<POSTechniciansFullState>;
  detail(ctx: TechniciansContext, id: string): Promise<POSTechnicianDetail | null>;
  create(ctx: TechniciansContext, req: CreateTechnicianRequest): Promise<POSTechnicianRow>;
  update(ctx: TechniciansContext, id: string, req: UpdateTechnicianRequest): Promise<POSTechnicianRow | null>;
  setLifecycle(ctx: TechniciansContext, id: string, status: TechLifecycleStatus): Promise<POSTechnicianRow | null>;
  usage(ctx: TechniciansContext, id: string): Promise<{ ticketLines: number; serviceLines: number; reportRefs: number } | null>;
  getSchedule(ctx: TechniciansContext, id: string): Promise<TechnicianSchedule | null>;
  setSchedule(ctx: TechniciansContext, id: string, s: TechnicianSchedule): Promise<TechnicianSchedule | null>;
  getShift(ctx: TechniciansContext, id: string): Promise<TechnicianShift | null>;
  setShift(ctx: TechniciansContext, id: string, s: TechnicianShift): Promise<TechnicianShift | null>;
  getSkills(ctx: TechniciansContext, id: string): Promise<TechnicianSkills | null>;
  setSkills(ctx: TechniciansContext, id: string, s: TechnicianSkills): Promise<TechnicianSkills | null>;
  getServices(ctx: TechniciansContext, id: string): Promise<TechnicianServicesMap | null>;
  setServices(ctx: TechniciansContext, id: string, s: TechnicianServicesMap): Promise<TechnicianServicesMap | null>;
  getCommission(ctx: TechniciansContext, id: string): Promise<TechnicianCommissionConfig | null>;
  setCommission(ctx: TechniciansContext, id: string, c: TechnicianCommissionConfig): Promise<TechnicianCommissionConfig | null>;
  payrollSummary(ctx: TechniciansContext, id: string): Promise<TechnicianPayrollSummary | null>;
  getAppAccess(ctx: TechniciansContext, id: string): Promise<TechnicianAppAccess | null>;
  setAppAccess(ctx: TechniciansContext, id: string, a: TechnicianAppAccess): Promise<TechnicianAppAccess | null>;
  getPermissions(ctx: TechniciansContext, id: string): Promise<TechnicianPermissions | null>;
  setPermissions(ctx: TechniciansContext, id: string, p: TechnicianPermissions): Promise<TechnicianPermissions | null>;
  // Technicians QUALIFIED for a given service (active + has a technician_services eligibility row for it), tenant/branch
  // scoped. Reuses the canonical eligibility mapping — no new table. Foundation for the Request-Help helper picker.
  listQualified(ctx: TechniciansContext, serviceId: string): Promise<QualifiedTechnician[]>;
  exportRows(ctx: TechniciansContext, f: TechnicianFilters): Promise<{ headers: string[]; rows: (string | number)[][] }>;
}

const now = () => new Date().toISOString();
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
function defaultSchedule(): TechnicianSchedule {
  const weekly: Record<string, any> = {};
  DAYS.forEach((d, i) => { weekly[d] = { isWorking: i < 5, startTime: '09:00', endTime: '18:00', lunchStart: '13:00', lunchEnd: '13:30' }; });
  return { weekly, unavailableDates: [], branchId: 'br_cherryhill' };
}
function defaultPermissions(): TechnicianPermissions {
  const on = new Set(['pos.tech.view_schedule', 'pos.tech.accept_ticket', 'pos.tech.start_service', 'pos.tech.mark_done', 'pos.tech.request_break', 'pos.tech.view_earnings']);
  return { matrix: TECH_PERMISSION_KEYS.map((k) => ({ permission: k, allowed: on.has(k) })) };
}
function defaultAppAccess(email: string, canPay: boolean): TechnicianAppAccess {
  return { enabled: true, loginEmail: email, pinEnabled: true, allowedBranches: ['br_cherryhill'], allowedSections: ['Home', 'Schedule', 'Tickets', 'Earnings', 'More'], canAcceptTicket: true, canStartService: true, canMarkDone: true, canRequestBreak: true, canViewEarnings: true, canEditNotes: true, canProcessPayment: canPay };
}
function defaultCommission(pct: number): TechnicianCommissionConfig { return { defaultPercent: pct, byService: [], byCategory: [], tipHandling: 'keep', payrollPeriod: 'biweekly' }; }

export class InMemoryTechniciansRepository implements TechniciansRepositoryPort {
  private store = new Map<string, Tech[]>();
  private seq = 2000;

  private ensure(tenantId: string) {
    if (this.store.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.store.set(tenantId, []); return; }
    const mk = (id: string, fn: string, ln: string, skills: string[], svcs: string[], life: TechLifecycleStatus, work: TechWorkingStatus, shift: TechShiftStatus, sales: number, tips: number, comm: number, rating: number, reviews: number, over: Partial<Tech> = {}): Tech => ({
      technicianId: id, firstName: fn, lastName: ln, displayName: fn, phone: '', email: (fn + '@salon.example').toLowerCase(), status: life, workingStatus: work, shiftStatus: shift,
      skillGroups: skills, serviceIds: svcs, todaySalesCents: sales, todayTipsCents: tips, estimatedCommissionCents: comm, rating, reviewCount: reviews,
      techAppEnabled: true, canProcessPayment: false, createdAt: now(), updatedAt: now(), schedule: defaultSchedule(), shift: { shiftStatus: shift, onBreak: work === 'on_break' },
      commission: defaultCommission(40), appAccess: defaultAppAccess((fn + '@salon.example').toLowerCase(), false), permissions: defaultPermissions(),
      usage: { ticketLines: 0, serviceLines: 0, reportRefs: 0 }, ...over,
    });
    this.store.set(tenantId, [
      mk('t_mia', 'Mia', 'Tran', ['manicure', 'gel'], ['svc_sig_mani', 'svc_gel_refresh'], 'active', 'in_service', 'on_shift', 28000, 5200, 11200, 4.9, 132, { canProcessPayment: true, usage: { ticketLines: 320, serviceLines: 320, reportRefs: 4 } }),
      mk('t_ava', 'Ava', 'Lopez', ['pedicure'], ['svc_spa_pedi'], 'active', 'available', 'on_shift', 19500, 3100, 7800, 4.8, 98, { usage: { ticketLines: 210, serviceLines: 210, reportRefs: 3 } }),
      mk('t_leo', 'Leo', 'Park', ['acrylic', 'nail_art'], ['svc_full_set'], 'active', 'on_break', 'on_shift', 16100, 2400, 6440, 4.7, 75, { usage: { ticketLines: 150, serviceLines: 150, reportRefs: 2 } }),
      mk('t_noor', 'Noor', 'Ali', ['manicure', 'waxing'], [], 'active', 'off_today', 'clocked_out', 0, 0, 0, 4.6, 40, { techAppEnabled: false, schedule: { weekly: {}, unavailableDates: [], branchId: 'br_cherryhill' } }), // missing mapping + missing schedule
      mk('t_rae', 'Rae', 'Kim', ['lashes'], ['svc_lash'], 'suspended', 'off_today', 'clocked_out', 0, 0, 0, 4.5, 22, { usage: { ticketLines: 60, serviceLines: 60, reportRefs: 1 } }),
    ]);
  }
  private L(ctx: TechniciansContext) { this.ensure(ctx.tenantId); return this.store.get(ctx.tenantId)!; }
  private find(ctx: TechniciansContext, id: string) { return this.L(ctx).find((t) => t.technicianId === id) || null; }
  private bool(v?: string) { return v === 'true' || v === 'yes' || v === '1'; }
  private workToLegacy(t: Tech): TechnicianStatus {
    if (t.status !== 'active') return 'inactive';
    return ({ available: 'available', in_service: 'in_service', on_break: 'on_break', off_today: 'off_shift', scheduled_later: 'off_shift' } as Record<TechWorkingStatus, TechnicianStatus>)[t.workingStatus];
  }
  private toRow(ctx: TechniciansContext, t: Tech): POSTechnicianRow {
    return {
      technicianId: t.technicianId, tenantId: ctx.tenantId, branchId: ctx.branchId, firstName: t.firstName, lastName: t.lastName, displayName: t.displayName,
      phone: t.phone, email: t.email, status: t.status, workingStatus: t.workingStatus, shiftStatus: t.shiftStatus, role: t.skillGroups[0] || 'Technician', skillGroups: t.skillGroups,
      servicesCount: t.serviceIds.length, todaySalesCents: t.todaySalesCents, todayTipsCents: t.todayTipsCents, estimatedCommissionCents: t.estimatedCommissionCents,
      rating: t.rating, techAppEnabled: t.techAppEnabled, canProcessPayment: t.canProcessPayment, createdAt: t.createdAt, updatedAt: t.updatedAt,
    };
  }
  private hasSchedule(t: Tech) { return Object.values(t.schedule.weekly).some((d) => d.isWorking); }

  private filtered(ctx: TechniciansContext, f: TechnicianFilters): Tech[] {
    let rows = this.L(ctx).slice();
    if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter((t) => [t.displayName, t.firstName, t.lastName, t.phone, t.email, ...t.skillGroups].some((x) => (x || '').toLowerCase().includes(q))); }
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.workingStatus) rows = rows.filter((t) => t.workingStatus === f.workingStatus);
    if (f.shiftStatus) rows = rows.filter((t) => t.shiftStatus === f.shiftStatus);
    if (f.skillGroup) rows = rows.filter((t) => t.skillGroups.includes(f.skillGroup!));
    if (f.techAppEnabled) rows = rows.filter((t) => t.techAppEnabled === this.bool(f.techAppEnabled));
    if (f.canProcessPayment) rows = rows.filter((t) => t.canProcessPayment === this.bool(f.canProcessPayment));
    if (this.bool(f.missingMapping)) rows = rows.filter((t) => t.serviceIds.length === 0);
    if (this.bool(f.missingSchedule)) rows = rows.filter((t) => !this.hasSchedule(t));
    return rows;
  }

  async query(ctx: TechniciansContext, f: TechnicianFilters) {
    const all = this.L(ctx);
    const matched = this.filtered(ctx, f);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const pagination: Pagination = { page, pageSize, totalItems, totalPages };

    const listItems: TechnicianListItem[] = pageRows.map((t) => ({
      technicianId: t.technicianId, fullName: `${t.firstName} ${t.lastName}`.trim(), phone: t.phone, roleLabel: 'Technician',
      status: this.workToLegacy(t), specialties: t.skillGroups, todayAppointments: 0, todaySalesCents: t.todaySalesCents, rating: t.rating, reviewCount: t.reviewCount,
    }));
    const rowItems: POSTechnicianRow[] = pageRows.map((t) => this.toRow(ctx, t));
    const active = all.filter((t) => t.status === 'active');
    const avgRating = all.length ? Math.round((all.reduce((a, t) => a + t.rating, 0) / all.length) * 10) / 10 : 0;

    const kpis: TechnicianKpis = {
      totalTechnicians: all.length, totalTechniciansTrendCount: 0,
      availableNow: active.filter((t) => t.workingStatus === 'available').length, availableNowPercent: 0,
      inService: active.filter((t) => t.workingStatus === 'in_service').length, inServicePercent: 0,
      onBreakOrLunch: active.filter((t) => t.workingStatus === 'on_break').length, onBreakOrLunchPercent: 0,
      averageRating: avgRating, averageRatingDelta: 0, todaysSalesCents: all.reduce((a, t) => a + t.todaySalesCents, 0), todaysSalesTrendPercent: 0,
    };
    const kpisFull: POSTechniciansKpisFull = {
      totalTechnicians: all.length, activeTechnicians: active.length,
      availableNow: active.filter((t) => t.workingStatus === 'available').length, inService: active.filter((t) => t.workingStatus === 'in_service').length,
      onBreak: active.filter((t) => t.workingStatus === 'on_break').length, offToday: all.filter((t) => t.workingStatus === 'off_today').length,
      avgRating, todaySalesCents: all.reduce((a, t) => a + t.todaySalesCents, 0), todayTipsCents: all.reduce((a, t) => a + t.todayTipsCents, 0),
      estimatedCommissionCents: all.reduce((a, t) => a + t.estimatedCommissionCents, 0),
      totalServicesCompletedToday: 0,
    };
    const insights: TechnicianInsights = {
      utilizationRatePercent: 0, utilizationTrendPercent: 0, averageTicketValueCents: 0, averageTicketTrendPercent: 0,
      customerRating: avgRating, customerRatingDelta: 0, attendancePercent: all.length ? Math.round((active.length / all.length) * 100) : 0,
      presentTechnicians: active.filter((t) => t.shiftStatus === 'on_shift').length, totalTechnicians: all.length, helperMergeCount: 0, helperMergeTrendPercent: 0,
      payrollSnapshotCents: all.reduce((a, t) => a + t.estimatedCommissionCents, 0), sparklineData: [],
    };

    return {
      kpis, technicians: { items: listItems, pagination } as TechnicianListResponse, insights,
      filters: { statuses: ['active', 'inactive', 'suspended', 'archived'], roles: ['Technician', 'Senior Technician'], specialties: [...new Set(all.flatMap((t) => t.skillGroups))] },
      kpisFull, rows: { items: rowItems, pagination },
      filterFacets: {
        statuses: ['active', 'inactive', 'suspended', 'archived'], roles: ['Technician', 'Senior Technician'],
        skillGroups: [...new Set(all.flatMap((t) => t.skillGroups))], serviceCategories: ['Manicures', 'Pedicures', 'Enhancements'],
        shiftStatuses: ['on_shift', 'not_clocked_in', 'clocked_out'], appAccessStatuses: ['enabled', 'disabled'],
      },
    };
  }

  async detail(ctx: TechniciansContext, id: string) {
    const t = this.find(ctx, id); if (!t) return null;
    return {
      ...this.toRow(ctx, t), schedule: t.schedule, shift: t.shift, skills: { skillGroups: t.skillGroups }, services: { serviceIds: t.serviceIds },
      commission: t.commission, appAccess: t.appAccess, permissions: t.permissions,
      payroll: (await this.payrollSummary(ctx, id))!, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: t.updatedAt }],
    };
  }

  async create(ctx: TechniciansContext, req: CreateTechnicianRequest) {
    const email = req.email || '';
    const t: Tech = {
      technicianId: 't_' + (++this.seq), firstName: req.firstName, lastName: req.lastName, displayName: req.displayName || req.firstName,
      phone: req.phone || '', email, status: req.status || 'active', workingStatus: 'off_today', shiftStatus: 'not_clocked_in',
      skillGroups: req.skillGroups || [], serviceIds: req.serviceIds || [], todaySalesCents: 0, todayTipsCents: 0, estimatedCommissionCents: 0,
      rating: 0, reviewCount: 0, techAppEnabled: req.techAppEnabled ?? true, canProcessPayment: req.canProcessPayment ?? false, createdAt: now(), updatedAt: now(),
      schedule: defaultSchedule(), shift: { shiftStatus: 'not_clocked_in', onBreak: false }, commission: defaultCommission(req.defaultCommissionPercent ?? 50),
      appAccess: defaultAppAccess(email, req.canProcessPayment ?? false), permissions: defaultPermissions(), usage: { ticketLines: 0, serviceLines: 0, reportRefs: 0 },
    };
    this.L(ctx).push(t); return this.toRow(ctx, t);
  }
  async update(ctx: TechniciansContext, id: string, req: UpdateTechnicianRequest) {
    const t = this.find(ctx, id); if (!t) return null;
    if (req.fullName != null) { const [fn, ...rest] = req.fullName.split(' '); t.firstName = fn; t.lastName = rest.join(' '); t.displayName = req.fullName; }
    if (req.phone != null) t.phone = req.phone; if (req.email != null) t.email = req.email;
    if (req.specialties != null) t.skillGroups = req.specialties; if (req.serviceIds != null) t.serviceIds = req.serviceIds;
    // commission is never written by a profile edit (mandate §94) — setCommission only
    if (req.status != null && ['available', 'in_service', 'on_break'].includes(req.status)) t.workingStatus = req.status as TechWorkingStatus;
    t.updatedAt = now(); return this.toRow(ctx, t);
  }
  async setLifecycle(ctx: TechniciansContext, id: string, status: TechLifecycleStatus) {
    const t = this.find(ctx, id); if (!t) return null; t.status = status; if (status !== 'active') t.workingStatus = 'off_today'; t.updatedAt = now(); return this.toRow(ctx, t);
  }
  async usage(ctx: TechniciansContext, id: string) { const t = this.find(ctx, id); return t ? t.usage : null; }

  async getSchedule(ctx: TechniciansContext, id: string) { return this.find(ctx, id)?.schedule ?? null; }
  async setSchedule(ctx: TechniciansContext, id: string, s: TechnicianSchedule) {
    const t = this.find(ctx, id); if (!t) return null;
    const cur = Number((t.schedule as any)?.version ?? 0);
    if (s.expectedVersion !== undefined && s.expectedVersion !== null && Number(s.expectedVersion) !== cur) throw new ScheduleVersionConflict(cur);
    const { expectedVersion: _ev, ...rest } = s; t.schedule = { ...rest, version: cur + 1 }; t.updatedAt = now(); return t.schedule;
  }
  async getShift(ctx: TechniciansContext, id: string) { return this.find(ctx, id)?.shift ?? null; }
  async setShift(ctx: TechniciansContext, id: string, s: TechnicianShift) { const t = this.find(ctx, id); if (!t) return null; t.shift = s; t.shiftStatus = s.shiftStatus; if (s.onBreak) t.workingStatus = 'on_break'; t.updatedAt = now(); return t.shift; }
  async getSkills(ctx: TechniciansContext, id: string) { const t = this.find(ctx, id); return t ? { skillGroups: t.skillGroups } : null; }
  async setSkills(ctx: TechniciansContext, id: string, s: TechnicianSkills) { const t = this.find(ctx, id); if (!t) return null; t.skillGroups = s.skillGroups; t.updatedAt = now(); return { skillGroups: t.skillGroups }; }
  async getServices(ctx: TechniciansContext, id: string) { const t = this.find(ctx, id); return t ? { serviceIds: t.serviceIds } : null; }
  async listQualified(ctx: TechniciansContext, serviceId: string): Promise<QualifiedTechnician[]> {
    if (!serviceId) return [];
    return this.L(ctx).filter((t) => t.status === 'active' && t.serviceIds.includes(serviceId))
      .map((t) => ({ technicianId: t.technicianId, displayName: t.displayName, workingStatus: t.workingStatus, shiftStatus: t.shiftStatus, status: t.status }));
  }
  async setServices(ctx: TechniciansContext, id: string, s: TechnicianServicesMap) { const t = this.find(ctx, id); if (!t) return null; t.serviceIds = s.serviceIds; t.updatedAt = now(); return { serviceIds: t.serviceIds }; }
  async getCommission(ctx: TechniciansContext, id: string) { return this.find(ctx, id)?.commission ?? null; }
  async setCommission(ctx: TechniciansContext, id: string, c: TechnicianCommissionConfig) { const t = this.find(ctx, id); if (!t) return null; t.commission = c; t.updatedAt = now(); return t.commission; }
  async payrollSummary(ctx: TechniciansContext, id: string) {
    const t = this.find(ctx, id); if (!t) return null;
    return { periodLabel: 'Current period', salesCents: t.todaySalesCents, tipsCents: t.todayTipsCents, commissionCents: t.estimatedCommissionCents, estimatedTodayCents: t.estimatedCommissionCents, closed: false };
  }
  async getAppAccess(ctx: TechniciansContext, id: string) { return this.find(ctx, id)?.appAccess ?? null; }
  async setAppAccess(ctx: TechniciansContext, id: string, a: TechnicianAppAccess) { const t = this.find(ctx, id); if (!t) return null; t.appAccess = a; t.techAppEnabled = a.enabled; t.canProcessPayment = a.canProcessPayment; t.updatedAt = now(); return t.appAccess; }
  async getPermissions(ctx: TechniciansContext, id: string) { return this.find(ctx, id)?.permissions ?? null; }
  async setPermissions(ctx: TechniciansContext, id: string, p: TechnicianPermissions) { const t = this.find(ctx, id); if (!t) return null; t.permissions = p; t.updatedAt = now(); return t.permissions; }

  async exportRows(ctx: TechniciansContext, f: TechnicianFilters) {
    const rows = this.filtered(ctx, f);
    return { headers: ['Id', 'Name', 'Status', 'Working', 'Skills', 'Services', 'TodaySales', 'Rating', 'TechApp'], rows: rows.map((t) => [t.technicianId, `${t.firstName} ${t.lastName}`, t.status, t.workingStatus, t.skillGroups.join('|'), t.serviceIds.length, t.todaySalesCents, t.rating, t.techAppEnabled ? 'yes' : 'no']) };
  }
}
