import { TECH_PERMISSION_KEYS, type TechPermissionKey } from '@aipowersalon/permissions';
// technicians.dto.ts — AIPowerSalon POS Technicians + Technician mobile contracts.
// All POS endpoints derive tenantId/branchId from the authenticated session — never from the client.
// Super Admin technician management is a separate surface (/super-admin/technicians) and is NOT this module.

export type TechnicianStatus =
  | "available" | "in_service" | "on_break" | "lunch" | "off_shift" | "inactive";

export type TimelineStatus =
  | "completed" | "in_service" | "upcoming" | "waiting" | "cancelled" | "no_show" | "break";

// ---- §9 KPIs ----
export interface TechnicianKpis {
  totalTechnicians: number;
  totalTechniciansTrendCount: number;
  availableNow: number;
  availableNowPercent: number;
  inService: number;
  inServicePercent: number;
  onBreakOrLunch: number;
  onBreakOrLunchPercent: number;
  averageRating: number;
  averageRatingDelta: number;
  todaysSalesCents: number;
  todaysSalesTrendPercent: number;
}

// ---- §10 Table ----
export interface Pagination { page: number; pageSize: number; totalItems: number; totalPages: number; }

export interface TechnicianListItem {
  technicianId: string;
  fullName: string;
  phone: string;
  avatarUrl?: string;
  roleLabel: string;
  status: TechnicianStatus;
  specialties: string[];
  queuePosition?: number;
  todayAppointments: number;
  todaySalesCents: number;
  rating: number;
  reviewCount: number;
}
export interface TechnicianListResponse { items: TechnicianListItem[]; pagination: Pagination; }

// ---- §11-12 Profile + detail metrics ----
export interface TechnicianProfile {
  technicianId: string;
  fullName: string;
  phone: string;
  email?: string;
  avatarUrl?: string;
  roleLabel: string;
  status: TechnicianStatus;
  rating: number;
  reviewCount: number;
  specialties: string[];
  workingHours: { startTime: string; endTime: string };
  lunchBreak?: { startTime: string; endTime: string };
  queuePosition?: number;
  todaysSalesCents: number;
  tipsCents: number;
  commissionSplitPercent: number;
  helperMergeCount: number;
}

// ---- §14 Timeline ----
export interface TechnicianTimelineItem {
  id: string;
  sourceType: "appointment" | "ticket" | "break" | "blocked_time";
  timeLabel: string;
  startTime: string;
  endTime?: string;
  serviceName: string;
  customerName?: string;
  status: TimelineStatus;
  ticketId?: string;
  appointmentId?: string;
}

// ---- §15 Insights ----
export interface TechnicianInsights {
  utilizationRatePercent: number;
  utilizationTrendPercent: number;
  averageTicketValueCents: number;
  averageTicketTrendPercent: number;
  customerRating: number;
  customerRatingDelta: number;
  attendancePercent: number;
  presentTechnicians: number;
  totalTechnicians: number;
  helperMergeCount: number;
  helperMergeTrendPercent: number;
  payrollSnapshotCents: number;
  sparklineData: { key: string; points: number[] }[];
}

// ---- §22 Consolidated state ----
export interface POSTechniciansState {
  kpis: TechnicianKpis;
  technicians: TechnicianListResponse;
  selectedTechnician?: TechnicianProfile;
  selectedTimeline?: TechnicianTimelineItem[];
  insights: TechnicianInsights;
  filters: { statuses: string[]; roles: string[]; specialties: string[] };
}

// ---- §13/§18 Request DTOs ----
export interface UpdateTechnicianRequest {
  fullName?: string; phone?: string; email?: string; roleLabel?: string;
  avatarUrl?: string; specialties?: string[]; serviceIds?: string[];
  commissionSplitPercent?: number;
  workingHours?: { startTime: string; endTime: string };
  lunchBreak?: { startTime: string; endTime: string };
  status?: TechnicianStatus; pin?: string;
}
export interface ChangeTechnicianStatusRequest { status: TechnicianStatus; reason?: string; managerPin?: string; }
export interface AssignTicketToTechnicianRequest {
  queueItemId: string; ticketId: string; technicianId: string;
  overrideBusy?: boolean; overrideSkillMismatch?: boolean; managerPin?: string;
}

// ---- §16 Technician mobile dashboard ----
export interface TechDashboardState {
  technician: { technicianId: string; fullName: string; roleLabel: string; avatarUrl?: string; status: TechnicianStatus };
  todayOverview: { bookings: number; completed: number; inService: number; totalSalesCents: number; totalSalesTrendPercent: number };
  currentService?: { ticketId: string; serviceLineId: string; serviceName: string; customerName: string; elapsedSeconds: number; startedAt: string };
  nextAppointment?: { appointmentId: string; serviceName: string; customerName: string; startTime: string };
  earnings: { todaySalesCents: number; tipsCents: number; estimatedCommissionCents: number };
}

// ---- §17 Status transition guards (pure, unit-testable) ----
export function canChangeStatus(
  current: TechnicianStatus,
  next: TechnicianStatus,
  hasActiveService: boolean,
  managerOverride: boolean,
): { ok: boolean; reason?: string } {
  if (next === "off_shift" && hasActiveService && !managerOverride)
    return { ok: false, reason: "Technician has an active service" };
  if (next === "available" && hasActiveService && !managerOverride)
    return { ok: false, reason: "Active ticket still in service" };
  return { ok: true };
}

// ---- §20 earnings: read the compensation snapshot (CompensationSnapshotRepository) — ONE-PAY removed the line-rate
//      helpers (commissionForLine / summarizeEarnings) that used to live here.

// ===== §8/§10/§13-§20 additions: separated status model, richer row, sub-resources, filters =====
export type TechLifecycleStatus = "active" | "inactive" | "suspended" | "archived";
export type TechWorkingStatus = "available" | "in_service" | "on_break" | "off_today" | "scheduled_later";
export type TechShiftStatus = "on_shift" | "not_clocked_in" | "clocked_out";

export interface POSTechnicianRow {
  technicianId: string; tenantId: string; branchId?: string;
  firstName: string; lastName: string; displayName: string; phone?: string; email?: string; avatarUrl?: string;
  status: TechLifecycleStatus; workingStatus: TechWorkingStatus; shiftStatus?: TechShiftStatus; role?: string;
  skillGroups: string[]; servicesCount: number; todaySalesCents: number; todayTipsCents: number;
  estimatedCommissionCents: number; rating?: number; techAppEnabled: boolean; canProcessPayment: boolean;
  createdAt: string; updatedAt: string;
  // The global identity. Optional so every existing mapper (and the in-memory repo) still type-checks unchanged.
  globalTechProfileId?: string; globalTechCode?: string;
  linkedExistingProfile?: boolean; membershipStatus?: string;
  /** What happened to her invitation. `not_connected`/`failed` carries the link so a human can hand it over. */
  invite?: { created: boolean; channel?: string | null; deliveryStatus?: string | null; acceptUrl?: string | null; reason?: string | null };
}

export interface TechDaySchedule {
  isWorking: boolean;
  startTime: string;
  endTime: string;
  lunchStart?: string;
  lunchEnd?: string;
  shifts?: { startTime: string; endTime: string }[];
  breaks?: { startTime: string; endTime: string; type: 'lunch' | 'paid' | 'unpaid' }[];
}
/** `version` (Phase 10, Constitution 1 §40): the schedule's version, returned by GET; send it back as `expectedVersion`
 *  (or If-Match) on PATCH and a stale write is refused with 409 VERSION_CONFLICT instead of overwriting the other edit. */
export interface TechnicianSchedule { weekly: Record<string, TechDaySchedule>; unavailableDates: string[]; branchId?: string; version?: number; expectedVersion?: number | null; }
/** A schedule PATCH whose expectedVersion is not the stored one (another device saved first). */
export class ScheduleVersionConflict extends Error {
  readonly code = 'VERSION_CONFLICT' as const;
  constructor(public currentVersion: number) { super('This schedule was changed on another device. Reload it and try again.'); this.name = 'ScheduleVersionConflict'; }
}
export interface TechnicianShift { shiftStatus: TechShiftStatus; clockedInAt?: string; onBreak: boolean; note?: string; }
export interface TechnicianSkills { skillGroups: string[]; }
export interface TechnicianServicesMap { serviceIds: string[]; }
export interface TechnicianCommissionConfig {
  defaultPercent: number; byService: { serviceId: string; percent: number }[]; byCategory: { category: string; percent: number }[];
  fixedCents?: number; tipHandling: "keep" | "pool"; helperPercent?: number; payrollPeriod: "weekly" | "biweekly" | "monthly";
}
export interface TechnicianPayrollSummary { periodLabel: string; salesCents: number; tipsCents: number; commissionCents: number; estimatedTodayCents: number; closed: boolean; }
export interface TechnicianAppAccess {
  enabled: boolean; loginEmail?: string; pinEnabled: boolean; allowedBranches: string[]; allowedSections: string[];
  canAcceptTicket: boolean; canStartService: boolean; canMarkDone: boolean; canRequestBreak: boolean;
  canViewEarnings: boolean; canEditNotes: boolean; canProcessPayment: boolean;
}
// TECH_PERMISSION_KEYS / TechPermissionKey / effectiveTechPermissions live in @aipowersalon/permissions (Constitution 13
// §76: the permission vocabulary is the permissions package's), imported below for this DTO.
export interface TechnicianPermissions { matrix: { permission: TechPermissionKey; allowed: boolean }[]; }

export interface POSTechnicianDetail extends POSTechnicianRow {
  schedule: TechnicianSchedule; shift: TechnicianShift; skills: TechnicianSkills; services: TechnicianServicesMap;
  commission: TechnicianCommissionConfig; payroll: TechnicianPayrollSummary; appAccess: TechnicianAppAccess; permissions: TechnicianPermissions;
  auditSummary: { lastAction: string; lastActorRole: string; lastAt: string }[];
}

export interface CreateTechnicianRequest {
  firstName: string; lastName: string; displayName?: string; phone?: string; email?: string;
  status?: TechLifecycleStatus; skillGroups?: string[]; serviceIds?: string[]; defaultCommissionPercent?: number;
  techAppEnabled?: boolean; canProcessPayment?: boolean; pin?: string;
}
export interface TechnicianFilters {
  search?: string; status?: string; workingStatus?: string; skillGroup?: string; serviceCategory?: string;
  techAppEnabled?: string; canProcessPayment?: string; missingSchedule?: string; missingMapping?: string;
  shiftStatus?: string; page?: number; pageSize?: number;
  /** 200-technician mandate §34: server-side role filter ('Unassigned' = no role label) and branch filter (that branch's
   *  technicians + the tenant-wide ones; never widens the caller's branch scope) */
  role?: string; branchId?: string;
}
export interface POSTechniciansKpisFull {
  totalTechnicians: number; activeTechnicians: number; availableNow: number; inService: number; onBreak: number;
  offToday: number; avgRating: number; todaySalesCents: number; todayTipsCents: number; estimatedCommissionCents: number;
  totalServicesCompletedToday: number;
}
export interface TechniciansFilterFacets {
  statuses: string[]; roles: string[]; skillGroups: string[]; serviceCategories: string[]; shiftStatuses: string[]; appAccessStatuses: string[];
  /** §34: the branches the caller may filter the team by (the session's branch only, for a branch-scoped session) */
  branches?: { branchId: string; name: string }[];
}
/** 200-technician mandate §34/§71 (Oct 23 2026): the Team screen's side panels describe the WHOLE team (server-computed),
 *  not the page on screen — they summed / ranked only the 20 rows of the visible page. */
export interface TechniciansTeamSummary {
  topPerformers: { technicianId: string; displayName: string; todaySalesCents: number; rating: number | null }[];
  ratingBuckets: { excellent: number; veryGood: number; good: number; needs: number; unrated: number };
  roleCounts: Record<string, number>;
  servicesMapped: number;
}
export interface POSTechniciansFullState extends POSTechniciansState {
  kpisFull: POSTechniciansKpisFull;
  rows: { items: POSTechnicianRow[]; pagination: Pagination };
  teamSummary?: TechniciansTeamSummary;
  filterFacets: TechniciansFilterFacets;
  selectedTechnicianDetail?: POSTechnicianDetail;
}

// permissions safety: tenant POS may only toggle pos.tech.* keys — never escalate to super admin/owner-only
export function sanitizeTechPermissions(input: { permission: string; allowed: boolean }[]): { matrix: { permission: TechPermissionKey; allowed: boolean }[]; rejected: string[] } {
  const allowed = new Set<string>(TECH_PERMISSION_KEYS as readonly string[]);
  const matrix: { permission: TechPermissionKey; allowed: boolean }[] = [];
  const rejected: string[] = [];
  for (const p of input) { if (allowed.has(p.permission)) matrix.push({ permission: p.permission as TechPermissionKey, allowed: !!p.allowed }); else rejected.push(p.permission); }
  return { matrix, rejected };
}


export function techniciansToCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}
