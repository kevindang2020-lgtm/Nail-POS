// super-admin-platform.repository.ts — data access for the four platform business modules the iPad spec defines:
// tenant applications, website leads, hardware packages, support-access sessions. Platform-scope (SuperAdminGuard
// only); applications/leads pre-date tenants so they carry no tenant_id.
import { safeInet, type DB, andTenant, tenantPred, type OverviewScope, canMoveToSql } from '@aipowersalon/database';
import { USER_INVITATION } from './invitation-lifecycle';
import { secureTempPassword } from '@aipowersalon/security';
import { Kysely, sql } from 'kysely';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';
import { existingTechnicianPasswordHash } from '@aipowersalon/identity';
import { mintInvitationToken, hashInvitationToken, invitationExpiry, decideAccept } from '@aipowersalon/identity';
import { approverCanGrant, isHighRisk, decideTransition, grantExpiry, type RequestAction } from './access-request-core';
import { effectiveAiFeatures } from '@aipowersalon/platform';
import { buildMediaUrl } from '@aipowersalon/media';
import type { RawGatewayRow, RawEventRow } from '@aipowersalon/payments';
import {
  branchHealthScore, bucketHealthDistribution, hoursAvailabilityClass, operationalAlerts,
  type BranchHealthSignals,
} from './branch-health-core';
import { normalizeBranchQuery, paginateBranches, filterBranches, sortBranches, type BranchDirRow } from './branch-directory-core';
import { type NormalizedBranch } from './branch-create-core';
import { type AssignManagerValue } from './branch-manager-core';
import { type TransferRequestValue } from './branch-transfer-core';
import { DAY_LABELS, type DayHoursValue } from './branch-hours-core';
import { canTransition } from './branch-lifecycle-core';
import { parseIdList } from './branch-bulk-core';
import { type AllocateDeviceValue } from './branch-device-core';
import { writeSupportAccessNotice, writeSupportExtensionNotice, decideExtension, MAX_EXTENSIONS, MAX_TOTAL_MINUTES } from '../support-mode/support-access-notice';
import { ACCESS_REQUEST, CUSTOMER_PRIVACY_REQUEST } from '../lifecycles';
import { USER_ACCOUNT, SESSION } from '@aipowersalon/identity';
import { SERVICE_CATEGORY } from '@aipowersalon/catalog';
import { isUuidId } from '@aipowersalon/observability';

export interface PlatformListQuery { status?: string; kind?: string; search?: string; tenantId?: string; page?: number; pageSize?: number; }
export interface NoteInput { text: string; by?: string }

const PAGE = 25;
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

// Server-side PII masking — Customer Data Oversight returns masked phone/email by default; a full reveal is a
// separate, audited support action. (§35/§36/§37)
const maskPhoneRaw = (p?: string | null): string => { if (!p) return '—'; const d = String(p).replace(/\D/g, ''); return d.length < 4 ? '•••' : `•••${d.slice(-4)}`; };
const maskEmailRaw = (e?: string | null): string => { if (!e) return '—'; const at = String(e).indexOf('@'); return at <= 0 ? '•••' : `${e[0]}•••${e.slice(at)}`; };

// Pure grouping of duplicate-candidate rows into review cases (§25). A case is the set of customers in one tenant
// sharing a normalized phone (exact) or email (high). Kept framework-free + masked so it is fully unit-testable.
export function groupCustomerDuplicates(rows: any[]): any[] {
  const map = new Map<string, any>();
  for (const r of rows) {
    const k = `${r.kind}|${r.tenant_id}|${r.key}`;
    let c = map.get(k);
    if (!c) {
      c = { id: k, kind: r.kind, keyMasked: r.kind === 'email' ? maskEmailRaw(r.key) : maskPhoneRaw(r.key), confidence: r.kind === 'phone' ? 'exact' : 'high', tenantId: r.tenant_id, tenantName: r.tenant_name || null, members: [] };
      map.set(k, c);
    }
    c.members.push({ id: r.id, name: r.full_name || '—', phone: maskPhoneRaw(r.phone_display), email: maskEmailRaw(r.email), branch: r.branch_name || '—', status: r.status, createdAt: r.created_at });
  }
  return [...map.values()].filter((c) => c.members.length > 1);
}

// Builds the four-slice role distribution (Admin / Manager / Staff / Other) for the Users & Roles dashboard from
// pre-counted role-group totals. "Other" is whatever administrative users remain after the three named groups, never
// negative. Pure; the counts themselves come from a single grouped SQL pass.
export function usersRoleDistribution(k: { totalUsers: number; admins: number; managers: number; staff: number }): any[] {
  const other = Math.max(0, (k.totalUsers || 0) - (k.admins || 0) - (k.managers || 0) - (k.staff || 0));
  return [
    { label: 'Admin', count: k.admins || 0 }, { label: 'Manager', count: k.managers || 0 },
    { label: 'Staff', count: k.staff || 0 }, { label: 'Other', count: other },
  ];
}

// ── Users & Roles reference modules — pure helpers (no I/O), so they're unit-testable and reused by the repo.
// The system role enum is fixed (rbac.ts): SUPER_ADMIN, OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN, CUSTOMER.
// The reference image's richer taxonomy (Finance/Support/Security Admin, Senior Technician, Read-only Auditor, custom
// roles) and its "28 roles" figure are NOT modelled — we report the REAL distinct roles in use rather than a fixture.

/** Documented role → permission-level mapping used by the directory + the Permissions Overview bars.
 *  Full Access = platform/tenant owners (OWNER, SUPER_ADMIN); Branch Admin = MANAGER; Limited Access = TECHNICIAN;
 *  Basic Access = front-of-house (RECEPTION, FRONT_DESK). CUSTOMER accounts are excluded from admin surfaces. */
export function permissionLevelFor(role: string): 'Full Access' | 'Branch Admin' | 'Limited Access' | 'Basic Access' | null {
  switch (role) {
    case 'OWNER': case 'SUPER_ADMIN': return 'Full Access';
    case 'MANAGER': return 'Branch Admin';
    case 'TECHNICIAN': return 'Limited Access';
    case 'RECEPTION': case 'FRONT_DESK': return 'Basic Access';
    default: return null; // CUSTOMER / unknown → not an admin permission level
  }
}

/** Collapse per-role counts into the four fixed permission levels (fixed order), with percentages of the admin total. */
export function permissionLevelDistribution(roleCounts: { role: string; count: number }[]): { level: string; count: number; pct: number }[] {
  const order = ['Full Access', 'Branch Admin', 'Limited Access', 'Basic Access'] as const;
  const acc: Record<string, number> = { 'Full Access': 0, 'Branch Admin': 0, 'Limited Access': 0, 'Basic Access': 0 };
  for (const r of roleCounts) { const lvl = permissionLevelFor(r.role); if (lvl) acc[lvl] += Number(r.count || 0); }
  const total = order.reduce((s, l) => s + acc[l], 0);
  return order.map((level) => ({ level, count: acc[level], pct: total ? Math.round((acc[level] / total) * 1000) / 10 : 0 }));
}

/** The reference's 10 KPI cards, derived from real counts. `openAccessRequests` has no schema source (no
 *  access-requests table) so it is returned as null → the UI renders it as "—/NotConnected", never a fabricated number. */
export function usersKpiCards(k: {
  totalUsers: number; activeUsers: number; distinctRoles: number; pendingInvites: number; suspended: number;
  branchManagers: number; technicians: number; receptionists: number; ownersAdmins: number; openAccessRequests: number;
}): { key: string; label: string; value: number | null; available: boolean }[] {
  return [
    { key: 'totalUsers', label: 'Total Users', value: k.totalUsers, available: true },
    { key: 'activeUsers', label: 'Active Users', value: k.activeUsers, available: true },
    { key: 'totalRoles', label: 'Total Roles', value: k.distinctRoles, available: true },
    { key: 'pendingInvites', label: 'Pending Invites', value: k.pendingInvites, available: true },
    { key: 'suspended', label: 'Suspended Users', value: k.suspended, available: true },
    { key: 'branchManagers', label: 'Branch Managers', value: k.branchManagers, available: true },
    { key: 'technicians', label: 'Technicians', value: k.technicians, available: true },
    { key: 'receptionists', label: 'Receptionists', value: k.receptionists, available: true },
    { key: 'ownersAdmins', label: 'Owners / Admins', value: k.ownersAdmins, available: true },
    { key: 'openAccessRequests', label: 'Open Access Requests', value: k.openAccessRequests, available: true }, // now backed by access_requests
  ];
}

/** Role Health & Alerts rows. Counts that have a real source are populated; those needing a process/feed that isn't
 *  modelled (over-permissioned review, access-requests) are marked unavailable rather than fabricated. */
export function usersRoleHealth(k: {
  inactive30d: number; expiredInvitations: number; suspended: number; accessRequestsPending: number;
}): { key: string; label: string; count: number | null; severity: 'info' | 'warn' | 'critical'; available: boolean; to: string }[] {
  return [
    { key: 'inactive30d', label: 'Inactive Users (30+ days)', count: k.inactive30d, severity: 'warn', available: true, to: '/users-roles?status=inactive' },
    { key: 'expiredInvitations', label: 'Expired Invitations', count: k.expiredInvitations, severity: 'warn', available: true, to: '/users-roles?status=invited' },
    { key: 'overPermissioned', label: 'Over-Permissioned Users', count: null, severity: 'critical', available: false, to: '/users-roles' }, // needs an access-review process (honest gap)
    { key: 'suspended', label: 'Suspended Users', count: k.suspended, severity: 'critical', available: true, to: '/users-roles?status=suspended' },
    { key: 'accessRequestsPending', label: 'Access Requests Pending', count: k.accessRequestsPending, severity: 'info', available: true, to: '/users-roles' }, // now backed by access_requests
  ];
}

// Ranks per-service performance rows by revenue (desc), tie-broken by bookings; pure, used for the
// "Top Services by Revenue" surface. Does not mutate the input array.
/** Group raw branch statuses into the three dashboard buckets (documented): Active → active; Maintenance →
 *  maintenance + temporarily_closed; Inactive → paused, suspended, inactive, closed, and any other non-active status.
 *  Returns the bucket counts plus the raw per-status breakdown so the detail view keeps full fidelity. */
export function branchStatusGrouping(rows: { status: string | null; count: number }[]): { active: number; maintenance: number; inactive: number; total: number; raw: { status: string; count: number }[] } {
  const MAINT = new Set(['maintenance', 'temporarily_closed', 'temp_closed']);
  let active = 0, maintenance = 0, inactive = 0, total = 0;
  const raw: { status: string; count: number }[] = [];
  for (const r of rows || []) {
    const s = String(r.status || 'unknown').toLowerCase();
    const c = Number(r.count || 0);
    total += c;
    raw.push({ status: s, count: c });
    if (s === 'active') active += c;
    else if (MAINT.has(s)) maintenance += c;
    else inactive += c;
  }
  return { active, maintenance, inactive, total, raw };
}

export function topServicesByRevenue(perf: { name: string; bookings: number; revenueCents: number }[], n = 5): any[] {
  return [...perf].sort((a, b) => b.revenueCents - a.revenueCents || b.bookings - a.bookings).slice(0, n);
}

// Groups raw category rows by normalized name; a group used by more than one tenant is a cross-tenant duplicate —
// a candidate for a shared global category standard. Read-only review aid; performs no mutation.
export function groupCategoryDuplicates(rows: any[]): any[] {
  const map = new Map<string, any>();
  for (const r of rows) {
    const norm = String(r.norm || '').trim();
    if (!norm) continue;
    let c = map.get(norm);
    if (!c) { c = { id: norm, normalizedName: norm, displayName: r.name || norm, tenantCount: 0, totalProducts: 0, members: [] }; map.set(norm, c); }
    c.members.push({ tenantName: r.tenant || '—', name: r.name || norm, products: Number(r.products || 0) });
    c.totalProducts += Number(r.products || 0);
  }
  for (const c of map.values()) c.tenantCount = new Set(c.members.map((m: any) => m.tenantName)).size;
  return [...map.values()].filter((c) => c.tenantCount > 1).sort((a, b) => b.tenantCount - a.tenantCount);
}

export interface SuperAdminPlatformRepo {
  applications(q: PlatformListQuery): Promise<{ rows: any[]; total: number }>;
  getApplication(id: string): Promise<any | null>;
  /** Raw rows for the intake metrics block (bounded projection — no notes/EIN/PII beyond grouping fields). */
  applicationMetricsRows(): Promise<Array<{ status: string; source: string | null; state: string | null; card_volume_band: string | null; current_pos: string | null; current_processor: string | null; assigned_to_user_id: string | null; duplicate_risk_score: number | null; follow_up_at: Date | string | null; created_at: Date | string; approved_at: Date | string | null }>>;
  createApplication(input: Record<string, unknown>): Promise<any>;
  findApplicationByIdempotencyKey(key: string): Promise<any | null>;
  /** Candidate rows for duplicate scoring: same email (ci), same EIN last-4, or same salon name (ci). Excludes archived. */
  applicationDuplicateCandidates(probe: { email: string | null; einLast4: string | null; salonName: string | null }): Promise<any[]>;
  countRecentApplicationsFromIp(ip: string, sinceHours: number): Promise<number>;
  activeTenantEmailExists(email: string): Promise<boolean>;
  updateApplication(id: string, patch: Record<string, unknown>): Promise<any | null>;
  appendApplicationNote(id: string, note: NoteInput): Promise<any | null>;
  leads(q: PlatformListQuery): Promise<{ rows: any[]; total: number }>;
  createLead(input: Record<string, unknown>): Promise<any>;
  updateLead(id: string, patch: Record<string, unknown>): Promise<any | null>;
  hardware(q: PlatformListQuery): Promise<{ rows: any[]; total: number }>;
  createHardware(input: Record<string, unknown>): Promise<any>;
  updateHardware(id: string, patch: Record<string, unknown>): Promise<any | null>;
  startSupportSession(input: { scope?: string; tenantId: string; adminUserId: string; adminEmail?: string; reason: string; minutes: number }): Promise<any>;
  endSupportSession(id: string, byUserId?: string): Promise<any | null>;
  /** Constitution 7 §75 — THIS admin's live Support Mode sessions, from both session stores (for the banner). */
  /** Constitution 7 §78 — extend THIS admin's own live session (either store): decide under a row lock, apply, notify the owner. */
  extendSupportSession?(id: string, byUserId: string, minutes: number, reason: string): Promise<{ ok: true; tenantId: string; source: string; expiresAt: string; extensionCount: number } | { ok: false; error: string; notFound?: boolean }>;
  mySupportSessions?(userId: string): Promise<Array<{ id: string; source: 'support_access' | 'view_pos'; tenantId: string; tenantName: string | null; reason: string; scope: string; startedAt: string; expiresAt: string }>>;
  supportSessions(activeOnly: boolean): Promise<any[]>;
  counts(): Promise<{ newApplications: number; newLeads: number; hardwarePending: number; activeSupportSessions: number }>;
  auditLogs(q: AuditQuery): Promise<{ rows: any[]; total: number }>;
  paymentGateways(): Promise<any[]>;
  paymentGatewaysState(): Promise<{ gateways: RawGatewayRow[]; events: RawEventRow[]; chargebacksTracked: boolean }>;
  aiPackages(): Promise<any[]>;
  setAiPackage(tenantId: string, pkg: string): Promise<void>;
  setAiFeature(tenantId: string, featureKey: string, enabled: boolean | null): Promise<void>;
  usageLimits(): Promise<any[]>;
  setUsageLimit(tenantId: string, metric: string, limitValue: number): Promise<void>;
  users(q: UsersQuery): Promise<{ rows: any[]; total: number }>;
  usersDashboard(q: UsersQuery): Promise<{ kpis: any; kpiCards: any[]; rolesDistribution: any[]; roleHealth: any[]; permissions: any; permissionLevels: any[]; branchAllocation: any; branchAccess: any; topTenants: any; pendingInvitations: any; growth: any[]; growthDaily: any; recentActivity: any[]; accessAlerts: any[]; mfaAdoptionPct: any; securityScore: any; avgLoginTime: any }>;
  branchesDashboard(scope?: OverviewScope): Promise<{ kpis: any; statusDistribution: any; directory: any[]; recentActivity: any[]; healthDistribution: any; operationalAlerts: any[]; deviceStatus: any; performanceTrend: any; topBranches: any[]; revenueByCity: any[]; queueByBranch: any[]; upcomingByBranch: any[]; onboardingPipeline: any; hoursAvailability: any; atAGlance: any; capacity: any; healthScore: any }>;
  branchesDirectory(q: Record<string, unknown>, scope?: OverviewScope): Promise<{ rows: any[]; total: number; page: number; pageSize: number; pages: number; facets: { statuses: string[]; tenants: string[]; cities: string[] } }>;
  branchesExport(q: Record<string, unknown>, scope?: OverviewScope): Promise<BranchDirRow[]>;
  createBranch(v: NormalizedBranch): Promise<{ ok: true; branch: { id: string; name: string; status: string; tenantId: string; city: string | null; state: string | null } } | { ok: false; code: 'invalid' | 'not_found'; message: string }>;
  assignableManagers(branchId: string): Promise<{ branchTenantId: string; managers: { id: string; name: string; email: string | null; role: string; currentBranchId: string | null }[] } | null>;
  assignBranchManager(branchId: string, v: AssignManagerValue): Promise<{ ok: true; branch: { id: string; name: string }; manager: { id: string; name: string; email: string | null }; movedFromBranchId: string | null } | { ok: false; code: 'invalid' | 'not_found'; message: string }>;
  transferOptions(branchId: string): Promise<{ branch: { id: string; name: string; currentTenantId: string; currentTenantName: string | null }; destinations: { id: string; name: string; status: string }[] } | null>;
  transferPreflight(branchId: string, destTenantId: string): Promise<{ ok: true; branch: { id: string; name: string }; destination: { id: string; name: string; status: string }; impact: { staff: number | null; appointments: number | null; serviceRecords: number | null; supportTickets: number | null; queueItems: number | null }; blockers: string[] } | { ok: false; code: 'invalid' | 'not_found'; message: string }>;
  createTransferRequest(branchId: string, v: TransferRequestValue, actorId: string | null): Promise<{ ok: true; request: { id: string; status: string; toTenantId: string } } | { ok: false; code: 'invalid' | 'not_found'; message: string }>;
  getBranchHours(branchId: string): Promise<{ branch: { id: string; name: string }; days: { dayOfWeek: number; label: string; isClosed: boolean; opensAt: string | null; closesAt: string | null; set: boolean }[] } | null>;
  setBranchHours(branchId: string, days: DayHoursValue[]): Promise<{ ok: true; count: number } | { ok: false; code: 'invalid' | 'not_found'; message: string }>;
  branchDevices(branchId: string): Promise<{ branch: { id: string; name: string }; tenantId: string; devices: { id: string; category: string; deviceType: string; name: string; status: string; currentBranchId: string | null; currentBranchName: string | null; onThisBranch: boolean; allocatable: boolean }[] } | null>;
  allocateDevice(branchId: string, v: AllocateDeviceValue): Promise<{ ok: true; device: { id: string; name: string }; movedFromBranchId: string | null } | { ok: false; code: 'invalid' | 'not_found'; message: string }>;
  getBranchForStatus(id: string): Promise<{ id: string; name: string; status: string } | null>;
  applyBranchStatus(id: string, from: string, to: string): Promise<{ id: string; name: string; status: string } | null>;
  bulkApplyStatus(ids: string[], to: string): Promise<{ id: string; name: string; ok: boolean; message: string }[]>;
  platformServices(q: ServicesQuery): Promise<{ rows: any[]; total: number; kpis: any; byCategory: any[]; byStatus: any[]; catalogHealth: any; monthly: any[]; topServices: any[]; lowServices: any[]; recentActivity: any[]; packages: any[]; pricing: any; healthPct: any; topByRevenue: any[]; staffAvailability: any[] }>;
  platformProducts(q: ProductsQuery): Promise<{ rows: any[]; total: number; kpis: any; byCategory: any[]; stockHealth: any; lowStockList: any[]; topProducts: any[]; suppliers: any[]; recentActivity: any[]; monthly: any[]; byBranch: any[]; movement: any[]; dataQualityPct: any }>;
  platformCategories(q: CategoriesQuery): Promise<{ rows: any[]; total: number; kpis: any; duplicates: any[] }>;
  platformBrands(q: CategoriesQuery): Promise<{ rows: any[]; total: number; kpis: any; duplicates: any[] }>;
  platformSuppliers(q: CategoriesQuery): Promise<{ rows: any[]; total: number; kpis: any; duplicates: any[] }>;
  platformServiceCategories(q: CategoriesQuery): Promise<{ rows: any[]; total: number; kpis: any; duplicates: any[] }>;
  tenantServiceCategories(tenantId: string): Promise<{ tenantName: string | null; categories: any[] }>;
  platformAppointments(q: AppointmentsQuery): Promise<{ rows: any[]; total: number; kpis: any; byStatus: any[]; bySource: any[]; byTechnician: any[]; trend: any[]; byBranch: any[]; topServices: any[]; byHour: any[]; byDay: any[]; oversight: any; walkInQueue: any[]; recentActivity: any[] }>;
  platformPayments(q: PaymentsQuery): Promise<{ rows: any[]; total: number; kpis: any; byMethod: any[]; byProcessor: any[]; byStatus: any[]; byBranch: any[]; byHour: any[]; terminals: any[]; recentActivity: any[]; monthly: any[] }>;
  paymentsTransactions(q: PaymentsTxnQuery): Promise<{ total: number; rows: any[]; kpiRaw: any; byMethod: any[]; trend: any[]; failed: any[]; processors: any[] }>;
  paymentTransactionDetail(id: string): Promise<any | null>;
  paymentAuthorizationHistory(id: string): Promise<{ events: any[] } | null>;
  platformCustomers(q: CustomersQuery): Promise<{ rows: any[]; total: number; kpis: any; segmentation: any[]; byBranch: any[]; growth: any[]; topSpending: any[]; retention: any; csat: any; loyalty: any; recentActivity: any[]; signups: any[]; feedback: any[]; oversight: any }>;
  customerDuplicates(q: CustomersQuery): Promise<{ cases: any[]; total: number }>;
  mergeCustomers(input: { tenantId: string; sourceCustomerId: string; targetCustomerId: string; byUserId?: string }): Promise<{ mergeLogId: string | null; sourceArchived: boolean; snapshot: any } | null>;
  mergeServiceCategories(input: { tenantId: string; sourceCategoryId: string; targetCategoryId: string; byUserId?: string }): Promise<{ mergeLogId: string | null; reattributedServiceCount: number; snapshot: any } | null>;
  mergeProductCategories(input: { tenantId: string; sourceCategoryId: string; targetCategoryId: string; byUserId?: string }): Promise<{ mergeLogId: string | null; reattributedProductCount: number; snapshot: any } | null>;
  tenantProductCategories(tenantId: string): Promise<{ tenantName: string | null; categories: any[] }>;
  privacyRequests(q: { status?: string; page?: number; pageSize?: number }): Promise<{ rows: any[]; total: number; kpis: any }>;
  createPrivacyRequest(input: { tenantId: string; customerId?: string; requestType: string; requesterName?: string; requesterContact?: string; scope?: string; legalBasis?: string; dueAt: Date; byUserId?: string }): Promise<any | null>;
  setPrivacyRequestStatus(input: { id: string; status: string; note?: string; byUserId?: string }): Promise<any | null>;
  platformReportExports(q: ReportExportsQuery): Promise<{ rows: any[]; total: number; kpis: any; byReportType: any[]; byFormat: any[]; byMonth: any[]; recentActivity: any[] }>;
  platformReminders(q: RemindersQuery): Promise<{ rows: any[]; total: number; kpis: any; byChannel: any[]; byStatus: any[]; settingsByChannel: any[]; byDay: any[] }>;
  platformAutomations(q: AutomationsQuery): Promise<{ rows: any[]; total: number; kpis: any; byType: any[]; runsByStatus: any[] }>;
  platformIntegrations(q: IntegrationsQuery): Promise<{ rows: any[]; total: number; kpis: any; catalog: any[]; byProcessor: any[] }>;
  platformDevices(q: DevicesQuery): Promise<{ rows: any[]; total: number; kpis: any; byCategory: any[]; byStatus: any[] }>;
  platformSecurity(q: SecurityQuery): Promise<{ rows: any[]; total: number; kpis: any; bySeverity: any[]; loginSplit: any[]; optOutsByChannel: any[] }>;
  userById(id: string): Promise<any | null>;
  emailExists(email: string): Promise<boolean>;
  /** Tenant-scoped: login resolves an identifier WITHIN a store, so a phone only has to be unique per tenant. */
  phoneExists(tenantId: string | null, normalizedPhone: string): Promise<boolean>;
  setUserStatus(id: string, status: string): Promise<boolean>;
  setUserRole(id: string, role: string): Promise<{ before: string } | null>;
  /** The user's role and salon, read BEFORE a role change is validated (Oct 6 2026). */
  userForRoleChange?(id: string): Promise<{ role: string; tenantId: string | null } | null>;
  /** How many OTHER active owners the salon has — a salon must keep at least one. */
  otherActiveOwnerCount?(tenantId: string, excludeUserId: string): Promise<number>;
  setUserMfaRequired(id: string, required: boolean): Promise<{ before: boolean } | null>;
  userActiveSessions(userId: string): Promise<any[]>;
  revokeSession(sessionId: string): Promise<{ userId: string } | null>;
  revokeAllUserSessions(userId: string): Promise<{ count: number }>;
  resetUserPassword(id: string): Promise<{ temporaryPassword: string; email: string } | null>;
  createSuperAdmin(input: { email: string; fullName: string }): Promise<{ id: string; temporaryPassword: string }>;
  inviteUser(input: { email?: string | null; phone?: string | null; fullName: string; role: string; tenantId?: string | null; branchId?: string | null }): Promise<{ id: string; temporaryPassword: string }>;
  createInvitation(input: { platformRole?: string | null; tenantId?: string | null; branchId?: string | null; email?: string | null; phone?: string | null; role: string; fullName?: string | null; invitedByUserId?: string | null; channel?: string }): Promise<{ id: string; userId: string | null; token: string | null; tokenPrefix: string; expiresAt: any; reused: boolean }>;
  listInvitations(q: { status?: string; tenantId?: string; page?: number; pageSize?: number }): Promise<{ rows: any[]; total: number }>;
  setInvitationDelivery(id: string, deliveryStatus: string, error?: string | null): Promise<void>;
  resendInvitation(id: string): Promise<{ id: string; token: string; tokenPrefix: string; expiresAt: any; email: string; phone: string | null; channel: string } | null>;
  cancelInvitation(id: string): Promise<{ id: string; status: string } | null>;
  acceptInvitation(input: { token: string; password: string; fullName?: string }): Promise<{ ok: true; userId: string; email: string; role: string; tenantId: string | null } | { ok: false; reason: string }>;
  _invitationStatus(id: string): Promise<string | null>;
  createAccessRequest(input: { tenantId?: string | null; requestingUserId: string; currentRole?: string | null; requestedRole: string; requestedBranchIds?: string[]; reason: string; requestedDurationDays?: number | null }): Promise<{ id: string; status: string; highRisk: boolean }>;
  pendingAccessRequestsCount(tenantId?: string): Promise<number>;
  listAccessRequests(q: { status?: string; tenantId?: string; requestingUserId?: string; page?: number; pageSize?: number }): Promise<{ rows: any[]; total: number }>;
  expireStaleAccessRequests(): Promise<void>;
  _accessRequest(id: string): Promise<{ status: string; requestedRole: string; requestingUserId: string; expiresAt: any } | null>;
  decideAccessRequest(input: { id: string; approverUserId: string; approverRole: string; action: RequestAction; notes?: string; durationDays?: number | null; confirmHighRisk?: boolean }): Promise<{ ok: true; status: string; requestingUserId: string; requestedRole: string; expiresAt?: string | null } | { ok: false; reason: string }>;
  cancelAccessRequest(id: string): Promise<{ id: string; status: string } | null>;
  createScheduledReport(input: { name: string; reportKey: string; filters: any; cadence: string; recipientEmail?: string | null; format?: string; createdByUserId?: string | null; nextRunAt: Date }): Promise<{ id: string }>;
  listScheduledReports(): Promise<{ rows: any[]; total: number }>;
  setScheduledReportEnabled(id: string, enabled: boolean): Promise<boolean>;
  deleteScheduledReport(id: string): Promise<boolean>;
  dueScheduledReports(now: Date): Promise<any[]>;
  recordScheduledReportRun(id: string, status: string, ranAt: Date, nextRunAt: Date): Promise<void>;
  _scheduledReport(id: string): Promise<{ lastStatus: string | null; nextRunAt: any; enabled: boolean } | null>;
  assignUserBranch(input: { tenantId: string; userId: string; branchId: string; accessLevel: string; byUserId?: string }): Promise<{ ok: boolean; tenantId: string; userId: string; branchId: string; accessLevel: string } | null>;
  revokeUserBranch(input: { tenantId: string; userId: string; branchId: string }): Promise<{ removed: number }>;
  tenantUsersAndBranches(tenantId: string): Promise<{ tenantName: string | null; users: any[]; branches: any[] }>;
  reports(): Promise<any>;
  tenantPerformanceRows(cap?: number): Promise<any[]>;
}

export interface UsersQuery { role?: string; search?: string; page?: number; pageSize?: number; tenantId?: string; branchId?: string; status?: string; }
export interface ServicesQuery { category?: string; status?: string; search?: string; page?: number; pageSize?: number; tenantId?: string }
export interface ProductsQuery { category?: string; status?: string; search?: string; lowStock?: boolean; page?: number; pageSize?: number; }
export interface CategoriesQuery { search?: string; page?: number; pageSize?: number; }
export interface AppointmentsQuery { status?: string; source?: string; search?: string; date?: string; page?: number; pageSize?: number; tenantId?: string }
export interface CustomersQuery { status?: string; search?: string; page?: number; pageSize?: number; }
export interface PaymentsQuery { status?: string; method?: string; processor?: string; search?: string; page?: number; pageSize?: number; tenantId?: string }
export interface PaymentsTxnQuery { search?: string; tenantId?: string; branchId?: string; method?: string; status?: string; refundStatus?: string; settlementStatus?: string; customerId?: string; deviceId?: string; merchantAccount?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number; sort?: string; direction?: string }
export interface ReportExportsQuery { reportKey?: string; format?: string; search?: string; page?: number; pageSize?: number; }
export interface RemindersQuery { channel?: string; status?: string; search?: string; page?: number; pageSize?: number; }
export interface AutomationsQuery { status?: string; search?: string; page?: number; pageSize?: number; }
export interface IntegrationsQuery { processor?: string; status?: string; search?: string; page?: number; pageSize?: number; }
export interface DevicesQuery { category?: string; status?: string; search?: string; page?: number; pageSize?: number; tenantId?: string }
export interface SecurityQuery { severity?: string; search?: string; page?: number; pageSize?: number; }

// H9: the temporary password handed to every newly onboarded owner/staff account — was 8 Math.random() characters.
function tempPassword(): string { return secureTempPassword(); }

export interface AuditQuery { tenantId?: string; userId?: string; action?: string; entityType?: string; from?: string; to?: string; page?: number; pageSize?: number; }

export class KyselySuperAdminPlatformRepo implements SuperAdminPlatformRepo {
  constructor(private readonly db: Kysely<DB>) {}

  private async list(table: string, q: PlatformListQuery, searchCols: string[], kindCol?: string) {
    let qb: any = this.db.selectFrom(table as any);
    if (q.status) qb = qb.where('status', '=', q.status);
    if (q.kind && kindCol) qb = qb.where(kindCol as any, '=', q.kind);
    if (q.tenantId) qb = qb.where('tenant_id' as any, '=', q.tenantId as any);
    if (q.search) qb = qb.where((eb: any) => eb.or(searchCols.map((c) => eb(c, 'ilike', like(q.search!)))));
    const total = Number((await qb.select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || PAGE);
    const rows = await qb.clearSelect().selectAll().orderBy('created_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    return { rows, total };
  }

  applications(q: PlatformListQuery) { return this.list('tenant_applications', q, ['salon_name', 'owner_name', 'email', 'phone', 'city', 'state']); }
  async countRecentApplicationsFromIp(ip: string, sinceHours: number) {
    const since = new Date(Date.now() - sinceHours * 3_600_000);
    const r: any = await this.db.selectFrom('tenant_applications' as any)
      .select(sql`count(*)::int`.as('c') as any)
      .where('ip_address' as any, '=', ip).where('created_at' as any, '>=', since as any)
      .executeTakeFirst().catch(() => ({ c: 0 }));
    return Number(r?.c || 0);
  }
  async activeTenantEmailExists(email: string) {
    const r: any = await this.db.selectFrom('tenants' as any).select('id')
      .where(sql`lower(email)` as any, '=', email.toLowerCase())
      .executeTakeFirst().catch(() => undefined);
    return !!r;
  }
  async applicationMetricsRows() {
    return (await this.db.selectFrom('tenant_applications' as any)
      .select(['status', 'source', 'state', 'card_volume_band', 'current_pos', 'current_processor', 'assigned_to_user_id', 'duplicate_risk_score', 'follow_up_at', 'created_at', 'approved_at'] as any)
      .limit(10_000)
      .execute().catch(() => [] as any[])) as any[];
  }
  async getApplication(id: string) {
    return (await this.db.selectFrom('tenant_applications' as any).selectAll().where('id', '=', id as any).executeTakeFirst().catch(() => undefined)) ?? null;
  }
  async createApplication(input: Record<string, unknown>) {
    return this.db.insertInto('tenant_applications' as any).values({ id: sql`gen_random_uuid()`, ...input } as any).returningAll().executeTakeFirst();
  }
  async findApplicationByIdempotencyKey(key: string) {
    return (await this.db.selectFrom('tenant_applications' as any).selectAll().where('idempotency_key' as any, '=', key).executeTakeFirst().catch(() => undefined)) ?? null;
  }
  async applicationDuplicateCandidates(probe: { email: string | null; einLast4: string | null; salonName: string | null }) {
    let q = this.db.selectFrom('tenant_applications' as any).selectAll().where('archived_at' as any, 'is', null).limit(50);
    const ors: any[] = [];
    if (probe.email) ors.push(sql`lower(email) = ${probe.email.toLowerCase()}`);
    if (probe.einLast4) ors.push(sql`ein_last4 = ${probe.einLast4}`);
    if (probe.salonName) ors.push(sql`lower(salon_name) = ${probe.salonName.toLowerCase()}`);
    if (!ors.length) return [];
    q = q.where(sql`(${sql.join(ors, sql` OR `)})` as any);
    return await q.execute().catch(() => [] as any[]);
  }
  async updateApplication(id: string, patch: Record<string, unknown>) {
    // No `.catch`: a missing row is `undefined` → null, but a database refusal (a CHECK, a bad column) must surface —
    // swallowing it reported a constraint violation as "Application not found" (wave 4 PILOT, Oct 13 2026).
    return (await this.db.updateTable('tenant_applications' as any).set({ ...patch, updated_at: new Date() as any } as any).where('id', '=', id as any).returningAll().executeTakeFirst()) ?? null;
  }
  async appendApplicationNote(id: string, note: NoteInput) {
    return (await this.db.updateTable('tenant_applications' as any)
      .set({ notes: sql`notes || ${JSON.stringify([{ ...note, at: new Date().toISOString() }])}::jsonb`, updated_at: new Date() as any } as any)
      .where('id', '=', id as any).returningAll().executeTakeFirst().catch(() => undefined)) ?? null;
  }

  leads(q: PlatformListQuery) { return this.list('website_leads', q, ['name', 'salon_name', 'email', 'phone', 'city', 'state'], 'kind'); }
  async createLead(input: Record<string, unknown>) {
    return this.db.insertInto('website_leads' as any).values({ id: sql`gen_random_uuid()`, ...input } as any).returningAll().executeTakeFirst();
  }
  async updateLead(id: string, patch: Record<string, unknown>) {
    return (await this.db.updateTable('website_leads' as any).set({ ...patch, updated_at: new Date() as any } as any).where('id', '=', id as any).returningAll().executeTakeFirst().catch(() => undefined)) ?? null;
  }

  hardware(q: PlatformListQuery) { return this.list('hardware_packages', q, ['imac_color', 'imac_serial']); }
  async createHardware(input: Record<string, unknown>) {
    return this.db.insertInto('hardware_packages' as any).values({ id: sql`gen_random_uuid()`, ...input } as any).returningAll().executeTakeFirst();
  }
  async updateHardware(id: string, patch: Record<string, unknown>) {
    return (await this.db.updateTable('hardware_packages' as any).set({ ...patch, updated_at: new Date() as any } as any).where('id', '=', id as any).returningAll().executeTakeFirst().catch(() => undefined)) ?? null;
  }

  async startSupportSession(i: { scope?: string; tenantId: string; adminUserId: string; adminEmail?: string; reason: string; minutes: number }) {
    // Constitution 7 §84: the session and the owner's notice are one transaction — no session without its notice
    return this.db.transaction().execute(async (trx) => {
      const row: any = await trx.insertInto('support_access_sessions' as any).values({
        id: sql`gen_random_uuid()`, tenant_id: i.tenantId, admin_user_id: i.adminUserId, admin_email: i.adminEmail || null,
        reason: i.reason, scope: i.scope ?? 'READ_ONLY', expires_at: sql`now() + (${i.minutes} || ' minutes')::interval`,
      } as any).returningAll().executeTakeFirst();
      await writeSupportAccessNotice(trx, { tenantId: i.tenantId, sessionId: String(row.id), reason: i.reason, scope: String(row.scope ?? 'READ_ONLY'), expiresAt: row.expires_at });
      return row;
    });
  }
  async endSupportSession(id: string, byUserId?: string) {
    const a = (await this.db.updateTable('support_access_sessions' as any).set({ ended_at: new Date() as any } as any)
      .where('id', '=', id as any).where('ended_at', 'is', null).returningAll().executeTakeFirst().catch(() => undefined)) ?? null;
    // Phase 10 (migration 541): the legacy View POS store was merged into support_access_sessions — one store, one end.
    return a;
  }
  async extendSupportSession(id: string, byUserId: string, minutes: number, reason: string) {
    return this.db.transaction().execute(async (trx) => {
      // the admin's OWN session, locked so two extensions cannot race past the limit (one store since migration 541)
      const a: any = (await sql<any>`select 'support_access' as source, tenant_id, started_at, expires_at, ended_at, extension_count from support_access_sessions
                                      where id = ${id} and admin_user_id = ${byUserId} for update`.execute(trx)).rows[0];
      if (!a) return { ok: false as const, error: 'No support session of yours with that id.', notFound: true };
      const d = decideExtension({ startedAt: new Date(a.started_at), expiresAt: new Date(a.expires_at), endedAt: a.ended_at ? new Date(a.ended_at) : null, extensionCount: Number(a.extension_count) }, minutes, reason, new Date());
      if (!d.ok) return { ok: false as const, error: d.error };
      // The cap is enforced by the UPDATE itself, not only by the check above: it applies only while the row still has the
      // count and expiry that were read, so two callers racing the same session cannot both extend (found by the
      // control-plane load test: 25 parallel extensions all succeeded when the rule lived only in the read-then-write).
      const upd: any = await sql`update support_access_sessions set expires_at = expires_at + (${Math.round(minutes)} * interval '1 minute'), extension_count = extension_count + 1
                     where id = ${id} and ended_at is null and extension_count = ${Number(a.extension_count)} and extension_count < ${MAX_EXTENSIONS}
                       and expires_at + (${Math.round(minutes)} * interval '1 minute') - started_at <= (${MAX_TOTAL_MINUTES} * interval '1 minute') returning expires_at`.execute(trx);
      if (!upd.rows?.length) return { ok: false as const, error: 'The session changed while extending (another extension won). Refresh and try again.' };
      await writeSupportExtensionNotice(trx, { tenantId: String(a.tenant_id), sessionId: id, reason: reason.trim(), expiresAt: d.newExpiresAt });
      return { ok: true as const, tenantId: String(a.tenant_id), source: String(a.source), expiresAt: d.newExpiresAt.toISOString(), extensionCount: Number(a.extension_count) + 1 };
    });
  }
  async mySupportSessions(userId: string) {
    const r = await sql<any>`
      select s.id, 'support_access' as source, s.tenant_id, t.display_name, s.reason, s.scope, s.started_at, s.expires_at
        from support_access_sessions s left join tenants t on t.id = s.tenant_id
       where s.admin_user_id = ${userId} and s.ended_at is null and s.expires_at > now()
       order by s.expires_at`.execute(this.db);
    return r.rows.map((x: any) => ({ id: String(x.id), source: x.source, tenantId: String(x.tenant_id), tenantName: x.display_name ?? null,
      reason: String(x.reason), scope: String(x.scope), startedAt: new Date(x.started_at).toISOString(), expiresAt: new Date(x.expires_at).toISOString() }));
  }
  async supportSessions(activeOnly: boolean) {
    let qb: any = this.db.selectFrom('support_access_sessions' as any).selectAll().orderBy('started_at', 'desc').limit(100);
    if (activeOnly) qb = qb.where('ended_at', 'is', null).where('expires_at', '>', sql`now()`);
    return qb.execute().catch(() => []);
  }

  async auditLogs(q: AuditQuery) {
    let qb: any = this.db.selectFrom('audit_logs' as any);
    if (q.tenantId) qb = qb.where('tenant_id', '=', q.tenantId);
    if (q.userId) qb = qb.where('user_id', '=', q.userId);
    if (q.action) qb = qb.where('action_type', 'ilike', like(q.action));
    if (q.entityType) qb = qb.where('entity_type', '=', q.entityType);
    if (q.from) qb = qb.where('created_at', '>=', new Date(q.from));
    if (q.to) qb = qb.where('created_at', '<=', new Date(q.to));
    const total = Number((await qb.select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rows = await qb.clearSelect().selectAll().orderBy('created_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    return { rows, total };
  }

  /** Platform-wide gateway health: one row per tenant with masked MID, env/status, terminal count, last payment. */
  async paymentGateways() {
    const rows: any[] = await (this.db as any).selectFrom('tenants')
      .leftJoin('tenant_payment_config as c', 'c.tenant_id', 'tenants.id')
      .select([
        'tenants.id as tenant_id', 'tenants.display_name', 'tenants.tenant_code', 'tenants.status as tenant_status',
        'c.processor', 'c.merchant_id', 'c.environment', 'c.status as gateway_status', 'c.bolt_base_url',
      ])
      .execute().catch(() => []);
    const terms: any[] = await (this.db as any).selectFrom('pos_payment_terminals')
      .select(['tenant_id', sql`count(*)`.as('n')]).where('status', '=', 'paired').groupBy('tenant_id').execute().catch(() => []);
    const lastPays: any[] = await (this.db as any).selectFrom('payments')
      .select(['tenant_id', sql`max(created_at)`.as('last')]).groupBy('tenant_id').execute().catch(() => []);
    const tmap = new Map(terms.map((t) => [String(t.tenant_id), Number(t.n)]));
    const pmap = new Map(lastPays.map((p) => [String(p.tenant_id), p.last]));
    const mask = (mid?: string | null) => (mid ? '••••' + String(mid).slice(-4) : null);
    return rows.map((r) => ({
      tenantId: r.tenant_id, tenantName: r.display_name, tenantCode: r.tenant_code, tenantStatus: r.tenant_status,
      processor: r.processor || null, merchantIdMasked: mask(r.merchant_id), environment: r.environment || null,
      gatewayStatus: r.gateway_status || 'not_configured', boltConfigured: !!r.bolt_base_url,
      pairedTerminals: tmap.get(String(r.tenant_id)) || 0,
      lastPaymentAt: pmap.get(String(r.tenant_id)) || null,
    }));
  }

  // Enriched per-tenant gateway rows + recent gateway events for the Super Admin command center. Joins the REAL
  // tables; secrets are never selected (only encrypted-column presence as booleans). The raw MID is selected but is
  // masked downstream in payment-gateways-core before anything is returned to the API.
  async paymentGatewaysState(): Promise<{ gateways: RawGatewayRow[]; events: RawEventRow[]; chargebacksTracked: boolean }> {
    const db = this.db as any;
    const base: any[] = await db.selectFrom('tenants')
      .leftJoin('tenant_payment_config as c', 'c.tenant_id', 'tenants.id')
      .leftJoin('users as o', 'o.id', 'tenants.owner_user_id')
      .select([
        'tenants.id as tenant_id', 'tenants.display_name', 'tenants.tenant_code', 'tenants.status as tenant_status',
        'o.full_name as owner_name',
        'c.processor', 'c.merchant_id', 'c.environment', 'c.status as gateway_status', 'c.base_url', 'c.onboarding_status',
        'c.api_username_enc', 'c.api_password_enc', 'c.webhook_secret_enc', 'c.fiserv_configured', 'c.updated_at as config_updated_at',
      ]).execute().catch(() => []);
    const terms: any[] = await db.selectFrom('pos_payment_terminals')
      .select(['tenant_id', sql`count(*)`.as('n')]).where('status', '=', 'paired').groupBy('tenant_id').execute().catch(() => []);
    const branchRows: any[] = await db.selectFrom('branches')
      .select(['id', 'tenant_id', 'name', 'city', 'state', 'status', sql`row_number() over (partition by tenant_id order by created_at)`.as('rn')])
      .execute().catch(() => []);
    const lastPays: any[] = await db.selectFrom('payments')
      .select(['tenant_id', sql`max(created_at)`.as('last')]).groupBy('tenant_id').execute().catch(() => []);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const settAgg: any[] = await db.selectFrom('payment_settlements')
      .select(['tenant_id', sql`coalesce(sum(gross_cents),0)`.as('vol'), sql`count(*) filter (where status = 'failed')`.as('failed')])
      .where('settled_at', '>=', monthStart).groupBy('tenant_id').execute().catch(() => []);
    const settLatest: any[] = await db.selectFrom('payment_settlements')
      .select(['tenant_id', 'status', sql`row_number() over (partition by tenant_id order by created_at desc)`.as('rn')])
      .execute().catch(() => []);
    // Today's processed volume — intraday, from approved payments since the start of the (server-local) day. Settlements
    // batch/lag so they read ~0 intraday; approved payments are the live "what did this salon process today" signal, and
    // match how platform reports compute volume. Distinct basis from the settled MTD figure, labelled as such in the UI.
    const todayAgg: any[] = await db.selectFrom('payments')
      .select(['tenant_id', sql`coalesce(sum(amount_cents),0)`.as('vol'), sql`count(*)`.as('cnt')])
      .where('status', '=', 'approved').where('created_at', '>=', sql`date_trunc('day', now())`)
      .groupBy('tenant_id').execute().catch(() => []);
    // Open chargeback alerts per tenant. If the chargebacks table is missing (migration not yet applied), tracked=false
    // so the KPI honestly renders "not tracked yet" rather than a misleading 0.
    let chargebacksTracked = true;
    const cbAgg: any[] = await db.selectFrom('chargebacks')
      .select(['tenant_id', sql`count(*) filter (where status in ('open','needs_response','under_review'))`.as('alerts')])
      .groupBy('tenant_id').execute().catch(() => { chargebacksTracked = false; return []; });
    const events: any[] = await db.selectFrom('payment_gateway_events as e')
      .leftJoin('tenants as t', 't.id', 'e.tenant_id')
      .select(['e.id', 't.display_name as tenant_name', 'e.processor_type', 'e.event_type', 'e.signature_valid', 'e.processed_at', 'e.created_at'])
      .orderBy('e.created_at', 'desc').limit(20).execute().catch(() => []);

    const tmap = new Map(terms.map((t) => [String(t.tenant_id), Number(t.n)]));
    const pmap = new Map(lastPays.map((p) => [String(p.tenant_id), p.last]));
    const vmap = new Map(settAgg.map((s) => [String(s.tenant_id), { vol: Number(s.vol), failed: Number(s.failed) }]));
    const bmap = new Map<string, any>(); for (const b of branchRows) if (Number(b.rn) === 1) bmap.set(String(b.tenant_id), b);
    // Full branch footprint per tenant (creation order): the table shows the primary branch + a "+N" indicator, the detail
    // panel lists them all. The gateway itself is tenant-scoped (tenant_payment_config PK = tenant_id), so every branch
    // shares the one gateway — this is location context, not a per-branch gateway.
    const blist = new Map<string, Array<{ id: string; name: string; city: string | null; state: string | null; status: string | null }>>();
    for (const b of branchRows) {
      const k = String(b.tenant_id); const arr = blist.get(k) || []; arr.push({ id: b.id, name: b.name, city: b.city ?? null, state: b.state ?? null, status: b.status ?? null }); blist.set(k, arr);
    }
    const slmap = new Map<string, string>(); for (const s of settLatest) if (Number(s.rn) === 1) slmap.set(String(s.tenant_id), s.status);
    const cbmap = new Map(cbAgg.map((c) => [String(c.tenant_id), Number(c.alerts)]));
    const todmap = new Map(todayAgg.map((s) => [String(s.tenant_id), { vol: Number(s.vol), cnt: Number(s.cnt) }]));
    const iso = (d: any) => (d ? new Date(d).toISOString() : null);

    const gateways: RawGatewayRow[] = base.map((r) => {
      const b = bmap.get(String(r.tenant_id));
      const v = vmap.get(String(r.tenant_id)) || { vol: 0, failed: 0 };
      const branches = blist.get(String(r.tenant_id)) || [];
      return {
        tenantId: r.tenant_id, tenantName: r.display_name, salonCode: r.tenant_code ?? null, tenantStatus: r.tenant_status,
        ownerName: r.owner_name ?? null, city: b?.city ?? null, state: b?.state ?? null,
        branchCount: branches.length, branches: branches.slice(0, 12),
        processor: r.processor ?? null, merchantId: r.merchant_id ?? null, environment: r.environment ?? null,
        status: r.gateway_status ?? null, baseUrlPresent: !!r.base_url,
        onboardingStatus: r.onboarding_status ?? null,
        credsPresent: !!(r.api_username_enc || r.api_password_enc || r.webhook_secret_enc), fiservConfigured: !!r.fiserv_configured,
        pairedTerminals: tmap.get(String(r.tenant_id)) || 0,
        settlementStatusRaw: slmap.get(String(r.tenant_id)) ?? null,
        monthlyVolumeCents: v.vol, failedSettlements: v.failed,
        todayVolumeCents: todmap.get(String(r.tenant_id))?.vol || 0,
        todayTxnCount: todmap.get(String(r.tenant_id))?.cnt || 0,
        chargebackAlerts: cbmap.get(String(r.tenant_id)) || 0,
        lastSyncAt: iso(r.config_updated_at) || iso(pmap.get(String(r.tenant_id))),
        lastPaymentAt: iso(pmap.get(String(r.tenant_id))),
      };
    });
    const evViews: RawEventRow[] = events.map((e) => ({
      id: e.id, tenantName: e.tenant_name ?? null, processorType: e.processor_type ?? null, eventType: e.event_type ?? null,
      signatureValid: !!e.signature_valid, processedAt: iso(e.processed_at), createdAt: iso(e.created_at) as string,
    }));
    return { gateways, events: evViews, chargebacksTracked };
  }

  /** One row per tenant: latest AI package (canonical: newest tenant_ai_packages row) + the ai_calls limit/usage. */
  async aiPackages() {
    const rows: any[] = await (this.db as any).selectFrom('tenants')
      .select(['tenants.id as tenant_id', 'tenants.display_name', 'tenants.tenant_code', 'tenants.status'])
      .execute().catch(() => []);
    const pkgs: any[] = await (this.db as any).selectFrom('tenant_ai_packages')
      .select(['tenant_id', 'package', 'created_at']).orderBy('created_at', 'desc').execute().catch(() => []);
    const latest = new Map<string, string>();
    for (const r of pkgs) if (!latest.has(String(r.tenant_id))) latest.set(String(r.tenant_id), String(r.package));
    const lims: any[] = await (this.db as any).selectFrom('tenant_usage_limits')
      .select(['tenant_id', 'metric', 'limit_value', 'used_value']).where('metric', '=', 'ai_calls').execute().catch(() => []);
    const lmap = new Map(lims.map((l) => [String(l.tenant_id), l]));
    const featRows: any[] = await (this.db as any).selectFrom('tenant_ai_features')
      .select(['tenant_id', 'feature_key', 'enabled']).execute().catch(() => []);
    const fmap = new Map<string, Map<string, boolean>>();
    for (const f of featRows) {
      const k = String(f.tenant_id);
      if (!fmap.has(k)) fmap.set(k, new Map());
      fmap.get(k)!.set(String(f.feature_key), !!f.enabled);
    }
    return rows.map((t) => {
      const l: any = lmap.get(String(t.tenant_id));
      const pkg = latest.get(String(t.tenant_id)) || 'None';
      const overrides = fmap.get(String(t.tenant_id)) ?? new Map<string, boolean>();
      return {
        tenantId: t.tenant_id, tenantName: t.display_name, tenantCode: t.tenant_code, tenantStatus: t.status,
        package: pkg,
        aiCallsLimit: l ? Number(l.limit_value) : null, aiCallsUsed: l ? Number(l.used_value) : null,
        featureOverrides: Object.fromEntries(overrides),
        effectiveFeatures: effectiveAiFeatures(pkg, overrides),
      };
    });
  }
  /** Append-only, matching how tenant creation seeds packages: the newest row IS the current package. */
  async setAiPackage(tenantId: string, pkg: string) {
    await this.db.insertInto('tenant_ai_packages' as any).values({ id: sql`gen_random_uuid()`, tenant_id: tenantId, package: pkg } as any).execute();
  }
  /** Explicit override upsert; null reverts to inherit (delete the row). */
  async setAiFeature(tenantId: string, featureKey: string, enabled: boolean | null) {
    if (enabled === null) {
      await (this.db as any).deleteFrom('tenant_ai_features').where('tenant_id', '=', tenantId).where('feature_key', '=', featureKey).execute();
      return;
    }
    await (this.db as any).insertInto('tenant_ai_features')
      .values({ tenant_id: tenantId, feature_key: featureKey, enabled })
      .onConflict((oc: any) => oc.columns(['tenant_id', 'feature_key']).doUpdateSet({ enabled, updated_at: new Date() }))
      .execute();
  }

  /** Tenant x metric rows from the canonical tenant_usage_limits counters. */
  async usageLimits() {
    const tenants: any[] = await (this.db as any).selectFrom('tenants')
      .select(['tenants.id as tenant_id', 'tenants.display_name', 'tenants.tenant_code']).execute().catch(() => []);
    const lims: any[] = await (this.db as any).selectFrom('tenant_usage_limits')
      .select(['tenant_id', 'metric', 'limit_value', 'used_value']).execute().catch(() => []);
    const by = new Map<string, any[]>();
    for (const l of lims) { const k = String(l.tenant_id); if (!by.has(k)) by.set(k, []); by.get(k)!.push({ metric: l.metric, limitValue: Number(l.limit_value), usedValue: Number(l.used_value) }); }
    return tenants.map((t) => ({ tenantId: t.tenant_id, tenantName: t.display_name, tenantCode: t.tenant_code, metrics: by.get(String(t.tenant_id)) || [] }));
  }
  async setUsageLimit(tenantId: string, metric: string, limitValue: number) {
    await (this.db as any).insertInto('tenant_usage_limits')
      .values({ tenant_id: tenantId, metric, limit_value: limitValue, used_value: 0 })
      .onConflict((oc: any) => oc.columns(['tenant_id', 'metric']).doUpdateSet({ limit_value: limitValue }))
      .execute();
  }

  async users(q: UsersQuery) {
    let qb: any = (this.db as any).selectFrom('users')
      .leftJoin('tenants as t', 't.id', 'users.tenant_id')
      .leftJoin('branches as b', 'b.id', 'users.branch_id')
      .leftJoin('technicians as tech', 'tech.user_id', 'users.id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`users.id`)
        ]))
      );
    if (q.role) qb = qb.where('users.role', '=', q.role);
    else qb = qb.where('users.role', '<>', 'CUSTOMER'); // platform users screen excludes salon end-customers unless explicitly filtered (reconciles with KPI Total Users)
    if (q.status) qb = qb.where('users.status', '=', q.status);
    if (q.tenantId) qb = qb.where('users.tenant_id', '=', q.tenantId);
    if (q.branchId) qb = qb.where('users.branch_id', '=', q.branchId);
    if (q.search) qb = qb.where((eb: any) => eb.or([eb('users.email', 'ilike', like(q.search!)), eb('users.full_name', 'ilike', like(q.search!)), eb('users.normalized_phone', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!)), eb('b.name', 'ilike', like(q.search!))]));
    const total = Number((await qb.select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rows: any[] = await qb.clearSelect().select([
      'users.id', 'users.full_name', 'users.email', 'users.role', 'users.status', 'users.mfa_enabled', 'users.last_login_at',
      'users.tenant_id', 't.display_name as tenant_name', 'users.branch_id', 'b.name as branch_name', 'users.created_at',
      'users.avatar_url as user_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'tech.avatar_url as tech_avatar_url',
      // Assigned-devices = distinct devices seen on this user's login sessions (real; from the sessions table). No
      // separate per-user device-assignment model exists, so this is "devices seen", documented and never fabricated.
      (this.db as any).fn.count('s.device_id').distinct().as('device_count'),
    ])
      .leftJoin('sessions as s', (jb: any) => jb.onRef('s.user_id', '=', 'users.id'))
      .groupBy(['users.id', 't.display_name', 'b.name', 'users.avatar_url', 'gtp.avatar_url', 'tech.avatar_url'])
      .orderBy('users.created_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    return {
      rows: rows.map((r) => {
        const rawPhoto = r.user_avatar_url || r.gtp_avatar_url || r.tech_avatar_url || null;
        return {
          id: r.id, fullName: r.full_name || '', email: r.email || '', role: r.role, status: r.status,
          avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : null,
          mfaEnabled: !!r.mfa_enabled, lastLoginAt: r.last_login_at || null,
          tenantId: r.tenant_id || null, tenantName: r.tenant_name || (r.tenant_id ? null : 'Platform'),
          branchId: r.branch_id || null, branchName: r.branch_name || null,
          assignedDevices: Number(r.device_count || 0), permissionLevel: permissionLevelFor(r.role),
        };
      }),
      total,
    };
  }

  // Users & Roles dashboard rollups (§11–23) from the real auth schema. Customer app accounts (role CUSTOMER) are
  // excluded from administrative totals. Several reference modules have no schema source yet — access alerts (no
  // security-events table), avg login time (no session table) and a composite security score — those are returned as
  // honest gaps (empty / null) rather than fabricated. Permission categories are derived from the permission KEY prefix.
  async usersDashboard(_q: UsersQuery) {
    const k: any = await sql`
      select
        count(*) filter (where role <> 'CUSTOMER')::int as total_users,
        count(*) filter (where role <> 'CUSTOMER' and status = 'active')::int as active_users,
        count(*) filter (where role in ('SUPER_ADMIN','OWNER'))::int as admins,
        count(*) filter (where role = 'MANAGER')::int as managers,
        count(*) filter (where role in ('FRONT_DESK','RECEPTION','TECHNICIAN'))::int as staff,
        count(*) filter (where role = 'TECHNICIAN')::int as technicians,
        count(*) filter (where role in ('RECEPTION','FRONT_DESK'))::int as receptionists,
        count(distinct role) filter (where role <> 'CUSTOMER')::int as distinct_roles,
        count(*) filter (where status = 'invited')::int as pending_invites,
        count(*) filter (where status = 'invited' and temp_password_expires_at is not null and temp_password_expires_at < now())::int as expired_invitations,
        count(*) filter (where status = 'suspended')::int as suspended,
        count(*) filter (where role <> 'CUSTOMER' and status = 'active' and last_login_at is not null and last_login_at < now() - interval '30 days')::int as inactive_30d,
        count(*) filter (where status in ('inactive','suspended'))::int as deactivated,
        count(*) filter (where role <> 'CUSTOMER' and mfa_enabled)::int as mfa_on
      from users
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const totalUsers = Number(k?.total_users || 0);
    const admins = Number(k?.admins || 0), managers = Number(k?.managers || 0), staff = Number(k?.staff || 0);
    // permission categories from the permission key prefix (real keys, derived grouping)
    const permRows: any[] = await sql`select split_part(key, '.', 1) as category, count(*)::int as n from permissions group by split_part(key, '.', 1) order by n desc`.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const permTotal = permRows.reduce((s, r) => s + Number(r.n || 0), 0);
    // branch allocation from explicit user-branch assignments (real); center total = distinct assigned users
    const branchRows: any[] = await sql`
      select b.name as branch, count(*)::int as assignments, count(distinct uba.user_id)::int as users
      from user_branch_access uba left join branches b on b.id = uba.branch_id
      group by b.name order by assignments desc limit 8
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const branchAssignTotal = branchRows.reduce((s, r) => s + Number(r.assignments || 0), 0);
    // new administrative accounts per month, last 6 months (real)
    const growthRows: any[] = await sql`
      select to_char(date_trunc('month', created_at), 'Mon') as month, count(*)::int as n
      from users where role <> 'CUSTOMER' and created_at >= date_trunc('month', current_date) - interval '5 months'
      group by date_trunc('month', created_at) order by date_trunc('month', created_at)
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    // recent user/authz activity from audit_logs (real), actor name resolved via users
    const actRows: any[] = await sql`
      select a.action_type, a.entity_type, a.created_at, a.role as actor_role, u.full_name as actor_name
      from audit_logs a left join users u on u.id = a.user_id
      order by a.created_at desc limit 6
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);

    // ── Reference modules (all real schema; honest nulls where a source is missing) ──
    // Per-role counts → permission-level distribution (documented role→level mapping).
    const roleCountRows: any[] = await sql`select role, count(*)::int as n from users where role <> 'CUSTOMER' group by role`
      .execute(this.db).then((r: any) => r.rows).catch(() => []);
    const permissionLevels = permissionLevelDistribution(roleCountRows.map((r) => ({ role: r.role, count: Number(r.n || 0) })));
    // Top tenants by (admin/staff) user count.
    const topTenantRows: any[] = await sql`
      select t.id, t.display_name, count(u.*)::int as users
      from tenants t join users u on u.tenant_id = t.id and u.role <> 'CUSTOMER'
      group by t.id, t.display_name order by users desc limit 5
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const tenantsUserTotal = topTenantRows.reduce((s, r) => s + Number(r.users || 0), 0);
    // Branch access coverage: access-level mix from explicit assignments + branches with no active admin.
    const branchAccessRows: any[] = await sql`select coalesce(access_level,'unspecified') as level, count(*)::int as n from user_branch_access group by access_level`
      .execute(this.db).then((r: any) => r.rows).catch(() => []);
    const branchTotalRow: any = await sql`select count(*)::int as n from branches`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const noAdminRow: any = await sql`
      select count(*)::int as n from branches b
      where not exists (select 1 from users u where u.branch_id = b.id and u.status = 'active' and u.role in ('OWNER','MANAGER'))
        and not exists (select 1 from user_branch_access uba where uba.branch_id = b.id and uba.access_level in ('owner','manager'))
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    // Pending invitations grouped by tenant/branch (real; invited-status accounts).
    const pendingInviteRows: any[] = await sql`
      select coalesce(t.display_name,'Platform') as tenant, b.name as branch, count(*)::int as n, max(u.created_at) as last_at
      from users u left join tenants t on t.id = u.tenant_id left join branches b on b.id = u.branch_id
      where u.status = 'invited' group by t.display_name, b.name order by max(u.created_at) desc limit 8
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    // Daily growth series, last 30 days (real): new admin/staff accounts created, and accounts active (logged in) that day.
    const growthDailyRows: any[] = await sql`
      with days as (select generate_series(date_trunc('day', current_date) - interval '29 days', date_trunc('day', current_date), interval '1 day')::date as d)
      select to_char(d.d,'Mon DD') as label, d.d as day,
        (select count(*)::int from users u where u.role <> 'CUSTOMER' and u.created_at::date = d.d) as new_users,
        (select count(*)::int from users u where u.role <> 'CUSTOMER' and u.last_login_at::date = d.d) as active_users
      from days d order by d.d
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const newUsersThisMonth = Number((await sql`select count(*)::int as n from users where role <> 'CUSTOMER' and created_at >= date_trunc('month', current_date)`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 })))?.n || 0);
    const accessRequestsPending = await this.pendingAccessRequestsCount();

    return {
      kpis: {
        totalUsers, activeUsers: Number(k?.active_users || 0), admins, managers, staff,
        pendingInvites: Number(k?.pending_invites || 0), deactivated: Number(k?.deactivated || 0),
      },
      kpiCards: usersKpiCards({
        totalUsers, activeUsers: Number(k?.active_users || 0), distinctRoles: Number(k?.distinct_roles || 0),
        pendingInvites: Number(k?.pending_invites || 0), suspended: Number(k?.suspended || 0),
        branchManagers: managers, technicians: Number(k?.technicians || 0), receptionists: Number(k?.receptionists || 0),
        ownersAdmins: admins, openAccessRequests: accessRequestsPending,
      }),
      roleHealth: usersRoleHealth({ inactive30d: Number(k?.inactive_30d || 0), expiredInvitations: Number(k?.expired_invitations || 0), suspended: Number(k?.suspended || 0), accessRequestsPending }),
      rolesDistribution: usersRoleDistribution({ totalUsers, admins, managers, staff }),
      permissionLevels,
      permissions: { total: permTotal, byCategory: permRows.map((r) => ({ category: r.category || 'other', count: Number(r.n || 0), pct: permTotal ? Math.round((Number(r.n || 0) / permTotal) * 1000) / 10 : 0 })) },
      branchAllocation: { totalAssignments: branchAssignTotal, rows: branchRows.map((r) => ({ branch: r.branch || '—', assignments: Number(r.assignments || 0), users: Number(r.users || 0), pct: branchAssignTotal ? Math.round((Number(r.assignments || 0) / branchAssignTotal) * 1000) / 10 : 0 })) },
      branchAccess: {
        totalBranches: Number(branchTotalRow?.n || 0),
        branchesWithoutAdmin: Number(noAdminRow?.n || 0),
        byLevel: (() => { const tot = branchAccessRows.reduce((s, r) => s + Number(r.n || 0), 0); return branchAccessRows.map((r) => ({ level: r.level, count: Number(r.n || 0), pct: tot ? Math.round((Number(r.n || 0) / tot) * 1000) / 10 : 0 })); })(),
      },
      topTenants: { totalUsers: tenantsUserTotal, rows: topTenantRows.map((r) => ({ tenantId: String(r.id), tenantName: r.display_name || '—', users: Number(r.users || 0) })) },
      pendingInvitations: { total: Number(k?.pending_invites || 0), rows: pendingInviteRows.map((r) => ({ tenant: r.tenant || '—', branch: r.branch || null, count: Number(r.n || 0), lastInvitedAt: r.last_at || null })) },
      growth: growthRows.map((r) => ({ month: r.month, count: Number(r.n || 0) })),
      growthDaily: { series: growthDailyRows.map((r) => ({ label: r.label, newUsers: Number(r.new_users || 0), activeUsers: Number(r.active_users || 0) })), newUsersThisMonth },
      recentActivity: actRows.map((r) => ({ action: r.action_type, entityType: r.entity_type || null, actorName: r.actor_name || null, actorRole: r.actor_role || null, at: r.created_at })),
      accessAlerts: [] as any[], // honest gap — no security-events table in schema (§22)
      mfaAdoptionPct: totalUsers ? Math.round((Number(k?.mfa_on || 0) / totalUsers) * 1000) / 10 : null,
      securityScore: null, // honest gap — a composite score needs a documented multi-control formula (§29)
      avgLoginTime: null, // honest gap — no login-session table (§29)
    };
  }

  /** Branch oversight aggregate (Branches Management dashboard). Real schema only: branches, users (staff/manager),
   *  appointments (today), ticket_service_lines (MTD revenue). Computed with a handful of grouped queries stitched in
   *  JS (no N+1). Honest gaps: capacity/utilization model, branch health score and a performance trend series are not
   *  modelled, so they return null rather than fabricated numbers. Today's count uses the server date — branch-local
   *  timezones aren't modelled here, which is noted to the caller. Read-only, platform-wide. */
  async branchesDashboard(scope?: OverviewScope) {
    const raw = (q: any) => q.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const [branches, statusRows, staffRows, apptRows, revRows, mgrRows, tenants, newRow, activity] = await Promise.all([
      raw(sql`select id, tenant_id, name, address, city, state, zip, phone, status, latitude, longitude, created_at from branches where ${tenantPred(scope)} order by name asc`),
      raw(sql`select status, count(*)::int as count from branches where ${tenantPred(scope)} group by status`),
      raw(sql`select branch_id, count(*)::int as count from users where role <> 'CUSTOMER' and status = 'active' and branch_id is not null group by branch_id`),
      raw(sql`select branch_id, count(*)::int as count from pos_tech_appointments where appt_date = current_date group by branch_id`),
      raw(sql`select branch_id, coalesce(sum(line_total_cents),0)::bigint as cents from ticket_service_lines where created_at >= date_trunc('month', now()) group by branch_id`),
      raw(sql`select distinct on (branch_id) branch_id, full_name, role from users where role in ('OWNER','MANAGER') and branch_id is not null order by branch_id, case role when 'OWNER' then 0 else 1 end`),
      raw(sql`select id, display_name from tenants`),
      raw(sql`select count(*)::int as count from branches where created_at >= date_trunc('month', now()) ${andTenant(scope)}`),
      raw(sql`select a.action_type, a.entity_id, a.created_at, a.role, u.full_name as actor from audit_logs a left join users u on u.id = a.user_id where a.entity_type = 'branch' order by a.created_at desc limit 8`),
    ]);
    // ---- Additional real sources for the full Branches oversight dashboard (all from live tables) ----
    // Per-branch operational signals + the platform-level distributions the reference renders. Device totals and
    // city/onboarding distributions stay platform-wide by design (like the other platform sections), and any factor
    // the schema can't source per-branch (device-per-branch, per-branch revenue-trend baseline) is left as an honest
    // gap rather than fabricated — see the operationalAlerts inputs and the health signals below.
    const ACTIVE_QUEUE = sql`('waiting','called','assigned','ready_for_tech','moved_to_tech_queue','in_service')`;
    const OPEN_TICKETS = sql`('submitted','open','assigned','waiting_support','waiting_customer')`;
    const [ticketsByBranch, queueRows, upcomingRows, cityRows, hoursRows, openTodayRow, monthRev, monthAppt, deviceRollup, payCfgRows, todayRevRow, checkinRow, openTktRow, techRow] = await Promise.all([
      raw(sql`select coalesce(affected_branch_id, branch_id) as bid, count(*)::int as count from support_tickets where status in ${OPEN_TICKETS} and coalesce(affected_branch_id, branch_id) is not null group by 1`),
      raw(sql`select branch_id, count(*)::int as count from pos_queue_items where status in ${ACTIVE_QUEUE} and branch_id is not null group by branch_id`),
      raw(sql`select branch_id, count(*)::int as count from pos_tech_appointments where appt_date >= current_date and appt_date < current_date + interval '14 days' and status not in ('cancelled','no_show','completed','rejected') and branch_id is not null group by branch_id`),
      raw(sql`select coalesce(b.city,'—') as city, coalesce(b.state,'') as state, coalesce(sum(tsl.line_total_cents),0)::bigint as cents from ticket_service_lines tsl join branches b on b.id = tsl.branch_id where tsl.created_at >= date_trunc('month', now()) group by b.city, b.state order by cents desc limit 8`),
      raw(sql`select location_id, count(*) filter (where not is_closed)::int as open_days from tenant_location_hours group by location_id`),
      raw(sql`select count(distinct location_id)::int as count from tenant_location_hours where day_of_week = extract(dow from now())::int and not is_closed`),
      raw(sql`select to_char(date_trunc('month', created_at),'Mon') as m, date_trunc('month', created_at) as k, coalesce(sum(line_total_cents),0)::bigint as cents from ticket_service_lines where created_at >= date_trunc('month', now()) - interval '5 months' group by k order by k`),
      raw(sql`select to_char(date_trunc('month', appt_date),'Mon') as m, date_trunc('month', appt_date) as k, count(*)::int as count from pos_tech_appointments where appt_date >= (date_trunc('month', now()) - interval '5 months')::date group by k order by k`),
      raw(sql`select status from (
        select lower(status) as status from pos_payment_terminals
        union all select lower(pairing_status) from customer_display_devices
        union all select lower(status) from go_checkin_devices
        union all select lower(status) from hardware_package_devices
      ) d`),
      raw(sql`select distinct tenant_id from tenant_payment_config where fiserv_configured = true or lower(status) in ('active','live','configured')`),
      raw(sql`select coalesce(sum(line_total_cents),0)::bigint as cents from ticket_service_lines where created_at >= date_trunc('day', now())`),
      raw(sql`select count(*)::int as count from pos_queue_items where checked_in_at >= date_trunc('day', now())`),
      raw(sql`select count(*)::int as count from support_tickets where status in ${OPEN_TICKETS}`),
      raw(sql`select count(*)::int as count from technicians where status = 'active' ${andTenant(scope)}`),
    ]);

    const num = (m: Map<string, number>, k: string) => Number(m.get(k) || 0);
    const staffBy = new Map<string, number>(staffRows.map((r: any) => [String(r.branch_id), Number(r.count)]));
    const apptBy = new Map<string, number>(apptRows.map((r: any) => [String(r.branch_id), Number(r.count)]));
    const revBy = new Map<string, number>(revRows.map((r: any) => [String(r.branch_id), Number(r.cents)]));
    const mgrBy = new Map<string, string>(mgrRows.map((r: any) => [String(r.branch_id), r.full_name]));
    const tenantBy = new Map<string, string>(tenants.map((r: any) => [String(r.id), r.display_name]));
    const ticketBy = new Map<string, number>(ticketsByBranch.map((r: any) => [String(r.bid), Number(r.count)]));
    const queueBy = new Map<string, number>(queueRows.map((r: any) => [String(r.branch_id), Number(r.count)]));
    const upcomingBy = new Map<string, number>(upcomingRows.map((r: any) => [String(r.branch_id), Number(r.count)]));
    const hoursBy = new Map<string, number>(hoursRows.map((r: any) => [String(r.location_id), Number(r.open_days)]));
    const payTenants = new Set<string>(payCfgRows.map((r: any) => String(r.tenant_id)));

    // Per-branch directory enriched with a real, documented health score (branch-health-core).
    const directory = branches.map((b: any) => {
      const id = String(b.id);
      const sig: BranchHealthSignals = {
        status: b.status || null,
        paymentConfigured: payTenants.has(String(b.tenant_id)),
        deviceOnlineRatio: null, // honest gap — device fleet is not branch-keyed in the schema (excluded, not faked)
        daysSinceLastActivity: null, // honest gap — per-branch last-activity not aggregated here (excluded)
        todaysAppointments: num(apptBy, id),
        revenueMtdCents: num(revBy, id),
        openSupportTickets: num(ticketBy, id),
      };
      return {
        id, name: b.name, tenantId: String(b.tenant_id), tenantName: tenantBy.get(String(b.tenant_id)) || null,
        address: b.address || null, city: b.city || null, state: b.state || null, zip: b.zip || null, phone: b.phone || null,
        latitude: b.latitude != null ? Number(b.latitude) : null, longitude: b.longitude != null ? Number(b.longitude) : null,
        status: b.status || 'unknown',
        manager: mgrBy.get(id) || null, staff: num(staffBy, id),
        todaysAppts: num(apptBy, id), revenueMtdCents: num(revBy, id),
        devices: null, // honest gap — device fleet not branch-keyed (§16 caveat)
        openTickets: num(ticketBy, id), queueWaiting: num(queueBy, id),
        healthScore: branchHealthScore(sig),
      };
    });

    const statusDistribution = branchStatusGrouping(statusRows.map((r: any) => ({ status: r.status, count: Number(r.count) })));
    const totalStaff = directory.reduce((s: number, d: any) => s + d.staff, 0);
    const todaysAppointments = directory.reduce((s: number, d: any) => s + d.todaysAppts, 0);
    const monthlyRevenueCents = directory.reduce((s: number, d: any) => s + d.revenueMtdCents, 0);

    // Health distribution (reconciles: scored + unscored = total branches).
    const healthDistribution = bucketHealthDistribution(directory.map((d: any) => d.healthScore));

    // Device status rollup — mutually-exclusive buckets reconciling to the fleet total (platform-wide, documented).
    const ACTIVEISH = new Set(['paired', 'active', 'online', 'assigned', 'connected']);
    const INACTIVEISH = new Set(['inactive', 'retired', 'disabled', 'deactivated', 'decommissioned']);
    let devOnline = 0, devMaint = 0, devInactive = 0, devOffline = 0;
    for (const r of deviceRollup as any[]) {
      const s = String(r.status || '').toLowerCase();
      if (ACTIVEISH.has(s)) devOnline++;
      else if (s.includes('maintenance')) devMaint++;
      else if (INACTIVEISH.has(s)) devInactive++;
      else devOffline++;
    }
    const totalDevices = devOnline + devMaint + devInactive + devOffline;
    const deviceStatus = { total: totalDevices, online: devOnline, offline: devOffline, maintenance: devMaint, inactive: devInactive };

    // Performance trend — real monthly revenue (cents) + appointment counts, last 6 months, merged by month.
    const apptByMonth = new Map<string, number>((monthAppt as any[]).map((r) => [String(r.m), Number(r.count)]));
    const performanceTrend = (monthRev as any[]).map((r) => ({ month: String(r.m), revenueCents: Number(r.cents), appointments: apptByMonth.get(String(r.m)) || 0 }));

    // Hours availability — class per branch from configured open weekdays; branches with no hours rows = limited (§24).
    let hFull = 0, hPartial = 0, hLimited = 0, availSum = 0;
    for (const b of branches as any[]) {
      const od = hoursBy.get(String(b.id)) ?? 0;
      availSum += od / 7;
      const cls = od === 0 ? 'limited' : hoursAvailabilityClass(od);
      if (cls === 'full') hFull++; else if (cls === 'partial') hPartial++; else hLimited++;
    }
    const hoursAvailability = {
      full: hFull, partial: hPartial, limited: hLimited, total: branches.length,
      avgAvailabilityPct: branches.length ? Math.round((availSum / branches.length) * 100) : 0,
    };

    // Onboarding pipeline — derived from the branch lifecycle (status), mapping pre-operational synonyms to stages.
    // One branch maps to one stage; conversion = progressed-past-review ÷ requests-received (documented funnel).
    const pipe = { received: 0, underReview: 0, siteVerified: 0, setupInProgress: 0, readyToLaunch: 0 };
    const PIPE: Record<string, keyof typeof pipe> = {
      draft: 'received', requested: 'received', opening_requested: 'received', pending: 'received', opening: 'received',
      under_review: 'underReview', review: 'underReview',
      site_verified: 'siteVerified', verified: 'siteVerified',
      setup_in_progress: 'setupInProgress', setup: 'setupInProgress',
      ready_to_launch: 'readyToLaunch', ready: 'readyToLaunch',
    };
    for (const b of branches as any[]) {
      const s = String(b.status || '').toLowerCase().replace(/\s+/g, '_');
      const stage = PIPE[s];
      if (stage) pipe[stage]++;
    }
    const progressed = pipe.siteVerified + pipe.setupInProgress + pipe.readyToLaunch;
    const onboardingPipeline = { ...pipe, conversionRate: pipe.received > 0 ? Math.round((progressed / pipe.received) * 1000) / 10 : 0 };

    // Status counts for KPIs (suspended / pending).
    const rawStatus = new Map<string, number>(statusDistribution.raw.map((r) => [r.status, r.count]));
    const suspendedBranches = num(rawStatus, 'suspended');
    const pendingOpenings = ['pending', 'opening', 'opening_requested', 'draft', 'under_review', 'setup_in_progress', 'ready_to_launch'].reduce((s, k) => s + num(rawStatus, k), 0);

    // Top performing branches by MTD revenue (real).
    const topBranches = [...directory].sort((a: any, b: any) => b.revenueMtdCents - a.revenueMtdCents).slice(0, 5)
      .map((d: any) => ({ id: d.id, name: d.name, tenantName: d.tenantName, revenueMtdCents: d.revenueMtdCents }));

    // Revenue by city (platform-wide MTD distribution).
    const revenueByCity = (cityRows as any[]).map((r) => ({ city: r.city || '—', state: r.state || '', cents: Number(r.cents) }));

    // Queue / upcoming by branch (monitoring lists, top branches by count).
    const labelFor = (id: string) => { const d = directory.find((x: any) => x.id === id); return d ? d.name : id; };
    const queueByBranch = [...queueBy.entries()].map(([id, count]) => ({ branchId: id, name: labelFor(id), count })).sort((a, b) => b.count - a.count).slice(0, 5);
    const upcomingByBranch = [...upcomingBy.entries()].map(([id, count]) => ({ branchId: id, name: labelFor(id), count })).sort((a, b) => b.count - a.count).slice(0, 5);

    // Operational alerts (real inputs; offline-device-branch and revenue-drop counts are honest gaps → omitted by 0).
    const lowHealthBranches = directory.filter((d: any) => d.healthScore != null && d.healthScore < 50).length;
    const zeroApptActive = directory.filter((d: any) => (d.status || '').toLowerCase() === 'active' && d.todaysAppts === 0).length;
    const alerts = operationalAlerts({
      lowHealthBranches, offlineDeviceBranches: 0, pendingOpenings, zeroAppointmentActiveBranches: zeroApptActive, revenueDropBranches: 0,
    });

    const todaysRevenueCents = Number((todayRevRow?.[0]?.cents) || 0);
    const customersCheckedIn = Number((checkinRow?.[0]?.count) || 0);
    const openSupportTickets = Number((openTktRow?.[0]?.count) || 0);
    const totalTechs = Number((techRow?.[0]?.count) || 0);

    return {
      kpis: {
        totalBranches: branches.length,
        activeBranches: statusDistribution.active,
        newThisMonth: Number(newRow?.[0]?.count || 0),
        totalStaff, // each user has a single branch_id, so this is a unique-staff count, not assignments
        todaysAppointments, // server-date based — branch-local timezone not modelled (honest)
        monthlyRevenueCents, // integer cents from ticket_service_lines, MTD
        // ---- additive KPIs for the reference's 10-card grid ----
        suspendedBranches,
        pendingOpenings,
        openTodayBranches: Number((openTodayRow?.[0]?.count) || 0), // branches with today's weekday configured open (branch-local TZ not modelled)
        posDevices: totalDevices,
        customersCheckedIn, // today's check-ins (pos_queue_items)
        todaysRevenueCents, // integer cents, today (ticket_service_lines)
        openSupportTickets,
        totalTechs,
      },
      statusDistribution,
      directory,
      recentActivity: (activity || []).map((a: any) => ({ action: a.action_type, branchId: a.entity_id ? String(a.entity_id) : null, at: a.created_at, actorRole: a.role || null, actorName: a.actor || null })),
      healthDistribution,
      operationalAlerts: alerts,
      deviceStatus,
      performanceTrend, // real monthly revenue + appointments (§17)
      topBranches,
      revenueByCity,
      queueByBranch,
      upcomingByBranch,
      onboardingPipeline,
      hoursAvailability,
      atAGlance: { totalBranches: branches.length, totalTechs, customersToday: customersCheckedIn, apptsToday: todaysAppointments, revenueTodayCents: todaysRevenueCents },
      capacity: null, // honest gap — no per-branch capacity/utilization model in schema (§25 tech-utilization)
      healthScore: null, // legacy field retained for back-compat; real banding is in `healthDistribution`
    };
  }

  // Server-side All Branches Directory (§8/§12/§40): reuses the verified branchesDashboard aggregate (one grouped
  // round-trip, no N+1) and applies pure normalize → filter → sort → paginate so the client receives only the page.
  // Facets (statuses/tenants/cities) are computed from the full scoped set for the directory filter dropdowns.
  async branchesDirectory(q: Record<string, unknown>, scope?: OverviewScope) {
    const nq = normalizeBranchQuery(q);
    const d = await this.branchesDashboard(scope);
    return paginateBranches(d.directory as BranchDirRow[], nq);
  }

  // Full filtered+sorted directory set (no pagination) for the server-side audited export (§44). Reuses the same
  // dashboard aggregate + pure filter/sort as the directory, so the export always matches what the admin is viewing.
  async branchesExport(q: Record<string, unknown>, scope?: OverviewScope): Promise<BranchDirRow[]> {
    const nq = normalizeBranchQuery(q);
    const d = await this.branchesDashboard(scope);
    let rows = sortBranches(filterBranches(d.directory as BranchDirRow[], nq), nq.sort, nq.dir);
    const ids = parseIdList((q as any)?.ids);
    if (ids.length) { const set = new Set(ids); rows = rows.filter((r) => set.has(r.id)); }
    return rows;
  }

  // Controlled Add Branch (§28). Tenant existence + name/address uniqueness + manager-tenant membership are re-checked
  // INSIDE the insert transaction (no TOCTOU), then the branch row is inserted atomically. Returns a discriminated
  // result; the service maps it to a typed error and writes the audit event. Money/secrets are never touched here.
  async createBranch(v: NormalizedBranch): Promise<{ ok: true; branch: { id: string; name: string; status: string; tenantId: string; city: string | null; state: string | null; latitude: number | null; longitude: number | null } } | { ok: false; code: 'invalid' | 'not_found'; message: string }> {
    return this.db.transaction().execute(async (trx) => {
      const tenant = await trx.selectFrom('tenants').select('id').where('id', '=', v.tenantId as any).executeTakeFirst().catch(() => undefined);
      if (!tenant) return { ok: false as const, code: 'not_found' as const, message: 'Parent tenant not found.' };
      const dup = await (trx as any).selectFrom('branches').select('id')
        .where('tenant_id', '=', v.tenantId)
        .where('deleted_at', 'is', null)
        .where((eb: any) => {
          const ors = [eb(sql`lower(name)`, '=', v.name.toLowerCase())];
          if (v.address) ors.push(eb(sql`lower(address)`, '=', v.address.toLowerCase()));
          return eb.or(ors);
        }).executeTakeFirst().catch(() => undefined);
      if (dup) return { ok: false as const, code: 'invalid' as const, message: 'A branch with this name or address already exists for this tenant.' };
      if (v.managerUserId) {
        const mgr = await trx.selectFrom('users').select('id').where('id', '=', v.managerUserId as any).where('tenant_id', '=', v.tenantId as any).executeTakeFirst().catch(() => undefined);
        if (!mgr) return { ok: false as const, code: 'invalid' as const, message: 'Selected manager does not belong to this tenant.' };
      }
      const ins = await (trx as any).insertInto('branches').values({
        tenant_id: v.tenantId, name: v.name, address: v.address, city: v.city, state: v.state, zip: v.zip, phone: v.phone,
        latitude: v.latitude, longitude: v.longitude,
        status: v.status, timezone: v.timezone, manager_name: v.managerName, manager_email: v.managerEmail, manager_phone: v.managerPhone,
        verification_status: v.verificationStatus,
      }).returning(['id', 'name', 'status', 'tenant_id', 'city', 'state', 'latitude', 'longitude']).executeTakeFirstOrThrow();
      return { ok: true as const, branch: { id: String(ins.id), name: ins.name, status: ins.status, tenantId: String(ins.tenant_id), city: ins.city ?? null, state: ins.state ?? null, latitude: ins.latitude != null ? Number(ins.latitude) : null, longitude: ins.longitude != null ? Number(ins.longitude) : null } };
    });
  }

  // Managers assignable to a branch: MANAGER/OWNER users in the branch's tenant who are active (§34). Returns null if
  // the branch doesn't exist so the service can 404.
  async assignableManagers(branchId: string): Promise<{ branchTenantId: string; managers: { id: string; name: string; email: string | null; role: string; currentBranchId: string | null }[] } | null> {
    const branch = await (this.db as any).selectFrom('branches').select(['id', 'tenant_id']).where('id', '=', branchId).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
    if (!branch) return null;
    const users = await (this.db as any).selectFrom('users').select(['id', 'full_name', 'email', 'role', 'branch_id'])
      .where('tenant_id', '=', branch.tenant_id).where('role', 'in', ['MANAGER', 'OWNER']).where('status', '=', 'active')
      .orderBy('full_name', 'asc').execute().catch(() => []);
    return { branchTenantId: String(branch.tenant_id), managers: users.map((u: any) => ({ id: String(u.id), name: u.full_name || '—', email: u.email || null, role: u.role, currentBranchId: u.branch_id ? String(u.branch_id) : null })) };
  }

  // Assign a manager to a branch (§34). Validates tenant membership, role, and active status against the REAL user row
  // inside the transaction, then relinks the user to this branch (a user has one branch_id, so this MOVES a manager who
  // belonged to another branch) and mirrors their name/email/phone onto the branch for display. No data is deleted.
  async assignBranchManager(branchId: string, v: AssignManagerValue): Promise<{ ok: true; branch: { id: string; name: string }; manager: { id: string; name: string; email: string | null }; movedFromBranchId: string | null } | { ok: false; code: 'invalid' | 'not_found'; message: string }> {
    return this.db.transaction().execute(async (trx) => {
      const branch = await (trx as any).selectFrom('branches').select(['id', 'name', 'tenant_id']).where('id', '=', branchId).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
      if (!branch) return { ok: false as const, code: 'not_found' as const, message: 'Branch not found.' };
      const u = await (trx as any).selectFrom('users').select(['id', 'full_name', 'email', 'normalized_phone', 'tenant_id', 'role', 'status', 'branch_id']).where('id', '=', v.managerUserId).executeTakeFirst().catch(() => undefined);
      if (!u) return { ok: false as const, code: 'invalid' as const, message: 'Selected manager was not found.' };
      if (String(u.tenant_id) !== String(branch.tenant_id)) return { ok: false as const, code: 'invalid' as const, message: 'That user belongs to a different tenant than this branch.' };
      if (!['MANAGER', 'OWNER'].includes(u.role)) return { ok: false as const, code: 'invalid' as const, message: 'Selected user is not a manager or owner.' };
      if (u.status !== 'active') return { ok: false as const, code: 'invalid' as const, message: 'Selected manager is not active.' };
      const movedFromBranchId = u.branch_id && String(u.branch_id) !== branchId ? String(u.branch_id) : null;
      await (trx as any).updateTable('users').set({ branch_id: branchId, updated_at: new Date() }).where('id', '=', v.managerUserId).execute();
      await (trx as any).updateTable('branches').set({ manager_name: u.full_name, manager_email: u.email, manager_phone: u.normalized_phone, updated_at: new Date() }).where('id', '=', branchId).execute();
      return { ok: true as const, branch: { id: String(branch.id), name: branch.name }, manager: { id: String(u.id), name: u.full_name || '—', email: u.email || null }, movedFromBranchId };
    });
  }

  // --- Controlled branch transfer (§33): request + preflight only. The actual cross-tenant data move is a separate
  // reviewed job; these methods never reassign tenant_id on historical/financial data. ---

  // Branch + candidate destination tenants (all tenants except the current one). Null if branch missing.
  async transferOptions(branchId: string): Promise<{ branch: { id: string; name: string; currentTenantId: string; currentTenantName: string | null }; destinations: { id: string; name: string; status: string }[] } | null> {
    const branch = await (this.db as any).selectFrom('branches').select(['id', 'name', 'tenant_id']).where('id', '=', branchId).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
    if (!branch) return null;
    const cur = await (this.db as any).selectFrom('tenants').select(['display_name']).where('id', '=', branch.tenant_id).executeTakeFirst().catch(() => undefined);
    const dests = await (this.db as any).selectFrom('tenants').select(['id', 'display_name', 'status']).where('id', '!=', branch.tenant_id).orderBy('display_name', 'asc').execute().catch(() => []);
    return { branch: { id: String(branch.id), name: branch.name, currentTenantId: String(branch.tenant_id), currentTenantName: cur?.display_name ?? null }, destinations: dests.map((d: any) => ({ id: String(d.id), name: d.display_name, status: d.status })) };
  }

  // Real per-branch attachment counts for the impact analysis (branch-keyed tables only; tenant-level domains are
  // documented in branch-transfer-core, not counted here).
  private async branchAttachmentCounts(branchId: string): Promise<{ staff: number | null; appointments: number | null; serviceRecords: number | null; supportTickets: number | null; queueItems: number | null }> {
    // `number | null`, not `number`. This is the impact preview for an IRREVERSIBLE branch transfer, and it used
    // to answer a failed count with `0` — "0 appointments will be affected" — which reads exactly like a fact and
    // is indistinguishable from a branch that genuinely has none.
    //
    // `null` means WE COULD NOT COUNT. The caller turns that into a BLOCKER rather than a number, because the
    // honest response to "we cannot measure the blast radius" is not to proceed with a reassuring zero.
    const one = async (q: any): Promise<number | null> => {
      try {
        const rows: any[] = await q.execute(this.db).then((r: any) => r.rows);
        const n = rows?.[0]?.n;
        return n == null ? null : Number(n);
      } catch {
        return null;
      }
    };
    const [staff, appointments, serviceRecords, supportTickets, queueItems] = await Promise.all([
      one(sql`select count(*)::int as n from users where branch_id = ${branchId} and role <> 'CUSTOMER'`),
      // `pos_tech_appointments`, NOT `appointments` — the latter was DROPPED in migration 041 (superseded).
      //
      // This is the BRANCH TRANSFER impact analysis: "how many appointments will moving this branch affect?"
      // The query threw, `one()` catches to 0, and a Super Admin was therefore told **"0 appointments"** before
      // performing a destructive move that could touch thousands. A fail-soft default is right for a sidebar
      // badge; on the impact preview for an irreversible operation it is a way to authorise the wrong thing with
      // confidence.
      one(sql`select count(*)::int as n from pos_tech_appointments where branch_id = ${branchId}`),
      one(sql`select count(*)::int as n from ticket_service_lines where branch_id = ${branchId}`),
      one(sql`select count(*)::int as n from support_tickets where coalesce(affected_branch_id, branch_id) = ${branchId}`),
      one(sql`select count(*)::int as n from pos_queue_items where branch_id = ${branchId}`),
    ]);
    return { staff, appointments, serviceRecords, supportTickets, queueItems };
  }

  async transferPreflight(branchId: string, destTenantId: string): Promise<{ ok: true; branch: { id: string; name: string }; destination: { id: string; name: string; status: string }; impact: { staff: number | null; appointments: number | null; serviceRecords: number | null; supportTickets: number | null; queueItems: number | null }; blockers: string[] } | { ok: false; code: 'invalid' | 'not_found'; message: string }> {
    const branch = await (this.db as any).selectFrom('branches').select(['id', 'name', 'tenant_id']).where('id', '=', branchId).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
    if (!branch) return { ok: false as const, code: 'not_found' as const, message: 'Branch not found.' };
    if (String(destTenantId) === String(branch.tenant_id)) return { ok: false as const, code: 'invalid' as const, message: 'The destination tenant must be different from the current tenant.' };
    // SW-21: no / a malformed destination id cannot be a tenant — the same 404, without asking PostgreSQL about ''
    if (!isUuidId(destTenantId)) return { ok: false as const, code: 'not_found' as const, message: 'Destination tenant not found.' };
    const dest = await (this.db as any).selectFrom('tenants').select(['id', 'display_name', 'status']).where('id', '=', destTenantId).executeTakeFirst().catch(() => undefined);
    if (!dest) return { ok: false as const, code: 'not_found' as const, message: 'Destination tenant not found.' };
    const impact = await this.branchAttachmentCounts(branchId);
    const blockers: string[] = [];
    if (dest.status !== 'active') blockers.push('Destination tenant is not active.');

    // A count we could not read BLOCKS the transfer. It does not quietly become a zero.
    //
    // This is a one-way door: moving a branch to another tenant reassigns its staff, appointments, tickets and
    // queue. Authorising that on "0 affected" when the truth is "we do not know" is how a Super Admin confidently
    // does something they would never have chosen to do. Refusing costs them a retry; guessing costs a salon.
    const unmeasured = Object.entries(impact).filter(([, v]) => v == null).map(([k]) => k);
    if (unmeasured.length) {
      blockers.push(`Could not measure the impact on: ${unmeasured.join(', ')}. Transfer is blocked until these can be counted.`);
    }
    return { ok: true as const, branch: { id: String(branch.id), name: branch.name }, destination: { id: String(dest.id), name: dest.display_name, status: dest.status }, impact, blockers };
  }

  // Record a transfer REQUEST (status 'requested'). Re-validates destination + typed-confirm name inside the transaction;
  // captures the impact snapshot. Does NOT move any data — execution is a separate reviewed job (§33).
  async createTransferRequest(branchId: string, v: TransferRequestValue, actorId: string | null): Promise<{ ok: true; request: { id: string; status: string; toTenantId: string } } | { ok: false; code: 'invalid' | 'not_found'; message: string }> {
    return this.db.transaction().execute(async (trx) => {
      const branch = await (trx as any).selectFrom('branches').select(['id', 'name', 'tenant_id']).where('id', '=', branchId).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
      if (!branch) return { ok: false as const, code: 'not_found' as const, message: 'Branch not found.' };
      if (String(v.destinationTenantId) === String(branch.tenant_id)) return { ok: false as const, code: 'invalid' as const, message: 'The destination tenant must be different from the current tenant.' };
      if (v.confirmName.trim().toLowerCase() !== String(branch.name).trim().toLowerCase()) return { ok: false as const, code: 'invalid' as const, message: 'The typed branch name does not match.' };
      const dest = await (trx as any).selectFrom('tenants').select(['id', 'status']).where('id', '=', v.destinationTenantId).executeTakeFirst().catch(() => undefined);
      if (!dest) return { ok: false as const, code: 'not_found' as const, message: 'Destination tenant not found.' };
      if (dest.status !== 'active') return { ok: false as const, code: 'invalid' as const, message: 'Destination tenant is not active.' };
      const existing = await (trx as any).selectFrom('branch_transfer_requests').select('id').where('branch_id', '=', branchId).where('status', '=', 'requested').executeTakeFirst().catch(() => undefined);
      if (existing) return { ok: false as const, code: 'invalid' as const, message: 'A transfer request for this branch is already pending review.' };
      const impact = await this.branchAttachmentCounts(branchId);

      // The impact snapshot is the record a REVIEWER later approves the transfer from. A `null` in it must not be
      // serialised into the request and quietly re-read as a zero weeks later by someone who was not here — so the
      // request is REFUSED while any part of the blast radius is unmeasurable.
      //
      // The typechecker found this call site the moment the counts became nullable. That is the argument for a
      // type the compiler can see over a magic value it cannot: the FIRST consumer was obvious, this SECOND one
      // was not, and it is the more dangerous of the two.
      const unmeasured = Object.entries(impact).filter(([, val]) => val == null).map(([k]) => k);
      if (unmeasured.length) {
        return { ok: false as const, code: 'invalid' as const, message: `Could not measure the impact on: ${unmeasured.join(', ')}. A transfer cannot be requested until these can be counted.` };
      }

      const ins = await (trx as any).insertInto('branch_transfer_requests').values({
        branch_id: branchId, from_tenant_id: branch.tenant_id, to_tenant_id: v.destinationTenantId, status: 'requested',
        reason: v.reason, effective_date: v.effectiveDate, impact_snapshot: JSON.stringify(impact), requested_by_user_id: actorId,
      }).returning(['id', 'status', 'to_tenant_id']).executeTakeFirstOrThrow();
      return { ok: true as const, request: { id: String(ins.id), status: ins.status, toTenantId: String(ins.to_tenant_id) } };
    });
  }

  // --- Branch operating hours (§37). Read returns the full Sun–Sat grid (missing days default to open=false/null);
  // write upserts per day on the (location_id, day_of_week) unique key. ---
  async getBranchHours(branchId: string): Promise<{ branch: { id: string; name: string }; days: { dayOfWeek: number; label: string; isClosed: boolean; opensAt: string | null; closesAt: string | null; set: boolean }[] } | null> {
    const branch = await (this.db as any).selectFrom('branches').select(['id', 'name']).where('id', '=', branchId).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
    if (!branch) return null;
    const rows = await (this.db as any).selectFrom('tenant_location_hours').select(['day_of_week', 'opens_at', 'closes_at', 'is_closed']).where('location_id', '=', branchId).execute().catch(() => []);
    const byDay = new Map<number, any>(rows.map((r: any) => [Number(r.day_of_week), r]));
    const days = [0, 1, 2, 3, 4, 5, 6].map((dow) => { const r = byDay.get(dow); return { dayOfWeek: dow, label: DAY_LABELS[dow], isClosed: r ? !!r.is_closed : false, opensAt: r?.opens_at ?? null, closesAt: r?.closes_at ?? null, set: !!r }; });
    return { branch: { id: String(branch.id), name: branch.name }, days };
  }

  async setBranchHours(branchId: string, days: DayHoursValue[]): Promise<{ ok: true; count: number } | { ok: false; code: 'invalid' | 'not_found'; message: string }> {
    return this.db.transaction().execute(async (trx) => {
      const branch = await (trx as any).selectFrom('branches').select(['id', 'tenant_id']).where('id', '=', branchId).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
      if (!branch) return { ok: false as const, code: 'not_found' as const, message: 'Branch not found.' };
      for (const d of days) {
        await sql`insert into tenant_location_hours (tenant_id, location_id, day_of_week, opens_at, closes_at, is_closed, updated_at)
          values (${branch.tenant_id}, ${branchId}, ${d.dayOfWeek}, ${d.opensAt}, ${d.closesAt}, ${d.isClosed}, now())
          on conflict (location_id, day_of_week) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at, is_closed = excluded.is_closed, updated_at = now()`.execute(trx);
      }
      return { ok: true as const, count: days.length };
    });
  }

  // --- Device allocation (§36). Lists the branch's tenant fleet with current allocation; allocates a branch-capable
  // device (terminal/display/kiosk) to this branch. Leased hardware has no branch_id → shown but not allocatable. ---
  async branchDevices(branchId: string): Promise<{ branch: { id: string; name: string }; tenantId: string; devices: { id: string; category: string; deviceType: string; name: string; status: string; currentBranchId: string | null; currentBranchName: string | null; onThisBranch: boolean; allocatable: boolean }[] } | null> {
    const branch = await (this.db as any).selectFrom('branches').select(['id', 'name', 'tenant_id']).where('id', '=', branchId).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
    if (!branch) return null;
    const tenantId = branch.tenant_id;
    const tbr = await (this.db as any).selectFrom('branches').select(['id', 'name']).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).execute().catch(() => []);
    const bname = new Map<string, string>(tbr.map((b: any) => [String(b.id), b.name]));
    const terminals = await (this.db as any).selectFrom('pos_payment_terminals').select(['id', 'label as name', 'status', 'branch_id']).where('tenant_id', '=', tenantId).execute().catch(() => []);
    const displays = await (this.db as any).selectFrom('customer_display_devices').select(['id', 'device_name as name', 'pairing_status as status', 'branch_id']).where('tenant_id', '=', tenantId).execute().catch(() => []);
    const kiosks = await (this.db as any).selectFrom('go_checkin_devices').select(['id', 'device_name as name', 'status', 'branch_id']).where('tenant_id', '=', tenantId).execute().catch(() => []);
    const leased = await (this.db as any).selectFrom('hardware_package_devices').select(['id', 'device_name as name', 'status']).where('tenant_id', '=', tenantId).execute().catch(() => []);
    const mk = (r: any, category: string, deviceType: string, allocatable: boolean) => ({ id: String(r.id), category, deviceType, name: r.name || '—', status: r.status || 'unknown', currentBranchId: r.branch_id ? String(r.branch_id) : null, currentBranchName: r.branch_id ? (bname.get(String(r.branch_id)) ?? null) : null, onThisBranch: r.branch_id ? String(r.branch_id) === String(branchId) : false, allocatable });
    const devices = [
      ...terminals.map((r: any) => mk(r, 'Payment Terminal', 'terminal', true)),
      ...displays.map((r: any) => mk(r, 'Customer Display', 'display', true)),
      ...kiosks.map((r: any) => mk(r, 'Check-In Kiosk', 'kiosk', true)),
      ...leased.map((r: any) => mk(r, 'Leased Hardware', 'hardware', false)),
    ];
    return { branch: { id: String(branch.id), name: branch.name }, tenantId: String(tenantId), devices };
  }

  async allocateDevice(branchId: string, v: AllocateDeviceValue): Promise<{ ok: true; device: { id: string; name: string }; movedFromBranchId: string | null } | { ok: false; code: 'invalid' | 'not_found'; message: string }> {
    return this.db.transaction().execute(async (trx) => {
      const branch = await (trx as any).selectFrom('branches').select(['id', 'tenant_id']).where('id', '=', branchId).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
      if (!branch) return { ok: false as const, code: 'not_found' as const, message: 'Branch not found.' };
      const tenantId = branch.tenant_id;
      const tableFor: Record<string, { tbl: string; name: string }> = { terminal: { tbl: 'pos_payment_terminals', name: 'label' }, display: { tbl: 'customer_display_devices', name: 'device_name' }, kiosk: { tbl: 'go_checkin_devices', name: 'device_name' } };
      const m = tableFor[v.category];
      if (!m) return { ok: false as const, code: 'invalid' as const, message: 'That device type cannot be allocated to a branch.' };
      const dev = await (trx as any).selectFrom(m.tbl).select(['id', `${m.name} as name`, 'branch_id']).where('id', '=', v.deviceId).where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined);
      if (!dev) return { ok: false as const, code: 'invalid' as const, message: "Device not found in this branch's tenant." };
      const movedFromBranchId = dev.branch_id && String(dev.branch_id) !== String(branchId) ? String(dev.branch_id) : null;
      await (trx as any).updateTable(m.tbl).set({ branch_id: branchId }).where('id', '=', v.deviceId).where('tenant_id', '=', tenantId).execute();
      return { ok: true as const, device: { id: String(dev.id), name: dev.name || '—' }, movedFromBranchId };
    });
  }

  // Status lifecycle (§30–§32). Read the current row, then apply the change guarded by the expected-from status
  // (status = from) so a stale client cannot force an illegal jump; a 0-row update means the status moved concurrently.
  async getBranchForStatus(id: string): Promise<{ id: string; name: string; status: string } | null> {
    const r = await (this.db as any).selectFrom('branches').select(['id', 'name', 'status']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst().catch(() => undefined);
    return r ? { id: String(r.id), name: r.name, status: r.status } : null;
  }
  async applyBranchStatus(id: string, from: string, to: string): Promise<{ id: string; name: string; status: string } | null> {
    const r = await (this.db as any).updateTable('branches').set({ status: to, updated_at: new Date() }).where('id', '=', id).where('status', '=', from).where('deleted_at', 'is', null).returning(['id', 'name', 'status']).executeTakeFirst().catch(() => undefined);
    return r ? { id: String(r.id), name: r.name, status: r.status } : null;
  }

  // Bulk status change (§27). Applies the SAME per-branch transition validation + atomic compare-and-swap as the single
  // command to each selected branch, so an invalid or concurrently-changed branch is reported without blocking the rest.
  async bulkApplyStatus(ids: string[], to: string): Promise<{ id: string; name: string; ok: boolean; message: string }[]> {
    const results: { id: string; name: string; ok: boolean; message: string }[] = [];
    for (const id of ids) {
      const cur = await this.getBranchForStatus(id);
      if (!cur) { results.push({ id, name: id, ok: false, message: 'Branch not found.' }); continue; }
      if (cur.status === to) { results.push({ id, name: cur.name, ok: true, message: `Already ${to}.` }); continue; }
      if (!canTransition(cur.status, to)) { results.push({ id, name: cur.name, ok: false, message: `Cannot change ${cur.status} → ${to}.` }); continue; }
      const applied = await this.applyBranchStatus(id, cur.status, to);
      if (!applied) { results.push({ id, name: cur.name, ok: false, message: 'Status changed concurrently; not applied.' }); continue; }
      results.push({ id, name: applied.name, ok: true, message: `${cur.status} → ${to}` });
    }
    return results;
  }

  async platformServices(q: ServicesQuery) {
    // NOTE: q.tenantId narrows the Overview-consumed outputs only (this method's primary rows/KPIs). The
    // dedicated-screen distributions below stay platform-wide; the only scoped caller is the Overview aggregate.

    const base = () => {
      let qb: any = (this.db as any).selectFrom('services')
        .leftJoin('tenants as t', 't.id', 'services.tenant_id')
        .leftJoin('service_categories as sc', 'sc.id', 'services.category_id')
        .where('services.archived_at', 'is', null);
      if (q.category) qb = qb.where('sc.name', '=', q.category);
      if (q.status) qb = qb.where('services.status', '=', q.status);
      if (q.search) qb = qb.where((eb: any) => eb.or([eb('services.name', 'ilike', like(q.search!)), eb('sc.name', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!))]));
      return qb;
    };
    const total = Number((await base().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rows: any[] = await base().clearSelect().select([
      'services.id', 'services.name', 'services.duration_minutes', 'services.price_cents', 'services.commission_type', 'services.commission_value',
      'services.online_booking_enabled', 'services.status', 'services.tenant_id', 't.display_name as tenant_name', 'sc.name as category_name', 'services.updated_at',
    ]).orderBy('services.name', 'asc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    // aggregates across the full (unpaginated) filtered set
    const catAgg: any[] = await (this.db as any).selectFrom('services').leftJoin('service_categories as sc', 'sc.id', 'services.category_id')
      .where('services.archived_at', 'is', null).select(['sc.name as category', sql`count(*)`.as('n')]).groupBy('sc.name').orderBy('n', 'desc').execute().catch(() => []);
    const statusAgg: any[] = await (this.db as any).selectFrom('services').where('archived_at', 'is', null)
      .select(['status', sql`count(*)`.as('n')]).groupBy('status').execute().catch(() => []);
    const totalsRow: any = await (this.db as any).selectFrom('services').where('archived_at', 'is', null)
      .select([sql`count(*)`.as('total'), sql`count(*) filter (where status = 'active')`.as('active'), sql`coalesce(avg(price_cents),0)`.as('avg_price'), sql`coalesce(avg(duration_minutes),0)`.as('avg_dur'), sql`count(*) filter (where online_booking_enabled)`.as('bookable')]).executeTakeFirst().catch(() => ({}));
    // catalog health buckets (real): inactive, missing info (no price/duration), needs update (no description/category)
    const healthRow: any = await (this.db as any).selectFrom('services').where('archived_at', 'is', null).select([
      sql`count(*) filter (where status <> 'active')`.as('inactive'),
      sql`count(*) filter (where price_cents is null or duration_minutes is null)`.as('missing_info'),
      sql`count(*) filter (where description is null or category_id is null)`.as('needs_update'),
    ]).executeTakeFirst().catch(() => ({}));
    // avg rating (real; reviews — empty in seed → 0/honest)
    const ratingRow: any = await (this.db as any).selectFrom('reviews').$if(!!q.tenantId, (qb: any) => qb.where('tenant_id', '=', q.tenantId)).select([sql`coalesce(round(avg(rating)::numeric,1),0)`.as('avg'), sql`count(*)`.as('n')]).executeTakeFirst().catch(() => ({}));
    // service bookings + revenue from ticket_service_lines (real)
    const bookRow: any = await (this.db as any).selectFrom('ticket_service_lines').select([
      sql`count(*)`.as('total'), sql`coalesce(sum(price_cents_snapshot),0)`.as('revenue'),
      sql`count(*) filter (where created_at >= date_trunc('month', current_date))`.as('this_month'),
      sql`coalesce(sum(price_cents_snapshot) filter (where created_at >= date_trunc('month', current_date)),0)`.as('rev_month'),
    ]).executeTakeFirst().catch(() => ({}));
    // monthly series last 6 months (real)
    const monthlyAgg: any[] = await (this.db as any).selectFrom('ticket_service_lines')
      .where('created_at', '>=', sql`date_trunc('month', current_date) - interval '5 months'`)
      .select([sql`to_char(date_trunc('month', created_at), 'Mon')`.as('month'), sql`count(*)`.as('bookings'), sql`coalesce(sum(price_cents_snapshot),0)`.as('revenue')])
      .groupBy(sql`date_trunc('month', created_at)`).orderBy(sql`date_trunc('month', created_at)`).execute().catch(() => []);
    // per-service performance via left join (real; includes 0-booking services for low performers)
    const svcPerfAgg: any[] = await (this.db as any).selectFrom('services as s').leftJoin('ticket_service_lines as tsl', 'tsl.service_id', 's.id')
      .where('s.archived_at', 'is', null).$if(!!q.tenantId, (qb: any) => qb.where('s.tenant_id', '=', q.tenantId)).select(['s.name', sql`count(tsl.id)`.as('bookings'), sql`coalesce(sum(tsl.price_cents_snapshot),0)`.as('revenue')])
      .groupBy(['s.id', 's.name']).execute().catch(() => []);
    const perf = svcPerfAgg.map((p) => ({ name: p.name, bookings: Number(p.bookings), revenueCents: Number(p.revenue) }));
    // recent service activity — recent create/update (real)
    const recentAgg: any[] = await (this.db as any).selectFrom('services').leftJoin('tenants as t2', 't2.id', 'services.tenant_id')
      .where('services.archived_at', 'is', null).select(['services.name', 'services.created_at', 'services.updated_at', 't2.display_name as tenant_name'])
      .orderBy('services.updated_at', 'desc').limit(6).execute().catch(() => []);
    // pricing extremes (real) — highest/lowest priced services in the active (non-archived) set
    const hiSvc: any = await (this.db as any).selectFrom('services').where('archived_at', 'is', null).select(['name', 'price_cents']).orderBy('price_cents', 'desc').limit(1).executeTakeFirst().catch(() => null);
    const loSvc: any = await (this.db as any).selectFrom('services').where('archived_at', 'is', null).select(['name', 'price_cents']).orderBy('price_cents', 'asc').limit(1).executeTakeFirst().catch(() => null);
    // service health % (real) — 5-factor per-service completeness, averaged, expressed in permille
    const healthPctRow: any = await sql`
      with f as (
        select (
          (case when status = 'active' then 1 else 0 end)
          + (case when price_cents is not null then 1 else 0 end)
          + (case when duration_minutes is not null then 1 else 0 end)
          + (case when nullif(trim(description),'') is not null then 1 else 0 end)
          + (case when category_id is not null then 1 else 0 end)
        )::numeric / 5.0 as score
        from services where archived_at is null
      ) select round(avg(score) * 1000)::int as permille from f
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    // staff service availability (oversight, real counts) — services configured per technician via technician_services.
    // servicesOffered is real; utilizationPct is a documented honest gap (no capacity / booking-slot model in schema).
    const staffAgg: any[] = await (this.db as any).selectFrom('technician_services as ts')
      .leftJoin('technicians as tch', 'tch.id', 'ts.technician_id')
      .leftJoin('tenants as t4', 't4.id', 'ts.tenant_id')
      .select(['tch.full_name as name', 't4.display_name as tenant_name', sql`count(distinct ts.service_id)`.as('services_offered')])
      .groupBy(['tch.id', 'tch.full_name', 't4.display_name']).orderBy('services_offered', 'desc').limit(8).execute().catch(() => []);
    return {
      rows: rows.map((r) => ({
        id: r.id, name: r.name, durationMinutes: r.duration_minutes, priceCents: r.price_cents,
        commissionType: r.commission_type, commissionValue: r.commission_value, onlineBooking: !!r.online_booking_enabled,
        status: r.status, tenantId: r.tenant_id, tenantName: r.tenant_name || null, category: r.category_name || 'Uncategorized',
      })),
      total,
      kpis: {
        totalServices: Number(totalsRow?.total ?? 0), activeServices: Number(totalsRow?.active ?? 0),
        categories: catAgg.filter((c) => c.category).length, avgPriceCents: Math.round(Number(totalsRow?.avg_price ?? 0)),
        avgDurationMinutes: Math.round(Number(totalsRow?.avg_dur ?? 0)), onlineBookable: Number(totalsRow?.bookable ?? 0),
        bookingsThisMonth: Number(bookRow?.this_month ?? 0), revenueCentsThisMonth: Number(bookRow?.rev_month ?? 0),
        bookingsTotal: Number(bookRow?.total ?? 0), revenueCentsTotal: Number(bookRow?.revenue ?? 0),
        avgRating: Number(ratingRow?.avg ?? 0), reviewCount: Number(ratingRow?.n ?? 0),
      },
      byCategory: catAgg.map((c) => ({ category: c.category || 'Uncategorized', count: Number(c.n) })),
      byStatus: statusAgg.map((s) => ({ status: s.status, count: Number(s.n) })),
      catalogHealth: {
        active: Number(totalsRow?.active ?? 0), inactive: Number(healthRow?.inactive ?? 0),
        needsUpdate: Number(healthRow?.needs_update ?? 0), missingInfo: Number(healthRow?.missing_info ?? 0),
      },
      monthly: monthlyAgg.map((m) => ({ month: m.month, bookings: Number(m.bookings), revenueCents: Number(m.revenue) })),
      topServices: [...perf].sort((a, b) => b.bookings - a.bookings || b.revenueCents - a.revenueCents).slice(0, 5),
      lowServices: [...perf].sort((a, b) => a.bookings - b.bookings || a.revenueCents - b.revenueCents).slice(0, 5),
      recentActivity: recentAgg.map((r) => ({ name: r.name, action: new Date(r.created_at).getTime() === new Date(r.updated_at).getTime() ? 'created' : 'updated', at: r.updated_at, tenantName: r.tenant_name || null })),
      packages: [] as any[], // no service-packages table in schema — honest empty ("not configured")
      pricing: { avgCents: Math.round(Number(totalsRow?.avg_price ?? 0)), highestCents: hiSvc ? Number(hiSvc.price_cents) : null, highestName: hiSvc?.name ?? null, lowestCents: loSvc ? Number(loSvc.price_cents) : null, lowestName: loSvc?.name ?? null },
      healthPct: healthPctRow?.permille != null ? Number(healthPctRow.permille) / 10 : null,
      topByRevenue: topServicesByRevenue(perf),
      staffAvailability: staffAgg.map((s) => ({ name: s.name || '—', tenantName: s.tenant_name || null, servicesOffered: Number(s.services_offered || 0), utilizationPct: null })),
    };
  }
  async platformProducts(q: ProductsQuery) {
    // per-product summed stock across all branches, used by both the row list and the health rollups
    const base = () => {
      let qb: any = (this.db as any).selectFrom('inventory_products as p')
        .leftJoin('tenants as t', 't.id', 'p.tenant_id')
        .leftJoin('inventory_categories as c', 'c.id', 'p.category_id')
        .leftJoin('inventory_location_stock as ls', 'ls.product_id', 'p.id')
        .where('p.archived_at', 'is', null);
      if (q.category) qb = qb.where('c.name', '=', q.category);
      if (q.status === 'active') qb = qb.where('p.active', '=', true);
      if (q.status === 'inactive') qb = qb.where('p.active', '=', false);
      if (q.search) qb = qb.where((eb: any) => eb.or([eb('p.name', 'ilike', like(q.search!)), eb('p.sku', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!))]));
      return qb;
    };
    const totalRow: any = await (this.db as any).selectFrom('inventory_products as p').leftJoin('inventory_categories as c', 'c.id', 'p.category_id').leftJoin('tenants as t', 't.id', 'p.tenant_id')
      .where('p.archived_at', 'is', null)
      .$if(!!q.category, (b: any) => b.where('c.name', '=', q.category))
      .$if(q.status === 'active', (b: any) => b.where('p.active', '=', true))
      .$if(q.status === 'inactive', (b: any) => b.where('p.active', '=', false))
      .$if(!!q.search, (b: any) => b.where((eb: any) => eb.or([eb('p.name', 'ilike', like(q.search!)), eb('p.sku', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!))])))
      .select(sql`count(distinct p.id)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 }));
    const total = Number(totalRow?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rows: any[] = await base().clearSelect().groupBy(['p.id', 't.display_name', 'c.name']).select([
      'p.id', 'p.name', 'p.sku', 'p.cost_cents', 'p.retail_price_cents', 'p.reorder_level', 'p.active', 'p.is_retail',
      'p.tenant_id', 't.display_name as tenant_name', 'c.name as category_name',
      sql`coalesce(sum(ls.quantity_on_hand),0)`.as('stock'),
    ]).orderBy('p.name', 'asc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    // catalog-wide per-product stock summary for KPIs / health (bounded; archived excluded)
    const summary: any[] = await (this.db as any).selectFrom('inventory_products as p')
      .leftJoin('inventory_location_stock as ls', 'ls.product_id', 'p.id')
      .leftJoin('inventory_categories as c', 'c.id', 'p.category_id')
      .where('p.archived_at', 'is', null)
      .groupBy(['p.id', 'p.name', 'p.reorder_level', 'p.active', 'p.cost_cents', 'p.retail_price_cents', 'c.name'])
      .select(['p.id', 'p.name', 'p.reorder_level', 'p.active', 'p.cost_cents', 'p.retail_price_cents', 'c.name as category', sql`coalesce(sum(ls.quantity_on_hand),0)`.as('stock')])
      .execute().catch(() => []);
    let activeSkus = 0, lowStock = 0, inStock = 0, outOfStock = 0, reorderPending = 0, inventoryValueCents = 0, overstock = 0;
    let marginSum = 0, marginN = 0;
    const lowStockList: any[] = [];
    const catMap = new Map<string, { count: number; valueCents: number }>();
    for (const s of summary) {
      const stock = Number(s.stock || 0); const reorder = Number(s.reorder_level || 0); const cost = Number(s.cost_cents || 0); const price = Number(s.retail_price_cents || 0);
      if (s.active) activeSkus++;
      if (stock > 0) inStock++; else outOfStock++;
      if (reorder > 0 && stock <= reorder) { lowStock++; reorderPending++; lowStockList.push({ name: s.name, stock, reorderLevel: reorder, status: stock === 0 ? 'critical' : 'low' }); }
      if (reorder > 0 && stock > reorder * 3) overstock++;
      if (cost > 0 && price > 0) { marginSum += (price - cost) / price; marginN++; }
      inventoryValueCents += stock * cost;
      const cat = s.category || 'Uncategorized'; const e = catMap.get(cat) || { count: 0, valueCents: 0 };
      e.count++; e.valueCents += stock * cost; catMap.set(cat, e);
    }
    lowStockList.sort((a, b) => a.stock - b.stock);
    const avgGrossMarginPct = marginN ? Math.round((marginSum / marginN) * 1000) / 10 : 0;
    // suppliers (inventory_vendors) — real
    const suppliers: any[] = await (this.db as any).selectFrom('inventory_vendors as v').leftJoin('tenants as t3', 't3.id', 'v.tenant_id')
      .where('v.active', '=', true).select(['v.name', 'v.lead_time_days', 'v.payment_terms', 't3.display_name as tenant_name']).limit(8).execute().catch(() => []);
    // recent product activity — stock movements (real)
    const moves: any[] = await (this.db as any).selectFrom('inventory_stock_movements as m').leftJoin('inventory_products as p2', 'p2.id', 'm.product_id')
      .select(['m.movement_type', 'm.quantity_change', 'm.created_at', 'p2.name as product_name']).orderBy('m.created_at', 'desc').limit(6).execute().catch(() => []);
    // top selling products — sale movements grouped by product (real)
    const topMoves: any[] = await (this.db as any).selectFrom('inventory_stock_movements as m').leftJoin('inventory_products as p3', 'p3.id', 'm.product_id')
      .where('m.movement_type', 'in', ['sale', 'sold', 'retail_sale'])
      .select(['p3.name as name', sql`coalesce(sum(abs(m.quantity_change)),0)`.as('units'), sql`coalesce(sum(abs(m.quantity_change) * coalesce(p3.retail_price_cents,0)),0)`.as('revenue')])
      .groupBy('p3.name').orderBy('units', 'desc').limit(5).execute().catch(() => []);
    // monthly product sales last 6 months (real)
    const monthlyAgg: any[] = await (this.db as any).selectFrom('inventory_stock_movements as m').leftJoin('inventory_products as p4', 'p4.id', 'm.product_id')
      .where('m.movement_type', 'in', ['sale', 'sold', 'retail_sale']).where('m.created_at', '>=', sql`date_trunc('month', current_date) - interval '5 months'`)
      .select([sql`to_char(date_trunc('month', m.created_at), 'Mon')`.as('month'), sql`coalesce(sum(abs(m.quantity_change)),0)`.as('units'), sql`coalesce(sum(abs(m.quantity_change) * coalesce(p4.retail_price_cents,0)),0)`.as('revenue')])
      .groupBy(sql`date_trunc('month', m.created_at)`).orderBy(sql`date_trunc('month', m.created_at)`).execute().catch(() => []);
    const monthlySalesCents = monthlyAgg.reduce((a, m) => a + Number(m.revenue || 0), 0);
    // inventory value by branch — real, decimal-safe (cents summed as bigint)
    const branchValue: any[] = await sql`
      select b.name as branch, coalesce(sum(ls.quantity_on_hand::bigint * coalesce(ls.average_cost_cents,0)),0)::bigint as value_cents
      from inventory_location_stock ls left join branches b on b.id = ls.branch_id
      group by b.name order by value_cents desc limit 12
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    // inventory movement — units in/out per day, last 30d; enum-agnostic via sign of quantity_change
    const movementAgg: any[] = await sql`
      select to_char(date_trunc('day', created_at),'YYYY-MM-DD') as day,
        coalesce(sum(case when quantity_change > 0 then quantity_change else 0 end),0)::int as in_units,
        coalesce(sum(case when quantity_change < 0 then -quantity_change else 0 end),0)::int as out_units
      from inventory_stock_movements where created_at >= now() - interval '30 days'
      group by 1 order by 1
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    // product-catalog data-quality health % — REAL completeness across 7 factors (drives the Product Health gauge)
    const dq: any = await sql`
      with f as (select (
        (case when category_id is not null then 1 else 0 end)
        + (case when brand_id is not null then 1 else 0 end)
        + (case when nullif(trim(sku),'') is not null then 1 else 0 end)
        + (case when (nullif(trim(barcode),'') is not null or nullif(trim(upc),'') is not null) then 1 else 0 end)
        + (case when nullif(trim(image_url),'') is not null then 1 else 0 end)
        + (case when retail_price_cents is not null then 1 else 0 end)
        + (case when size_value is not null then 1 else 0 end))::numeric / 7.0 as score
        from inventory_products where archived_at is null
      ) select round(avg(score)*1000)::int as permille from f
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    return {
      rows: rows.map((r) => ({
        id: r.id, name: r.name, sku: r.sku || '—', category: r.category_name || 'Uncategorized',
        type: r.is_retail ? 'Retail' : 'Professional', costCents: r.cost_cents || 0, priceCents: r.retail_price_cents || 0,
        stock: Number(r.stock || 0), reorderLevel: r.reorder_level || 0, active: !!r.active,
        tenantId: r.tenant_id, tenantName: r.tenant_name || null,
      })),
      total,
      kpis: {
        totalProducts: summary.length, activeSkus, lowStockAlerts: lowStock,
        categories: new Set(summary.map((s) => s.category).filter(Boolean)).size,
        inventoryValueCents, outOfStock, overstock,
        monthlySalesCents, avgGrossMarginPct, suppliersActive: suppliers.length,
      },
      byCategory: [...catMap.entries()].map(([category, v]) => ({ category, count: v.count, valueCents: v.valueCents })).sort((a, b) => b.valueCents - a.valueCents),
      stockHealth: { inStock, outOfStock, reorderPending, overstock, expiringSoon: 0, total: summary.length },
      lowStockList: lowStockList.slice(0, 8),
      topProducts: topMoves.map((m) => ({ name: m.name || '—', units: Number(m.units || 0), revenueCents: Number(m.revenue || 0) })),
      suppliers: suppliers.map((s) => ({ name: s.name, leadTimeDays: s.lead_time_days ?? null, paymentTerms: s.payment_terms || null, tenantName: s.tenant_name || null })),
      recentActivity: moves.map((m) => ({ product: m.product_name || '—', action: m.movement_type || 'movement', qty: Number(m.quantity_change || 0), at: m.created_at })),
      monthly: monthlyAgg.map((m) => ({ month: m.month, revenueCents: Number(m.revenue || 0), units: Number(m.units || 0) })),
      byBranch: branchValue.filter((b) => b.branch).map((b) => ({ branch: b.branch, valueCents: Number(b.value_cents || 0) })),
      movement: movementAgg.map((m) => ({ day: m.day, inUnits: Number(m.in_units || 0), outUnits: Number(m.out_units || 0) })),
      dataQualityPct: dq?.permille != null ? Number(dq.permille) / 10 : null,
    };
  }

  async platformCategories(q: CategoriesQuery) {
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const k: any = await sql`
      select
        (select count(*)::int from inventory_categories) as total_categories,
        (select count(distinct lower(trim(name)))::int from inventory_categories) as distinct_names,
        (select count(*)::int from inventory_categories where active = true) as active_categories,
        (select count(distinct tenant_id)::int from inventory_categories) as tenants_covered,
        (select count(*)::int from inventory_products where archived_at is null and category_id is null) as uncategorized_products
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const rows: any[] = await sql`
      select lower(trim(c.name)) as norm, min(c.name) as display,
        count(distinct c.tenant_id)::int as tenant_count,
        count(distinct c.id)::int as category_count,
        count(distinct case when c.active then c.id end)::int as active_count,
        count(p.id)::int as product_count
      from inventory_categories c
      left join inventory_products p on p.category_id = c.id and p.archived_at is null
      ${q.search ? sql`where c.name ilike ${like(q.search)}` : sql``}
      group by lower(trim(c.name)) order by tenant_count desc, display asc
      limit ${ps} offset ${(page - 1) * ps}
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const totalRow: any = await sql`select count(distinct lower(trim(name)))::int as n from inventory_categories ${q.search ? sql`where name ilike ${like(q.search)}` : sql``}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const dupRows: any[] = await sql`
      select lower(trim(c.name)) as norm, t.display_name as tenant, c.name as name, count(p.id)::int as products
      from inventory_categories c
      left join tenants t on t.id = c.tenant_id
      left join inventory_products p on p.category_id = c.id and p.archived_at is null
      where lower(trim(c.name)) in (
        select lower(trim(name)) from inventory_categories group by lower(trim(name)) having count(distinct tenant_id) > 1)
      group by lower(trim(c.name)), t.display_name, c.name order by norm
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return {
      rows: rows.map((r) => ({ normalizedName: r.norm, name: r.display, tenantCount: Number(r.tenant_count || 0), categoryCount: Number(r.category_count || 0), activeCount: Number(r.active_count || 0), productCount: Number(r.product_count || 0) })),
      total: Number(totalRow?.n || 0),
      kpis: { totalCategories: Number(k?.total_categories || 0), distinctNames: Number(k?.distinct_names || 0), activeCategories: Number(k?.active_categories || 0), tenantsCovered: Number(k?.tenants_covered || 0), uncategorizedProducts: Number(k?.uncategorized_products || 0) },
      duplicates: groupCategoryDuplicates(dupRows),
    };
  }

  async platformBrands(q: CategoriesQuery) {
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const k: any = await sql`
      select
        (select count(*)::int from inventory_brands) as total_brands,
        (select count(distinct lower(trim(name)))::int from inventory_brands) as distinct_names,
        (select count(*)::int from inventory_brands where active = true) as active_brands,
        (select count(distinct tenant_id)::int from inventory_brands) as tenants_covered,
        (select count(*)::int from inventory_products where archived_at is null and brand_id is null) as unbranded_products
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const rows: any[] = await sql`
      select lower(trim(b.name)) as norm, min(b.name) as display,
        count(distinct b.tenant_id)::int as tenant_count,
        count(distinct b.id)::int as brand_count,
        count(distinct case when b.active then b.id end)::int as active_count,
        count(p.id)::int as product_count
      from inventory_brands b
      left join inventory_products p on p.brand_id = b.id and p.archived_at is null
      ${q.search ? sql`where b.name ilike ${like(q.search)}` : sql``}
      group by lower(trim(b.name)) order by tenant_count desc, display asc
      limit ${ps} offset ${(page - 1) * ps}
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const totalRow: any = await sql`select count(distinct lower(trim(name)))::int as n from inventory_brands ${q.search ? sql`where name ilike ${like(q.search)}` : sql``}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const dupRows: any[] = await sql`
      select lower(trim(b.name)) as norm, t.display_name as tenant, b.name as name, count(p.id)::int as products
      from inventory_brands b
      left join tenants t on t.id = b.tenant_id
      left join inventory_products p on p.brand_id = b.id and p.archived_at is null
      where lower(trim(b.name)) in (
        select lower(trim(name)) from inventory_brands group by lower(trim(name)) having count(distinct tenant_id) > 1)
      group by lower(trim(b.name)), t.display_name, b.name order by norm
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return {
      rows: rows.map((r) => ({ normalizedName: r.norm, name: r.display, tenantCount: Number(r.tenant_count || 0), categoryCount: Number(r.brand_count || 0), activeCount: Number(r.active_count || 0), productCount: Number(r.product_count || 0) })),
      total: Number(totalRow?.n || 0),
      kpis: { totalCategories: Number(k?.total_brands || 0), distinctNames: Number(k?.distinct_names || 0), activeCategories: Number(k?.active_brands || 0), tenantsCovered: Number(k?.tenants_covered || 0), uncategorizedProducts: Number(k?.unbranded_products || 0) },
      duplicates: groupCategoryDuplicates(dupRows),
    };
  }

  async platformSuppliers(q: CategoriesQuery) {
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const k: any = await sql`
      select
        (select count(*)::int from inventory_vendors) as total_suppliers,
        (select count(*)::int from inventory_vendors where active = true) as active_suppliers,
        (select count(distinct lower(trim(name)))::int from inventory_vendors) as distinct_names,
        (select count(distinct tenant_id)::int from inventory_vendors) as tenants_covered,
        (select count(*)::int from inventory_vendors where nullif(trim(email),'') is not null or nullif(trim(phone),'') is not null) as with_contact
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const rows: any[] = await sql`
      select v.id, v.name, v.contact_name, v.email, v.phone, v.payment_terms, v.lead_time_days, v.active,
        t.display_name as tenant_name, count(p.id)::int as product_count
      from inventory_vendors v
      left join tenants t on t.id = v.tenant_id
      left join inventory_products p on p.preferred_vendor_id = v.id and p.archived_at is null
      ${q.search ? sql`where v.name ilike ${like(q.search)}` : sql``}
      group by v.id, t.display_name order by v.name asc
      limit ${ps} offset ${(page - 1) * ps}
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const totalRow: any = await sql`select count(*)::int as n from inventory_vendors ${q.search ? sql`where name ilike ${like(q.search)}` : sql``}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    // suppliers used by more than one tenant — candidates for a shared global supplier directory entry
    const dupRows: any[] = await sql`
      select lower(trim(v.name)) as norm, t.display_name as tenant, v.name as name, count(p.id)::int as products
      from inventory_vendors v
      left join tenants t on t.id = v.tenant_id
      left join inventory_products p on p.preferred_vendor_id = v.id and p.archived_at is null
      where lower(trim(v.name)) in (
        select lower(trim(name)) from inventory_vendors group by lower(trim(name)) having count(distinct tenant_id) > 1)
      group by lower(trim(v.name)), t.display_name, v.name order by norm
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return {
      rows: rows.map((r) => ({ id: r.id, name: r.name, tenantName: r.tenant_name || null, contactName: r.contact_name || null, email: r.email || null, phone: r.phone || null, paymentTerms: r.payment_terms || null, leadTimeDays: r.lead_time_days ?? null, active: !!r.active, productCount: Number(r.product_count || 0) })),
      total: Number(totalRow?.n || 0),
      kpis: {
        totalSuppliers: Number(k?.total_suppliers || 0),
        activeSuppliers: Number(k?.active_suppliers || 0),
        distinctNames: Number(k?.distinct_names || 0),
        tenantsCovered: Number(k?.tenants_covered || 0),
        withContact: Number(k?.with_contact || 0),
        integrationsConnected: null, // honest gap — no supplier integration/sync columns in schema (§26)
      },
      duplicates: groupCategoryDuplicates(dupRows),
    };
  }

  async platformServiceCategories(q: CategoriesQuery) {
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const k: any = await sql`
      select
        (select count(*)::int from service_categories) as total_categories,
        (select count(distinct lower(trim(name)))::int from service_categories) as distinct_names,
        (select count(*)::int from service_categories where status = 'active') as active_categories,
        (select count(distinct tenant_id)::int from service_categories) as tenants_covered,
        (select count(*)::int from services where archived_at is null and category_id is null) as uncategorized_services
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const rows: any[] = await sql`
      select lower(trim(c.name)) as norm, min(c.name) as display,
        count(distinct c.tenant_id)::int as tenant_count,
        count(distinct c.id)::int as category_count,
        count(distinct case when c.status = 'active' then c.id end)::int as active_count,
        count(s.id)::int as service_count
      from service_categories c
      left join services s on s.category_id = c.id and s.archived_at is null
      ${q.search ? sql`where c.name ilike ${like(q.search)}` : sql``}
      group by lower(trim(c.name)) order by tenant_count desc, display asc
      limit ${ps} offset ${(page - 1) * ps}
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const totalRow: any = await sql`select count(distinct lower(trim(name)))::int as n from service_categories ${q.search ? sql`where name ilike ${like(q.search)}` : sql``}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const dupRows: any[] = await sql`
      select lower(trim(c.name)) as norm, t.display_name as tenant, c.name as name, count(s.id)::int as products
      from service_categories c
      left join tenants t on t.id = c.tenant_id
      left join services s on s.category_id = c.id and s.archived_at is null
      where lower(trim(c.name)) in (
        select lower(trim(name)) from service_categories group by lower(trim(name)) having count(distinct tenant_id) > 1)
      group by lower(trim(c.name)), t.display_name, c.name order by norm
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return {
      rows: rows.map((r) => ({ normalizedName: r.norm, name: r.display, tenantCount: Number(r.tenant_count || 0), categoryCount: Number(r.category_count || 0), activeCount: Number(r.active_count || 0), serviceCount: Number(r.service_count || 0) })),
      total: Number(totalRow?.n || 0),
      kpis: { totalCategories: Number(k?.total_categories || 0), distinctNames: Number(k?.distinct_names || 0), activeCategories: Number(k?.active_categories || 0), tenantsCovered: Number(k?.tenants_covered || 0), uncategorizedServices: Number(k?.uncategorized_services || 0) },
      duplicates: groupCategoryDuplicates(dupRows),
    };
  }

  // One tenant's own service categories (with id + live service count) — backs the same-tenant category MERGE picker.
  // Scoped strictly to the given tenant; never returns another tenant's taxonomy.
  async tenantServiceCategories(tenantId: string) {
    const t: any = await sql`select display_name from tenants where id = ${tenantId}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const rows: any[] = await sql`
      select c.id, c.name, c.status, count(s.id)::int as service_count
      from service_categories c
      left join services s on s.category_id = c.id and s.tenant_id = c.tenant_id and s.archived_at is null
      where c.tenant_id = ${tenantId}
      group by c.id, c.name, c.status order by c.name asc
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return { tenantName: t?.display_name || null, categories: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, serviceCount: Number(r.service_count || 0) })) };
  }
  async platformAppointments(q: AppointmentsQuery) {
    // NOTE: q.tenantId narrows the Overview-consumed outputs only (this method's primary rows/KPIs). The
    // dedicated-screen distributions below stay platform-wide; the only scoped caller is the Overview aggregate.

    const base = () => {
      let qb: any = (this.db as any).selectFrom('pos_tech_appointments as a')
        .leftJoin('tenants as t', 't.id', 'a.tenant_id')
        .leftJoin('technicians as tech', 'tech.id', 'a.technician_id')
        .leftJoin('users as cust_user', (join: any) => join.onRef('cust_user.tenant_id', '=', 'a.tenant_id').onRef('cust_user.normalized_phone', '=', 'a.customer_phone'))
        .leftJoin('users as tech_user', 'tech_user.id', 'tech.user_id');
      if (q.status) qb = qb.where('a.status', '=', q.status);
      if (q.source) qb = qb.where('a.source', '=', q.source);
      if (q.date) qb = qb.where('a.appt_date', '=', q.date);
      if (q.search) qb = qb.where((eb: any) => eb.or([eb('a.customer_name', 'ilike', like(q.search!)), eb('a.customer_phone', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!))]));
      if (q.tenantId) qb = qb.where('a.tenant_id', '=', q.tenantId); // Phase 1b: optional single-tenant scope (rows)
      return qb;
    };
    const total = Number((await base().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rawRows: any[] = await base().clearSelect().select([
      'a.id', 'a.customer_name', 'a.customer_phone', 'a.services', 'a.appt_date', 'a.start_time', 'a.end_time',
      'a.duration_minutes', 'a.status', 'a.source', 'a.is_vip', 'a.tenant_id', 't.display_name as tenant_name', 'tech.full_name as tech_name',
      'cust_user.avatar_url as customer_avatar_url', 'tech.avatar_url as tech_photo_url', 'tech_user.avatar_url as tech_avatar_url',
    ]).orderBy('a.appt_date', 'desc').orderBy('a.start_time', 'asc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    const rows = rawRows.map((r) => ({
      ...r,
      customerAvatarUrl: r.customer_avatar_url ? buildMediaUrl(r.customer_avatar_url) : null,
      techAvatarUrl: (r.tech_photo_url || r.tech_avatar_url) ? buildMediaUrl(r.tech_photo_url || r.tech_avatar_url) : null,
    }));
    // distributions + rollups across all appointments (no tenant scope — platform-wide)
    const statusAgg: any[] = await (this.db as any).selectFrom('pos_tech_appointments').$if(!!q.tenantId, (qb: any) => qb.where('tenant_id', '=', q.tenantId)).select(['status', sql`count(*)`.as('n')]).groupBy('status').orderBy('n', 'desc').execute().catch(() => []);
    const sourceAgg: any[] = await (this.db as any).selectFrom('pos_tech_appointments').select(['source', sql`count(*)`.as('n')]).groupBy('source').orderBy('n', 'desc').execute().catch(() => []);
    const techAgg: any[] = await (this.db as any).selectFrom('pos_tech_appointments as a').leftJoin('technicians as tech', 'tech.id', 'a.technician_id')
      .select(['tech.full_name as name', sql`count(*)`.as('n')]).groupBy('tech.full_name').orderBy('n', 'desc').limit(10).execute().catch(() => []);
    const totalsRow: any = await (this.db as any).selectFrom('pos_tech_appointments').select([
      sql`count(*)`.as('total'),
      sql`count(*) filter (where appt_date = current_date)`.as('today'),
      sql`count(*) filter (where appt_date = current_date and status = 'confirmed')`.as('confirmed_today'),
      sql`count(*) filter (where status = 'no_show')`.as('no_show'),
      sql`count(*) filter (where source in ('online','customer_app'))`.as('online'),
      sql`count(*) filter (where source in ('manual','walk_in'))`.as('walk_in'),
      sql`count(*) filter (where appt_date = current_date and status = 'completed')`.as('completed_today'),
      sql`count(*) filter (where status = 'cancelled')`.as('cancelled'),
      sql`count(*) filter (where status = 'booked')`.as('pending'),
      sql`coalesce(round(avg(duration_minutes)),0)`.as('avg_dur'),
    ]).executeTakeFirst().catch(() => ({}));
    const grand = Number(totalsRow?.total ?? 0);
    // walk-in queue (real; pos_queue_items)
    const queueRows: any[] = await (this.db as any).selectFrom('pos_queue_items as qi').leftJoin('technicians as qtech', 'qtech.id', 'qi.assigned_technician_id')
      .where('qi.status', 'not in', ['served', 'completed', 'cancelled', 'no_show'])
      .select(['qi.customer_name', 'qi.priority', 'qi.requested_services', 'qi.status', 'qi.station', 'qi.checked_in_at', 'qtech.full_name as tech_name',
        sql`extract(epoch from (now() - qi.checked_in_at))/60`.as('wait_min')])
      .orderBy('qi.checked_in_at', 'asc').limit(10).execute().catch(() => []);
    // recent booking activity (real; recent appointment create/update)
    const recentAgg: any[] = await (this.db as any).selectFrom('pos_tech_appointments as a2').leftJoin('technicians as tech2', 'tech2.id', 'a2.technician_id')
      .select(['a2.customer_name', 'a2.status', 'a2.created_at', 'a2.updated_at', 'a2.source', 'tech2.full_name as tech_name'])
      .orderBy('a2.updated_at', 'desc').limit(6).execute().catch(() => []);
    // ---- extended dashboard aggregates (real Postgres) ----
    // branch performance: counts only. pos_tech_appointments has no amount/ticket column, so appointment revenue stays an honest gap.
    const branchAgg: any[] = await sql`
      select b.name as branch,
        count(*)::int as total,
        count(*) filter (where a.status = 'confirmed')::int as confirmed,
        count(*) filter (where a.status = 'completed')::int as completed,
        count(*) filter (where a.status = 'cancelled')::int as cancelled
      from pos_tech_appointments a left join branches b on b.id = a.branch_id
      group by b.name order by total desc limit 12
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    // top booked services: unnest the JSONB services array
    const svcAgg: any[] = await sql`
      select svc as service, count(*)::int as n
      from pos_tech_appointments, jsonb_array_elements_text(services) as svc
      group by svc order by n desc limit 8
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    // peak appointment hours: cast TEXT start_time to time, guarding malformed values
    const hourAgg: any[] = await sql`
      select extract(hour from start_time::time)::int as hour, count(*)::int as n
      from pos_tech_appointments
      where start_time ~ '^[0-9]{1,2}:[0-9]{2}'
      group by 1 order by 1
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const hourBuckets = Array.from({ length: 24 }, (_, h) => { const r = hourAgg.find((x: any) => Number(x.hour) === h); return { hour: h, count: r ? Number(r.n) : 0 }; });
    // current-week calendar (Mon–Sun) with per-day status split
    const dayAgg: any[] = await sql`
      select appt_date::text as d,
        count(*)::int as total,
        count(*) filter (where status = 'confirmed')::int as confirmed,
        count(*) filter (where status = 'booked')::int as pending,
        count(*) filter (where source in ('walk_in','manual'))::int as walk_ins,
        count(*) filter (where status = 'cancelled')::int as cancelled
      from pos_tech_appointments
      where appt_date >= date_trunc('week', current_date)::date
        and appt_date <  date_trunc('week', current_date)::date + 7
      group by appt_date order by appt_date
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    // appointment trend: daily counts across the current month
    const trendAgg: any[] = await sql`
      select appt_date::text as d, count(*)::int as n
      from pos_tech_appointments
      where appt_date >= date_trunc('month', current_date)::date
      group by appt_date order by appt_date
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    // duplicate-booking detection (§27): same tenant+branch+customer phone+date with overlapping time, not cancelled/no-show
    const dupRow: any = await sql`
      select count(*)::int as n from (
        select a.id from pos_tech_appointments a
        join pos_tech_appointments b
          on a.tenant_id = b.tenant_id
         and coalesce(a.branch_id, '00000000-0000-0000-0000-000000000000') = coalesce(b.branch_id, '00000000-0000-0000-0000-000000000000')
         and a.customer_phone = b.customer_phone and a.customer_phone is not null and a.customer_phone <> ''
         and a.appt_date = b.appt_date and a.id < b.id
         and a.status not in ('cancelled','no_show') and b.status not in ('cancelled','no_show')
         and a.start_time ~ '^[0-9]{1,2}:[0-9]{2}' and b.start_time ~ '^[0-9]{1,2}:[0-9]{2}'
         and a.end_time ~ '^[0-9]{1,2}:[0-9]{2}' and b.end_time ~ '^[0-9]{1,2}:[0-9]{2}'
         and a.start_time::time < b.end_time::time and b.start_time::time < a.end_time::time
      ) d
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    // technician double-booking / schedule conflict detection (§28): same technician+date with overlapping time
    const confRow: any = await sql`
      select count(*)::int as n from (
        select a.id from pos_tech_appointments a
        join pos_tech_appointments b
          on a.technician_id = b.technician_id and a.appt_date = b.appt_date and a.id < b.id
         and a.status not in ('cancelled','no_show') and b.status not in ('cancelled','no_show')
         and a.start_time ~ '^[0-9]{1,2}:[0-9]{2}' and b.start_time ~ '^[0-9]{1,2}:[0-9]{2}'
         and a.end_time ~ '^[0-9]{1,2}:[0-9]{2}' and b.end_time ~ '^[0-9]{1,2}:[0-9]{2}'
         and a.start_time::time < b.end_time::time and b.start_time::time < a.end_time::time
      ) c
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    // failed-deposit detection (§19/§20): upcoming, non-cancelled appointments whose deposit failed
    const depRow: any = await sql`
      select count(*)::int as n from pos_tech_appointments
      where appt_date >= current_date and status not in ('cancelled','no_show') and deposit_status = 'failed'
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    // missing-contact detection (§19): upcoming, non-cancelled appointments with no customer phone on file
    const contactRow: any = await sql`
      select count(*)::int as n from pos_tech_appointments
      where appt_date >= current_date and status not in ('cancelled','no_show') and (customer_phone is null or btrim(customer_phone) = '')
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    // reminder-failure detection (§29/§19): failed delivery attempts in the trailing 7 days (honest 0 if the ledger table is absent)
    const remFailRow: any = await sql`
      select count(*)::int as n from appointment_reminder_attempts
      where status = 'failed' and created_at >= now() - interval '7 days'
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    return {
      rows: rows.map((r) => ({
        id: r.id, customerName: r.customer_name || '—', customerPhone: r.customer_phone || '—',
        services: Array.isArray(r.services) ? r.services : (r.services ? [r.services] : []),
        apptDate: r.appt_date, startTime: r.start_time, durationMinutes: r.duration_minutes, status: r.status,
        source: r.source, isVip: !!r.is_vip, tenantId: r.tenant_id, tenantName: r.tenant_name || null, technicianName: r.tech_name || 'Unassigned',
      })),
      total,
      kpis: {
        totalAppointments: grand,
        today: Number(totalsRow?.today ?? 0),
        confirmedToday: Number(totalsRow?.confirmed_today ?? 0),
        onlineBookings: Number(totalsRow?.online ?? 0),
        walkIns: Number(totalsRow?.walk_in ?? 0),
        avgServiceMinutes: Number(totalsRow?.avg_dur ?? 0),
        noShowCount: Number(totalsRow?.no_show ?? 0),
        noShowRate: grand ? Math.round((Number(totalsRow?.no_show ?? 0) / grand) * 1000) / 10 : 0,
        completedToday: Number(totalsRow?.completed_today ?? 0),
        cancelledCount: Number(totalsRow?.cancelled ?? 0),
        pending: Number(totalsRow?.pending ?? 0),
        cancellationRate: grand ? Math.round((Number(totalsRow?.cancelled ?? 0) / grand) * 1000) / 10 : 0,
      },
      byStatus: statusAgg.map((s) => ({ status: s.status, count: Number(s.n) })),
      bySource: sourceAgg.map((s) => ({ source: s.source, count: Number(s.n) })),
      byTechnician: techAgg.filter((x) => x.name).map((s) => ({ name: s.name, count: Number(s.n) })),
      trend: trendAgg.map((t) => ({ date: t.d, count: Number(t.n) })),
      byBranch: branchAgg.filter((b) => b.branch).map((b) => ({ branch: b.branch, total: Number(b.total), confirmed: Number(b.confirmed), completed: Number(b.completed), cancelled: Number(b.cancelled), revenueCents: null })),
      topServices: svcAgg.map((s) => ({ service: s.service, count: Number(s.n) })),
      byHour: hourBuckets,
      byDay: dayAgg.map((d) => ({ date: d.d, total: Number(d.total), confirmed: Number(d.confirmed), pending: Number(d.pending), walkIns: Number(d.walk_ins), cancelled: Number(d.cancelled) })),
      oversight: { duplicateBookings: Number(dupRow?.n ?? 0), technicianConflicts: Number(confRow?.n ?? 0), failedDeposits: Number(depRow?.n ?? 0), missingContact: Number(contactRow?.n ?? 0), reminderFailures: Number(remFailRow?.n ?? 0) },
      walkInQueue: queueRows.map((qi) => ({ customerName: qi.customer_name || '—', priority: qi.priority || 'normal', status: qi.status, station: qi.station || null, techName: qi.tech_name || null, services: Array.isArray(qi.requested_services) ? qi.requested_services : (qi.requested_services ? [qi.requested_services] : []), waitMinutes: Math.max(0, Math.round(Number(qi.wait_min || 0))) })),
      recentActivity: recentAgg.map((a) => ({ customerName: a.customer_name || '—', status: a.status, source: a.source, at: a.updated_at, action: new Date(a.created_at).getTime() === new Date(a.updated_at).getTime() ? 'created' : 'updated' })),
    };
  }

  async platformCustomers(q: CustomersQuery) {
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rowsBase = () => {
      let qb: any = (this.db as any).selectFrom('customers as c')
        .leftJoin('tenants as t', 't.id', 'c.tenant_id')
        .leftJoin('branches as b', 'b.id', 'c.branch_id')
        .where('c.archived_at', 'is', null);
      if (q.status) qb = qb.where('c.status', '=', q.status);
      if (q.search) qb = qb.where((eb: any) => eb.or([eb('c.full_name', 'ilike', like(q.search!)), eb('c.phone_display', 'ilike', like(q.search!)), eb('c.email', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!))]));
      return qb;
    };
    const total = Number((await rowsBase().select(sql`count(distinct c.id)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    // Directory rows: loyalty (points/tier) + last visit + spend via correlated subselects on paid tickets (no join fan-out).
    const rows: any[] = await rowsBase().clearSelect().select([
      'c.id', 'c.full_name', 'c.phone_display', 'c.email', 'c.status', 'c.avatar_url', 'c.tenant_id', 't.display_name as tenant_name', 'b.name as branch_name',
      sql`(select points_balance from customer_loyalty_profiles lp where lp.customer_id = c.id order by points_balance desc limit 1)`.as('points_balance'),
      sql`(select loyalty_tier from customer_loyalty_profiles lp where lp.customer_id = c.id order by points_balance desc limit 1)`.as('loyalty_tier'),
      sql`(select max(paid_at) from tickets tk where tk.customer_id = c.id and tk.payment_status = 'paid')`.as('last_visit'),
      sql`(select coalesce(sum(total_cents),0) from tickets tk where tk.customer_id = c.id and tk.payment_status = 'paid')`.as('total_spent_cents'),
    ]).orderBy('c.created_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);

    const kpiRow: any = await sql`
      select count(*) filter (where archived_at is null)::int as total,
             count(*) filter (where archived_at is null and status='active')::int as active,
             count(*) filter (where archived_at is null and created_at >= date_trunc('month', current_date))::int as new_month
      from customers
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const loyaltyRow: any = await sql`
      select count(distinct customer_id)::int as members,
             count(distinct customer_id) filter (where loyalty_tier='VIP')::int as vip,
             coalesce(sum(total_earned_points),0)::bigint as issued,
             coalesce(sum(total_redeemed_points),0)::bigint as redeemed,
             count(distinct customer_id) filter (where points_balance > 0)::int as active_members
      from customer_loyalty_profiles
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const spendRow: any = await sql`
      select coalesce(sum(total_cents),0)::bigint as total_spent, count(*)::int as visits
      from tickets where payment_status='paid'
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    // Segmentation with a documented priority rule (Inactive > VIP > Loyalty > Regular) to avoid double-counting.
    const segRows: any[] = await sql`
      select seg, count(*)::int as n from (
        select case
          when c.status <> 'active' then 'Inactive'
          when lp.loyalty_tier = 'VIP' then 'VIP'
          when lp.customer_id is not null then 'Loyalty Members'
          else 'Regular' end as seg
        from customers c
        left join lateral (select customer_id, loyalty_tier from customer_loyalty_profiles l where l.customer_id = c.id order by points_balance desc limit 1) lp on true
        where c.archived_at is null
      ) s group by seg
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const branchRows: any[] = await sql`
      select coalesce(b.name,'—') as branch, count(*)::int as n
      from customers c left join branches b on b.id = c.branch_id
      where c.archived_at is null group by b.name order by n desc limit 8
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const growthRows: any[] = await sql`
      select to_char(date_trunc('month', created_at),'YYYY-MM') as m, count(*)::int as n
      from customers where archived_at is null and created_at >= date_trunc('month', current_date) - interval '11 months'
      group by 1 order by 1
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const topRows: any[] = await sql`
      select c.id, c.full_name, c.avatar_url, coalesce(sum(tk.total_cents),0)::bigint as spent
      from tickets tk join customers c on c.id = tk.customer_id
      where tk.payment_status='paid'
      group by c.id, c.full_name, c.avatar_url order by spent desc limit 5
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const csatRow: any = await sql`
      select count(*)::int as cnt, coalesce(round(avg(rating),1),0) as avg,
             count(*) filter (where rating>=4.5)::int as s5,
             count(*) filter (where rating>=3.5 and rating<4.5)::int as s4,
             count(*) filter (where rating>=2.5 and rating<3.5)::int as s3,
             count(*) filter (where rating>=1.5 and rating<2.5)::int as s2,
             count(*) filter (where rating<1.5)::int as s1
      from reviews
    `.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const actRows: any[] = await sql`
      select full_name as customer, updated_at,
             case when date_trunc('second',created_at)=date_trunc('second',updated_at) then 'created' else 'updated' end as action
      from customers where archived_at is null order by updated_at desc limit 6
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const signupRows: any[] = await sql`
      select c.full_name as customer, coalesce(b.name,'—') as branch, c.created_at
      from customers c left join branches b on b.id = c.branch_id
      where c.archived_at is null order by c.created_at desc limit 6
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const fbRows: any[] = await sql`
      select coalesce(c.full_name,'Guest') as customer, r.rating, r.comment, r.created_at
      from reviews r left join customers c on c.id = r.customer_id
      order by r.created_at desc limit 4
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const dupPhoneRow: any = await sql`select count(*)::int as n from (select tenant_id, normalized_phone from customers where archived_at is null and normalized_phone is not null and normalized_phone <> '' group by tenant_id, normalized_phone having count(*) > 1) d`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const dupEmailRow: any = await sql`select count(*)::int as n from (select tenant_id, lower(email) e from customers where archived_at is null and email is not null and email <> '' group by tenant_id, lower(email) having count(*) > 1) d`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const inactiveRow: any = await sql`select count(*)::int as n from customers where archived_at is null and status <> 'active'`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const visits = Number(spendRow?.visits || 0);
    return {
      rows: rows.map((r) => ({ id: r.id, fullName: r.full_name, phone: r.phone_display || null, email: r.email || null, status: r.status, avatarUrl: r.avatar_url || null, tenantId: r.tenant_id, tenantName: r.tenant_name || null, branchName: r.branch_name || null, pointsBalance: r.points_balance != null ? Number(r.points_balance) : null, loyaltyTier: r.loyalty_tier || null, lastVisit: r.last_visit || null, totalSpentCents: Number(r.total_spent_cents || 0) })),
      total,
      kpis: {
        totalCustomers: Number(kpiRow?.total || 0), activeCustomers: Number(kpiRow?.active || 0), newThisMonth: Number(kpiRow?.new_month || 0),
        loyaltyMembers: Number(loyaltyRow?.members || 0), vipCustomers: Number(loyaltyRow?.vip || 0),
        totalSpentCents: Number(spendRow?.total_spent || 0), avgVisitValueCents: visits > 0 ? Math.round(Number(spendRow.total_spent) / visits) : 0,
      },
      segmentation: segRows.map((s) => ({ segment: s.seg, count: Number(s.n) })),
      byBranch: branchRows.map((b) => ({ branch: b.branch, count: Number(b.n) })),
      growth: growthRows.map((g) => ({ month: g.m, count: Number(g.n) })),
      topSpending: topRows.map((t) => ({ id: t.id, name: t.full_name, avatarUrl: t.avatar_url || null, totalSpentCents: Number(t.spent || 0) })),
      retention: null, // honest gap: correct cohort retention needs a defined return window + eligibility model
      csat: { count: Number(csatRow?.cnt || 0), avg: Number(csatRow?.avg || 0), dist: [{ star: 5, n: Number(csatRow?.s5 || 0) }, { star: 4, n: Number(csatRow?.s4 || 0) }, { star: 3, n: Number(csatRow?.s3 || 0) }, { star: 2, n: Number(csatRow?.s2 || 0) }, { star: 1, n: Number(csatRow?.s1 || 0) }] },
      loyalty: { members: Number(loyaltyRow?.members || 0), pointsIssued: Number(loyaltyRow?.issued || 0), pointsRedeemed: Number(loyaltyRow?.redeemed || 0), redemptionValueCents: null, activeMembers: Number(loyaltyRow?.active_members || 0) },
      recentActivity: actRows.map((a) => ({ customer: a.customer, action: a.action, at: a.updated_at })),
      signups: signupRows.map((s) => ({ customer: s.customer, branch: s.branch, at: s.created_at })),
      feedback: fbRows.map((f) => ({ customer: f.customer, rating: Number(f.rating), comment: f.comment || '', at: f.created_at })),
      oversight: { duplicatePhones: Number(dupPhoneRow?.n || 0), duplicateEmails: Number(dupEmailRow?.n || 0), inactiveCustomers: Number(inactiveRow?.n || 0) },
    };
  }

  async mergeCustomers(input: { tenantId: string; sourceCustomerId: string; targetCustomerId: string; byUserId?: string }) {
    return this.db.transaction().execute(async (trx) => {
      const src: any = await (trx as any).selectFrom('customers').selectAll().where('id', '=', input.sourceCustomerId).where('tenant_id', '=', input.tenantId).where('archived_at', 'is', null).executeTakeFirst().catch(() => undefined);
      const tgt: any = await (trx as any).selectFrom('customers').select(['id']).where('id', '=', input.targetCustomerId).where('tenant_id', '=', input.tenantId).where('archived_at', 'is', null).executeTakeFirst().catch(() => undefined);
      if (!src || !tgt) return null; // a customer is missing / archived / cross-tenant → caller reports not_found, nothing written
      // Lineage snapshot for recovery (the doc's reversibility requirement): the full source record + counts of related
      // rows. Relationship reattribution (loyalty sum, ticket reassignment) is intentionally a separate tenant-confirmed
      // step — destructive and must be validated against live data — so this merge is non-destructive: the source is
      // archived + flagged 'merged' and everything needed to recover it lives in merge_summary_json.
      const counts: any = await sql`select
        (select count(*)::int from tickets where customer_id = ${input.sourceCustomerId}) as tickets,
        (select count(*)::int from reviews where customer_id = ${input.sourceCustomerId}) as reviews,
        (select count(*)::int from customer_loyalty_profiles where customer_id = ${input.sourceCustomerId}) as loyalty,
        (select count(*)::int from loyalty_redemptions where customer_id = ${input.sourceCustomerId}) as redemptions
      `.execute(trx).then((r: any) => r.rows[0]).catch(() => ({}));
      const snapshot = { source: src, relatedCounts: counts, mergedInto: input.targetCustomerId };
      const log: any = await (trx as any).insertInto('customer_merge_logs').values({
        id: sql`gen_random_uuid()`, tenant_id: input.tenantId, branch_id: src.branch_id,
        source_customer_id: input.sourceCustomerId, target_customer_id: input.targetCustomerId,
        merged_by_user_id: input.byUserId || null, merge_summary_json: JSON.stringify(snapshot),
      } as any).returning('id').executeTakeFirst().catch(() => undefined);
      await (trx as any).updateTable('customers').set({ archived_at: new Date(), status: 'merged', updated_at: new Date() } as any).where('id', '=', input.sourceCustomerId).execute();
      return { mergeLogId: log?.id || null, sourceArchived: true, snapshot };
    });
  }

  async mergeServiceCategories(input: { tenantId: string; sourceCategoryId: string; targetCategoryId: string; byUserId?: string }) {
    return this.db.transaction().execute(async (trx) => {
      const src: any = await (trx as any).selectFrom('service_categories').selectAll().where('id', '=', input.sourceCategoryId).where('tenant_id', '=', input.tenantId).executeTakeFirst().catch(() => undefined);
      const tgt: any = await (trx as any).selectFrom('service_categories').select(['id']).where('id', '=', input.targetCategoryId).where('tenant_id', '=', input.tenantId).executeTakeFirst().catch(() => undefined);
      // both categories must exist in the same tenant; a category already flagged 'merged' can't be a source again
      if (!src || !tgt || src.status === 'merged') return null;
      // count the services that will be reattributed (within the tenant, non-archived) — recorded for audit + recovery
      const cntRow: any = await sql`select count(*)::int as n from services where category_id = ${input.sourceCategoryId} and tenant_id = ${input.tenantId} and archived_at is null`.execute(trx).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
      const reattributed = Number(cntRow?.n || 0);
      const snapshot = { source: src, reattributedServiceCount: reattributed, mergedInto: input.targetCategoryId };
      // reattribute services onto the surviving category, then flag the source merged. Tenant-local taxonomy only —
      // this never touches another tenant's categories or services (§3 / tenant isolation).
      await (trx as any).updateTable('services').set({ category_id: input.targetCategoryId, updated_at: new Date() } as any).where('category_id', '=', input.sourceCategoryId).where('tenant_id', '=', input.tenantId).where('archived_at', 'is', null).execute();
      const log: any = await (trx as any).insertInto('service_category_merge_logs').values({
        id: sql`gen_random_uuid()`, tenant_id: input.tenantId, branch_id: src.branch_id || null,
        source_category_id: input.sourceCategoryId, target_category_id: input.targetCategoryId,
        reattributed_service_count: reattributed, merged_by_user_id: input.byUserId || null, merge_summary_json: JSON.stringify(snapshot),
      } as any).returning('id').executeTakeFirst().catch(() => undefined);
      await (trx as any).updateTable('service_categories').set({ status: 'merged', updated_at: new Date() } as any).where('id', '=', input.sourceCategoryId).where(canMoveToSql(SERVICE_CATEGORY, 'merged') as any).execute();
      return { mergeLogId: log?.id || null, reattributedServiceCount: reattributed, snapshot };
    });
  }

  async mergeProductCategories(input: { tenantId: string; sourceCategoryId: string; targetCategoryId: string; byUserId?: string }) {
    return this.db.transaction().execute(async (trx) => {
      const src: any = await (trx as any).selectFrom('inventory_categories').selectAll().where('id', '=', input.sourceCategoryId).where('tenant_id', '=', input.tenantId).executeTakeFirst().catch(() => undefined);
      const tgt: any = await (trx as any).selectFrom('inventory_categories').select(['id']).where('id', '=', input.targetCategoryId).where('tenant_id', '=', input.tenantId).executeTakeFirst().catch(() => undefined);
      // both categories must exist in the same tenant; a deactivated source (active=false) has already been merged/retired
      if (!src || !tgt || src.active === false) return null;
      const cntRow: any = await sql`select count(*)::int as n from inventory_products where category_id = ${input.sourceCategoryId} and tenant_id = ${input.tenantId} and archived_at is null`.execute(trx).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
      const reattributed = Number(cntRow?.n || 0);
      const snapshot = { source: src, reattributedProductCount: reattributed, mergedInto: input.targetCategoryId };
      // reattribute products onto the surviving category, then deactivate the source. Tenant-local only (§3 / isolation).
      await (trx as any).updateTable('inventory_products').set({ category_id: input.targetCategoryId, updated_at: new Date() } as any).where('category_id', '=', input.sourceCategoryId).where('tenant_id', '=', input.tenantId).where('archived_at', 'is', null).execute();
      const log: any = await (trx as any).insertInto('product_category_merge_logs').values({
        id: sql`gen_random_uuid()`, tenant_id: input.tenantId,
        source_category_id: input.sourceCategoryId, target_category_id: input.targetCategoryId,
        reattributed_product_count: reattributed, merged_by_user_id: input.byUserId || null, merge_summary_json: JSON.stringify(snapshot),
      } as any).returning('id').executeTakeFirst().catch(() => undefined);
      await (trx as any).updateTable('inventory_categories').set({ active: false, updated_at: new Date() } as any).where('id', '=', input.sourceCategoryId).execute();
      return { mergeLogId: log?.id || null, reattributedProductCount: reattributed, snapshot };
    });
  }

  // One tenant's own inventory categories (with id + live product count) — backs the same-tenant product-category MERGE
  // picker. Scoped strictly to the given tenant; never returns another tenant's taxonomy.
  async tenantProductCategories(tenantId: string) {
    const t: any = await sql`select display_name from tenants where id = ${tenantId}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const rows: any[] = await sql`
      select c.id, c.name, c.active, count(p.id)::int as product_count
      from inventory_categories c
      left join inventory_products p on p.category_id = c.id and p.tenant_id = c.tenant_id and p.archived_at is null
      where c.tenant_id = ${tenantId}
      group by c.id, c.name, c.active order by c.name asc
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return { tenantName: t?.display_name || null, categories: rows.map((r) => ({ id: r.id, name: r.name, active: !!r.active, productCount: Number(r.product_count || 0) })) };
  }

  async privacyRequests(q: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const base = () => {
      let qb: any = (this.db as any).selectFrom('customer_privacy_requests as p').leftJoin('tenants as t', 't.id', 'p.tenant_id');
      if (q.status === 'overdue') qb = qb.where('p.status', 'not in', ['completed', 'rejected', 'cancelled']).where('p.due_at', '<', sql`now()`);
      else if (q.status) qb = qb.where('p.status', '=', q.status);
      return qb;
    };
    const total = Number((await base().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const rows: any[] = await base().clearSelect().select([
      'p.id', 'p.request_type', 'p.status', 'p.requester_name', 'p.scope', 'p.legal_basis', 'p.due_at', 'p.completed_at',
      'p.customer_id', 'p.tenant_id', 't.display_name as tenant_name', 'p.created_at',
    ]).orderBy('p.created_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    const byStatus: any[] = await sql`select status, count(*)::int as n from customer_privacy_requests group by status`.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const overdueRow: any = await sql`select count(*)::int as n from customer_privacy_requests where status not in ('completed','rejected','cancelled') and due_at is not null and due_at < now()`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const grand: any = await sql`select count(*)::int as n from customer_privacy_requests`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const now = Date.now();
    return {
      rows: rows.map((r) => ({ id: r.id, requestType: r.request_type, status: r.status, requesterName: r.requester_name || '—', scope: r.scope || null, legalBasis: r.legal_basis || null, dueAt: r.due_at || null, completedAt: r.completed_at || null, customerId: r.customer_id || null, tenantId: r.tenant_id, tenantName: r.tenant_name || null, createdAt: r.created_at, overdue: !!r.due_at && !['completed', 'rejected', 'cancelled'].includes(r.status) && new Date(r.due_at).getTime() < now })),
      total,
      kpis: { total: Number(grand?.n || 0), overdue: Number(overdueRow?.n || 0), byStatus: byStatus.map((s) => ({ status: s.status, count: Number(s.n) })) },
    };
  }

  async createPrivacyRequest(i: { tenantId: string; customerId?: string; requestType: string; requesterName?: string; requesterContact?: string; scope?: string; legalBasis?: string; dueAt: Date; byUserId?: string }) {
    const hist = [{ at: new Date().toISOString(), by: i.byUserId || null, action: 'created', status: 'new' }];
    const r = await (this.db as any).insertInto('customer_privacy_requests').values({
      id: sql`gen_random_uuid()`, tenant_id: i.tenantId, customer_id: i.customerId || null, request_type: i.requestType, status: 'new',
      requester_name: i.requesterName || null, requester_contact: i.requesterContact || null, scope: i.scope || null, legal_basis: i.legalBasis || null,
      due_at: i.dueAt, created_by_user_id: i.byUserId || null, action_history: JSON.stringify(hist),
    } as any).returningAll().executeTakeFirst().catch(() => undefined);
    return r ?? null;
  }

  async setPrivacyRequestStatus(i: { id: string; status: string; note?: string; byUserId?: string }) {
    return this.db.transaction().execute(async (trx) => {
      const cur: any = await (trx as any).selectFrom('customer_privacy_requests').selectAll().where('id', '=', i.id).executeTakeFirst().catch(() => undefined);
      if (!cur) return null;
      const hist = Array.isArray(cur.action_history) ? cur.action_history : [];
      hist.push({ at: new Date().toISOString(), by: i.byUserId || null, action: 'status_change', from: cur.status, to: i.status, note: i.note || null });
      const patch: any = { status: i.status, action_history: JSON.stringify(hist), updated_at: new Date() };
      if (['completed', 'rejected', 'cancelled'].includes(i.status)) patch.completed_at = new Date();
      // Phase 12 (#27): through CUSTOMER_PRIVACY_REQUEST, conditional on the status read above (a closed request stays closed)
      const r = await (trx as any).updateTable('customer_privacy_requests').set(patch).where('id', '=', i.id).where('status', '=', cur.status).where(canMoveToSql(CUSTOMER_PRIVACY_REQUEST, i.status) as any).returningAll().executeTakeFirst().catch(() => undefined);
      return r ?? null;
    });
  }

  async customerDuplicates(q: CustomersQuery) {
    const rows: any[] = await sql`
      with dups as (
        select tenant_id, normalized_phone as key, 'phone'::text as kind
        from customers where archived_at is null and normalized_phone is not null and normalized_phone <> ''
        group by tenant_id, normalized_phone having count(*) > 1
        union all
        select tenant_id, lower(email) as key, 'email'::text as kind
        from customers where archived_at is null and email is not null and email <> ''
        group by tenant_id, lower(email) having count(*) > 1
      )
      select d.kind, d.key, c.id, c.full_name, c.phone_display, c.email, c.status, c.tenant_id,
             t.display_name as tenant_name, b.name as branch_name, c.created_at
      from dups d
      join customers c on c.tenant_id = d.tenant_id
        and ((d.kind = 'phone' and c.normalized_phone = d.key) or (d.kind = 'email' and lower(c.email) = d.key))
      left join tenants t on t.id = c.tenant_id
      left join branches b on b.id = c.branch_id
      where c.archived_at is null
      order by d.kind, d.key, c.created_at
      limit 400
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const cases = groupCustomerDuplicates(rows);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    return { cases: cases.slice((page - 1) * ps, (page - 1) * ps + ps), total: cases.length };
  }

  async platformPayments(q: PaymentsQuery) {
    // NOTE: q.tenantId narrows the Overview-consumed outputs only (this method's primary rows/KPIs). The
    // dedicated-screen distributions below stay platform-wide; the only scoped caller is the Overview aggregate.

    const base = () => {
      let qb: any = (this.db as any).selectFrom('payments as pm')
        .leftJoin('tenants as t', 't.id', 'pm.tenant_id');
      if (q.status) qb = qb.where('pm.status', '=', q.status);
      if (q.method) qb = qb.where('pm.method', '=', q.method);
      if (q.processor) qb = qb.where('pm.processor', '=', q.processor);
      if (q.search) qb = qb.where((eb: any) => eb.or([eb('pm.processor_transaction_id', 'ilike', like(q.search!)), eb('pm.processor_reference_id', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!))]));
      return qb;
    };
    const total = Number((await base().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rows: any[] = await base().clearSelect().select([
      'pm.id', 'pm.method', 'pm.amount_cents', 'pm.tip_cents', 'pm.surcharge_cents', 'pm.status', 'pm.processor',
      'pm.processor_transaction_id', 'pm.approved_at', 'pm.failed_at', 'pm.created_at', 'pm.tenant_id', 't.display_name as tenant_name',
    ]).orderBy('pm.created_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    // platform-wide rollups (approved_at is the robust "successful capture" signal)
    const totalsRow: any = await (this.db as any).selectFrom('payments').$if(!!q.tenantId, (qb: any) => qb.where('tenant_id', '=', q.tenantId)).select([
      sql`count(*)`.as('total'),
      sql`count(*) filter (where approved_at is not null)`.as('successful'),
      sql`count(*) filter (where failed_at is not null)`.as('failed'),
      sql`count(*) filter (where created_at::date = current_date)`.as('today_count'),
      sql`coalesce(sum(amount_cents) filter (where approved_at is not null),0)`.as('volume'),
      sql`coalesce(sum(amount_cents) filter (where approved_at is not null and created_at::date = current_date),0)`.as('today_volume'),
      sql`coalesce(sum(tip_cents) filter (where approved_at is not null),0)`.as('tips'),
    ]).executeTakeFirst().catch(() => ({}));
    const methodAgg: any[] = await (this.db as any).selectFrom('payments').where('approved_at', 'is not', null)
      .select(['method', sql`count(*)`.as('n'), sql`coalesce(sum(amount_cents),0)`.as('cents')]).groupBy('method').orderBy('cents', 'desc').execute().catch(() => []);
    const procAgg: any[] = await (this.db as any).selectFrom('payments').where('approved_at', 'is not', null)
      .select(['processor', sql`count(*)`.as('n'), sql`coalesce(sum(amount_cents),0)`.as('cents')]).groupBy('processor').orderBy('cents', 'desc').execute().catch(() => []);
    const statusAgg: any[] = await (this.db as any).selectFrom('payments').select(['status', sql`count(*)`.as('n')]).groupBy('status').orderBy('n', 'desc').execute().catch(() => []);
    const refundRow: any = await (this.db as any).selectFrom('payment_refunds').$if(!!q.tenantId, (qb: any) => qb.where('tenant_id', '=', q.tenantId))
      .select([sql`count(*)`.as('n'), sql`coalesce(sum(amount_cents),0)`.as('cents'), sql`count(*) filter (where created_at >= date_trunc('month', current_date))`.as('month_n'), sql`coalesce(sum(amount_cents) filter (where created_at >= date_trunc('month', current_date)),0)`.as('month_cents'), sql`coalesce(sum(amount_cents) filter (where created_at::date = current_date),0)`.as('today_cents')]).executeTakeFirst().catch(() => ({}));
    // branch payment performance (real; payments ⋈ branches)
    const branchAgg: any[] = await (this.db as any).selectFrom('payments as p').leftJoin('branches as b', 'b.id', 'p.branch_id')
      .select(['b.name as branch', sql`count(*)`.as('txns'), sql`coalesce(sum(p.amount_cents) filter (where p.approved_at is not null),0)`.as('volume'), sql`count(*) filter (where p.approved_at is not null)`.as('ok')])
      .groupBy('b.name').orderBy('volume', 'desc').limit(12).execute().catch(() => []);
    // payment by hour-of-day (real)
    const hourAgg: any[] = await (this.db as any).selectFrom('payments').where('approved_at', 'is not', null)
      .select([sql`extract(hour from created_at)`.as('hour'), sql`count(*)`.as('n'), sql`coalesce(sum(amount_cents),0)`.as('cents')]).groupBy(sql`extract(hour from created_at)`).execute().catch(() => []);
    // terminal / device payment health (real; pos_payment_terminals.branch_id is TEXT, so resolve branch via JS map — never SQL-join uuid=text)
    const termBranches: any[] = await (this.db as any).selectFrom('branches').select(['id', 'name']).execute().catch(() => []);
    const termBranchMap = new Map<string, string>(termBranches.map((b: any) => [String(b.id), b.name]));
    const terminalRows: any[] = await (this.db as any).selectFrom('pos_payment_terminals')
      .select(['label', 'status', 'paired_at', 'branch_id']).orderBy('label', 'asc').limit(12).execute().catch(() => []);
    // recent payment activity (real)
    const payRecentAgg: any[] = await (this.db as any).selectFrom('payments as p3').leftJoin('tenants as t3', 't3.id', 'p3.tenant_id')
      .select(['p3.method', 'p3.amount_cents', 'p3.status', 'p3.created_at', 'p3.approved_at', 'p3.failed_at', 't3.display_name as tenant_name']).orderBy('p3.created_at', 'desc').limit(6).execute().catch(() => []);
    // monthly processed volume last 6 months (real)
    const monthlyAgg: any[] = await (this.db as any).selectFrom('payments').where('approved_at', 'is not', null).where('created_at', '>=', sql`date_trunc('month', current_date) - interval '5 months'`)
      .select([sql`to_char(date_trunc('month', created_at), 'Mon')`.as('month'), sql`count(*)`.as('n'), sql`coalesce(sum(amount_cents),0)`.as('cents')]).groupBy(sql`date_trunc('month', created_at)`).orderBy(sql`date_trunc('month', created_at)`).execute().catch(() => []);
    const grand = Number(totalsRow?.total ?? 0); const successful = Number(totalsRow?.successful ?? 0); const volume = Number(totalsRow?.volume ?? 0);
    const todayVol = Number(totalsRow?.today_volume ?? 0); const todayRef = Number(refundRow?.today_cents ?? 0);
    const activeTerminals = terminalRows.filter((t) => ['active', 'paired', 'online', 'connected'].includes(String(t.status || '').toLowerCase())).length;
    const hourBuckets = Array.from({ length: 24 }, (_, h) => { const r = hourAgg.find((x) => Number(x.hour) === h); return { hour: h, count: r ? Number(r.n) : 0, cents: r ? Number(r.cents) : 0 }; });
    return {
      rows: rows.map((r) => ({
        id: r.id, method: r.method, amountCents: r.amount_cents || 0, tipCents: r.tip_cents || 0, surchargeCents: r.surcharge_cents || 0,
        status: r.status, processor: r.processor || null, reference: r.processor_transaction_id || null,
        approved: !!r.approved_at, failed: !!r.failed_at, createdAt: r.created_at, tenantId: r.tenant_id, tenantName: r.tenant_name || null,
      })),
      total,
      kpis: {
        processedVolumeCents: volume,
        todayVolumeCents: todayVol,
        todayCount: Number(totalsRow?.today_count ?? 0),
        successfulCount: successful,
        failedCount: Number(totalsRow?.failed ?? 0),
        averageTicketCents: successful ? Math.round(volume / successful) : 0,
        tipsCents: Number(totalsRow?.tips ?? 0),
        successRate: grand ? Math.round((successful / grand) * 1000) / 10 : 0,
        refundCount: Number(refundRow?.n ?? 0),
        refundCentsMonth: Number(refundRow?.month_cents ?? 0),
        refundCentsToday: todayRef,
        refundRatePct: successful ? Math.round((Number(refundRow?.n ?? 0) / successful) * 1000) / 10 : 0,
        netRevenueTodayCents: todayVol - todayRef,
        topMethod: methodAgg[0]?.method ?? null,
        topMethodCents: methodAgg[0]?.cents ? Number(methodAgg[0].cents) : 0,
        activeTerminals,
        terminalCount: terminalRows.length,
      },
      byMethod: methodAgg.map((m) => ({ method: m.method, count: Number(m.n), cents: Number(m.cents) })),
      byProcessor: procAgg.map((m) => ({ processor: m.processor || 'unknown', count: Number(m.n), cents: Number(m.cents) })),
      byStatus: statusAgg.map((s) => ({ status: s.status, count: Number(s.n) })),
      byBranch: branchAgg.filter((b) => b.branch).map((b) => ({ branch: b.branch, volumeCents: Number(b.volume), transactions: Number(b.txns), successRate: Number(b.txns) ? Math.round((Number(b.ok) / Number(b.txns)) * 1000) / 10 : 0 })),
      byHour: hourBuckets,
      terminals: terminalRows.map((t) => ({ label: t.label || '—', status: t.status || 'unknown', branch: termBranchMap.get(String(t.branch_id)) || null, pairedAt: t.paired_at || null })),
      recentActivity: payRecentAgg.map((a) => ({ method: a.method, amountCents: Number(a.amount_cents || 0), status: a.status, at: a.created_at, kind: a.approved_at ? 'approved' : a.failed_at ? 'failed' : 'pending', tenantName: a.tenant_name || null })),
      monthly: monthlyAgg.map((m) => ({ month: m.month, count: Number(m.n), cents: Number(m.cents) })),
    };
  }

  // Dedicated aggregate for the Super Admin Payments & Transactions screen. Reuses the `payments` table + payments-core
  // helpers. KPIs are computed over the SAME filter scope as the table so they reconcile. No PAN is ever selected — the
  // masked card comes from customer_payment_methods (brand/last4) only. Settlement per-transaction has no source column
  // (settlements are batch-level), so it is derived coarsely from status and otherwise reported honestly as Unknown.
  async paymentsTransactions(q: PaymentsTxnQuery) {
    const db: any = this.db as any;
    // scope predicate shared by table + KPIs (everything except pagination/sort)
    const scoped = () => {
      let qb: any = db.selectFrom('payments as pm').leftJoin('tenants as t', 't.id', 'pm.tenant_id').leftJoin('tickets as tk', 'tk.id', 'pm.ticket_id').leftJoin('customers as c', 'c.id', 'tk.customer_id');
      if (q.tenantId) qb = qb.where('pm.tenant_id', '=', q.tenantId);
      if (q.branchId) qb = qb.where('pm.branch_id', '=', q.branchId);
      if (q.customerId) qb = qb.where('tk.customer_id', '=', q.customerId);
      if (q.method) qb = qb.where('pm.method', '=', q.method);
      if (q.status) {
        const s = q.status.toLowerCase();
        if (s === 'approved') qb = qb.where('pm.approved_at', 'is not', null);
        else if (s === 'declined' || s === 'failed') qb = qb.where('pm.failed_at', 'is not', null);
        else qb = qb.where('pm.status', '=', q.status);
      }
      if (q.startDate) qb = qb.where('pm.created_at', '>=', sql`${q.startDate}::date`);
      if (q.endDate) qb = qb.where('pm.created_at', '<', sql`(${q.endDate}::date + interval '1 day')`);
      if (q.refundStatus) {
        const r = q.refundStatus.toLowerCase();
        if (r === 'no refund' || r === 'none') qb = qb.where((eb: any) => eb.not(eb.exists(db.selectFrom('payment_refunds as pr0').whereRef('pr0.payment_id', '=', 'pm.id').select(sql`1`.as('x')))));
        else qb = qb.where((eb: any) => eb.exists(db.selectFrom('payment_refunds as pr0').whereRef('pr0.payment_id', '=', 'pm.id').select(sql`1`.as('x'))));
      }
      if (q.search) {
        const s = like(q.search);
        qb = qb.where((eb: any) => eb.or([eb(sql`pm.id::text`, 'ilike', s), eb('pm.processor_transaction_id', 'ilike', s), eb('pm.processor_reference_id', 'ilike', s), eb('t.display_name', 'ilike', s), eb('c.full_name', 'ilike', s), eb('c.email', 'ilike', s)]));
      }
      return qb;
    };

    const total = Number((await scoped().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 10);
    const sortCol = ({ amount: 'pm.amount_cents', date: 'pm.created_at', status: 'pm.status' } as Record<string, string>)[q.sort || 'date'] || 'pm.created_at';
    const dir = (q.direction || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const rows: any[] = await scoped().select([
      'pm.id', 'pm.tenant_id', 't.display_name as tenant_name', 'pm.branch_id', 'pm.method', 'pm.amount_cents', 'pm.tip_cents', 'pm.tax_cents',
      'pm.discount_cents', 'pm.surcharge_cents', 'pm.status', 'pm.processor', 'pm.processor_reference_id', 'pm.processor_transaction_id',
      'pm.approved_at', 'pm.failed_at', 'pm.created_at', 'tk.customer_id', 'c.full_name as customer_name', 'c.email as customer_email', 'c.phone_display as customer_phone',
      db.selectFrom('branches as b').whereRef('b.id', '=', 'pm.branch_id').select('b.name').limit(1).as('branch_name'),
      db.selectFrom('tenant_payment_config as cfg').whereRef('cfg.tenant_id', '=', 'pm.tenant_id').select('cfg.merchant_id').limit(1).as('merchant_id'),
      db.selectFrom('customer_payment_methods as cpm').whereRef('cpm.customer_id', '=', 'tk.customer_id').select('cpm.brand').orderBy('cpm.created_at', 'desc').limit(1).as('card_brand'),
      db.selectFrom('customer_payment_methods as cpm2').whereRef('cpm2.customer_id', '=', 'tk.customer_id').select('cpm2.last4').orderBy('cpm2.created_at', 'desc').limit(1).as('card_last4'),
      db.selectFrom('payment_refunds as pr').whereRef('pr.payment_id', '=', 'pm.id').select(sql`coalesce(sum(amount_cents),0)`.as('r')).as('refunded_cents'),
    ]).orderBy(sortCol as any, dir as any).limit(ps).offset((page - 1) * ps).execute().catch(() => []);

    // KPIs over the same scope (reconcile with the table). approved_at/failed_at are the robust capture signals.
    const agg: any = await scoped().select([
      sql`count(*)`.as('total'),
      sql`count(*) filter (where pm.approved_at is not null)`.as('approved'),
      sql`count(*) filter (where pm.failed_at is not null)`.as('failed'),
      sql`coalesce(sum(pm.amount_cents) filter (where pm.approved_at is not null),0)`.as('volume_cents'),
      sql`coalesce(sum(pm.surcharge_cents) filter (where pm.approved_at is not null),0)`.as('fees_cents'),
      sql`count(*) filter (where pm.status = 'settled')`.as('settled'),
      sql`count(*) filter (where pm.status = 'voided')`.as('voided'),
    ]).executeTakeFirst().catch(() => ({}));
    const refundCount = Number((await scoped().clearSelect().innerJoin('payment_refunds as prc', 'prc.payment_id', 'pm.id').select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    // duplicate ALERTS (heuristic, documented): same tenant+branch+amount+method on the same day, more than once. Same
    // amount alone is NOT treated as proof — this is an alert count for review, never an automatic refund/void.
    const dupRow: any = await scoped().clearSelect().select(['pm.tenant_id', 'pm.branch_id', 'pm.amount_cents', 'pm.method', sql`date_trunc('day', pm.created_at)`.as('d')])
      .groupBy(['pm.tenant_id', 'pm.branch_id', 'pm.amount_cents', 'pm.method', sql`date_trunc('day', pm.created_at)`]).having(sql`count(*)`, '>', 1).execute().catch(() => []);
    const kpiRaw = {
      total: Number(agg?.total ?? 0), approved: Number(agg?.approved ?? 0), failed: Number(agg?.failed ?? 0),
      volumeCents: Number(agg?.volume_cents ?? 0), processingFeesCents: Number(agg?.fees_cents ?? 0),
      settledCount: Number(agg?.settled ?? 0), refundVoidCount: refundCount + Number(agg?.voided ?? 0), duplicateAlerts: dupRow.length,
    };

    // Top Payment Methods (approved volume by method)
    const byMethod: any[] = await scoped().clearSelect().where('pm.approved_at', 'is not', null).select(['pm.method', sql`count(*)`.as('n'), sql`coalesce(sum(pm.amount_cents),0)`.as('cents')]).groupBy('pm.method').orderBy('cents', 'desc').execute().catch(() => []);
    // Payment Volume Trend — last 7 days of approved volume within scope
    const trend: any[] = await scoped().clearSelect().where('pm.approved_at', 'is not', null).where('pm.created_at', '>=', sql`current_date - interval '6 days'`)
      .select([sql`pm.created_at::date`.as('day'), sql`coalesce(sum(pm.amount_cents),0)`.as('cents')]).groupBy(sql`pm.created_at::date`).orderBy(sql`pm.created_at::date`).execute().catch(() => []);
    // Failed Payments list (recent) — failure reason kept to the safe status label only
    const failed: any[] = await scoped().clearSelect().where('pm.failed_at', 'is not', null).select(['pm.id', 'pm.amount_cents', 'pm.status', 'pm.created_at']).orderBy('pm.created_at', 'desc').limit(6).execute().catch(() => []);
    // Processor & Sync Status — last gateway event per processor (real heartbeat)
    const processors: any[] = await db.selectFrom('payment_gateway_events').select(['processor_type', sql`max(created_at)`.as('last_at'), sql`count(*)`.as('n')]).groupBy('processor_type').orderBy('last_at', 'desc').limit(8).execute().catch(() => []);

    return {
      total,
      rows: rows.map((r) => ({
        id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name || null, branch: r.branch_name || null,
        merchantId: r.merchant_id || null, customerId: r.customer_id || null, customerName: r.customer_name || null,
        customerEmail: r.customer_email || null, customerPhone: r.customer_phone || null,
        amountCents: Number(r.amount_cents || 0), tipCents: Number(r.tip_cents || 0), taxCents: Number(r.tax_cents || 0),
        discountCents: Number(r.discount_cents || 0), surchargeCents: Number(r.surcharge_cents || 0),
        method: r.method, cardBrand: r.card_brand || null, cardLast4: r.card_last4 || null, status: r.status,
        approved: !!r.approved_at, failed: !!r.failed_at, processor: r.processor || null,
        reference: r.processor_reference_id || r.processor_transaction_id || null,
        refundedCents: Number(r.refunded_cents || 0), createdAt: r.created_at,
      })),
      kpiRaw,
      byMethod: byMethod.map((m) => ({ method: m.method || 'other', count: Number(m.n), cents: Number(m.cents) })),
      trend: trend.map((d) => ({ day: d.day, cents: Number(d.cents) })),
      failed: failed.map((f) => ({ id: f.id, amountCents: Number(f.amount_cents || 0), reason: f.status || 'failed', createdAt: f.created_at })),
      processors: processors.map((p) => ({ processor: p.processor_type, lastSyncAt: p.last_at || null, events: Number(p.n) })),
    };
  }

  // Single transaction detail (masked). No PAN — only brand/last4/token. Customer email/phone returned raw here; the
  // service masks them unless the caller holds the customer-details permission.
  async paymentTransactionDetail(id: string) {
    const db: any = this.db as any;
    const r: any = await db.selectFrom('payments as pm').leftJoin('tenants as t', 't.id', 'pm.tenant_id').leftJoin('tickets as tk', 'tk.id', 'pm.ticket_id').leftJoin('customers as c', 'c.id', 'tk.customer_id')
      .where('pm.id', '=', id).select([
        'pm.id', 'pm.tenant_id', 't.display_name as tenant_name', 'pm.branch_id', 'pm.method', 'pm.amount_cents', 'pm.tip_cents', 'pm.tax_cents',
        'pm.discount_cents', 'pm.surcharge_cents', 'pm.status', 'pm.processor', 'pm.processor_reference_id', 'pm.processor_transaction_id',
        'pm.approved_at', 'pm.failed_at', 'pm.created_at', 'tk.customer_id', 'c.full_name as customer_name', 'c.email as customer_email', 'c.phone_display as customer_phone',
        db.selectFrom('branches as b').whereRef('b.id', '=', 'pm.branch_id').select('b.name').limit(1).as('branch_name'),
        db.selectFrom('tenant_payment_config as cfg').whereRef('cfg.tenant_id', '=', 'pm.tenant_id').select('cfg.merchant_id').limit(1).as('merchant_id'),
        db.selectFrom('customer_payment_methods as cpm').whereRef('cpm.customer_id', '=', 'tk.customer_id').select('cpm.brand').orderBy('cpm.created_at', 'desc').limit(1).as('card_brand'),
        db.selectFrom('customer_payment_methods as cpm2').whereRef('cpm2.customer_id', '=', 'tk.customer_id').select('cpm2.last4').orderBy('cpm2.created_at', 'desc').limit(1).as('card_last4'),
        db.selectFrom('payment_refunds as pr').whereRef('pr.payment_id', '=', 'pm.id').select(sql`coalesce(sum(amount_cents),0)`.as('r')).as('refunded_cents'),
      ]).executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    return {
      id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name || null, branch: r.branch_name || null, merchantId: r.merchant_id || null,
      customerId: r.customer_id || null, customerName: r.customer_name || null, customerEmail: r.customer_email || null, customerPhone: r.customer_phone || null,
      amountCents: Number(r.amount_cents || 0), tipCents: Number(r.tip_cents || 0), taxCents: Number(r.tax_cents || 0), discountCents: Number(r.discount_cents || 0),
      surchargeCents: Number(r.surcharge_cents || 0), method: r.method, cardBrand: r.card_brand || null, cardLast4: r.card_last4 || null, status: r.status,
      approved: !!r.approved_at, failed: !!r.failed_at, processor: r.processor || null, reference: r.processor_reference_id || r.processor_transaction_id || null,
      refundedCents: Number(r.refunded_cents || 0), createdAt: r.created_at,
    };
  }

  // Authorization / processor event history for one payment (§22), read from the real, safe payment_gateway_events log
  // (labels + correlation ids + signature-valid only — no payloads, no secrets, no card data). Returns null if the
  // payment does not exist (→ 404); an empty events array is an honest "no processor events recorded yet".
  async paymentAuthorizationHistory(id: string) {
    const db: any = this.db as any;
    const exists = await db.selectFrom('payments').where('id', '=', id).select('id').executeTakeFirst().catch(() => undefined);
    if (!exists) return null;
    const events: any[] = await db.selectFrom('payment_gateway_events')
      .where('matched_payment_id', '=', id)
      .select(['event_type', 'processor_type', 'processor_transaction_id', 'event_id', 'signature_valid', 'processed_at', 'created_at'])
      .orderBy('created_at', 'asc').limit(200).execute().catch(() => []);
    return { events };
  }

  async platformReportExports(q: ReportExportsQuery) {
    const base = () => {
      let qb: any = (this.db as any).selectFrom('report_exports as re')
        .leftJoin('tenants as t', 't.id', 're.tenant_id');
      if (q.reportKey) qb = qb.where('re.report_key', '=', q.reportKey);
      if (q.format) qb = qb.where('re.format', '=', q.format);
      if (q.search) qb = qb.where((eb: any) => eb.or([eb('re.report_key', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!))]));
      return qb;
    };
    const total = Number((await base().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rows: any[] = await base().clearSelect().select([
      're.id', 're.report_key', 're.format', 're.start_date', 're.end_date', 're.file_url', 're.role', 're.created_at',
      're.tenant_id', 't.display_name as tenant_name',
    ]).orderBy('re.created_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    const typeAgg: any[] = await (this.db as any).selectFrom('report_exports').select(['report_key', sql`count(*)`.as('n')]).groupBy('report_key').orderBy('n', 'desc').execute().catch(() => []);
    const formatAgg: any[] = await (this.db as any).selectFrom('report_exports').select(['format', sql`count(*)`.as('n')]).groupBy('format').orderBy('n', 'desc').execute().catch(() => []);
    const totalsRow: any = await (this.db as any).selectFrom('report_exports').select([
      sql`count(*)`.as('total'),
      sql`count(*) filter (where created_at >= date_trunc('month', current_date))`.as('this_month'),
      sql`count(distinct report_key)`.as('report_types'),
      sql`count(distinct tenant_id)`.as('tenants'),
    ]).executeTakeFirst().catch(() => ({}));
    const monthAgg: any[] = await (this.db as any).selectFrom('report_exports').select([sql`to_char(date_trunc('month', created_at),'Mon')`.as('month'), sql`to_char(date_trunc('month', created_at),'YYYY-MM')`.as('sort_key'), sql`count(*)`.as('n')]).groupBy(sql`date_trunc('month', created_at)`).orderBy(sql`date_trunc('month', created_at)`).execute().catch(() => []);
    const activityRows: any[] = await (this.db as any).selectFrom('report_exports as re').leftJoin('tenants as t', 't.id', 're.tenant_id').select(['re.report_key', 're.format', 're.created_at', 't.display_name as tenant_name']).orderBy('re.created_at', 'desc').limit(6).execute().catch(() => []);
    return {
      rows: rows.map((r) => ({
        id: r.id, reportKey: r.report_key, format: r.format || null, startDate: r.start_date, endDate: r.end_date,
        fileUrl: r.file_url || null, role: r.role || null, createdAt: r.created_at, tenantId: r.tenant_id, tenantName: r.tenant_name || null,
      })),
      total,
      kpis: {
        totalReports: Number(totalsRow?.total ?? 0),
        reportsThisMonth: Number(totalsRow?.this_month ?? 0),
        reportTypes: Number(totalsRow?.report_types ?? 0),
        tenantsCovered: Number(totalsRow?.tenants ?? 0),
      },
      byReportType: typeAgg.map((s) => ({ reportKey: s.report_key, count: Number(s.n) })),
      byFormat: formatAgg.map((s) => ({ format: s.format || 'unknown', count: Number(s.n) })),
      byMonth: monthAgg.slice(-6).map((s) => ({ month: String(s.month), count: Number(s.n) })),
      recentActivity: activityRows.map((r) => ({ reportKey: r.report_key, format: r.format || null, tenantName: r.tenant_name || null, createdAt: r.created_at })),
    };
  }
  async platformReminders(q: RemindersQuery) {
    // delivery-log feed (the richest reminder/notification signal): channel, template, status, masked target
    const base = () => {
      let qb: any = (this.db as any).selectFrom('notification_delivery_logs as ndl')
        .leftJoin('tenants as t', 't.id', 'ndl.tenant_id');
      if (q.channel) qb = qb.where('ndl.channel', '=', q.channel);
      if (q.status) qb = qb.where('ndl.status', '=', q.status);
      if (q.search) qb = qb.where((eb: any) => eb.or([eb('ndl.template', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!))]));
      return qb;
    };
    const total = Number((await base().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rows: any[] = await base().clearSelect().select([
      'ndl.id', 'ndl.channel', 'ndl.template', 'ndl.target_masked', 'ndl.status', 'ndl.error_message', 'ndl.created_at',
      'ndl.tenant_id', 't.display_name as tenant_name',
    ]).orderBy('ndl.created_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    const chAgg: any[] = await (this.db as any).selectFrom('notification_delivery_logs').select(['channel', sql`count(*)`.as('n')]).groupBy('channel').orderBy('n', 'desc').execute().catch(() => []);
    const stAgg: any[] = await (this.db as any).selectFrom('notification_delivery_logs').select(['status', sql`count(*)`.as('n')]).groupBy('status').orderBy('n', 'desc').execute().catch(() => []);
    const deliv: any = await (this.db as any).selectFrom('notification_delivery_logs').select([
      sql`count(*)`.as('total'),
      sql`count(*) filter (where status in ('delivered','sent','ok'))`.as('delivered'),
      sql`count(*) filter (where status in ('failed','error','bounced'))`.as('failed'),
    ]).executeTakeFirst().catch(() => ({}));
    // reminder configuration adoption across tenants
    const settings: any = await (this.db as any).selectFrom('reminder_settings').select([
      sql`count(*)`.as('configured'),
      sql`count(*) filter (where enabled = true)`.as('enabled'),
      sql`coalesce(round(avg(lead_minutes)),0)`.as('avg_lead'),
    ]).executeTakeFirst().catch(() => ({}));
    const settingsByChannel: any[] = await (this.db as any).selectFrom('reminder_settings').where('enabled', '=', true).select(['channel', sql`count(*)`.as('n')]).groupBy('channel').orderBy('n', 'desc').execute().catch(() => []);
    const dayAgg: any[] = await (this.db as any).selectFrom('notification_delivery_logs').where('created_at', '>=', sql`current_date - interval '13 days'`).select([sql`to_char(created_at::date,'YYYY-MM-DD')`.as('d'), sql`count(*)`.as('n'), sql`count(*) filter (where status in ('delivered','sent','ok'))`.as('delivered')]).groupBy(sql`created_at::date`).orderBy(sql`created_at::date`).execute().catch(() => []);
    const sent: any = await (this.db as any).selectFrom('appointment_reminders_sent').select([
      sql`count(*)`.as('total'),
      sql`count(*) filter (where reminded_at >= date_trunc('month', current_date))`.as('this_month'),
    ]).executeTakeFirst().catch(() => ({}));
    const totalLogs = Number(deliv?.total ?? 0); const delivered = Number(deliv?.delivered ?? 0);
    return {
      rows: rows.map((r) => ({
        id: r.id, channel: r.channel, template: r.template || null, targetMasked: r.target_masked || null,
        status: r.status, errorMessage: r.error_message || null, createdAt: r.created_at, tenantId: r.tenant_id, tenantName: r.tenant_name || null,
      })),
      total,
      kpis: {
        appointmentRemindersSent: Number(sent?.total ?? 0),
        remindersSentThisMonth: Number(sent?.this_month ?? 0),
        tenantsConfigured: Number(settings?.configured ?? 0),
        remindersEnabled: Number(settings?.enabled ?? 0),
        avgLeadMinutes: Number(settings?.avg_lead ?? 0),
        deliveryLogs: totalLogs,
        delivered,
        failed: Number(deliv?.failed ?? 0),
        deliveryRate: totalLogs ? Math.round((delivered / totalLogs) * 1000) / 10 : 0,
      },
      byChannel: chAgg.map((s) => ({ channel: s.channel, count: Number(s.n) })),
      byStatus: stAgg.map((s) => ({ status: s.status, count: Number(s.n) })),
      settingsByChannel: settingsByChannel.map((s) => ({ channel: s.channel, count: Number(s.n) })),
      byDay: dayAgg.map((s) => ({ date: String(s.d), count: Number(s.n), delivered: Number(s.delivered) })),
    };
  }
  async platformAutomations(q: AutomationsQuery) {
    // The platform's real cross-tenant automations are reminder settings and end-of-day follow-up settings (+ run
    // history). We surface a unified inventory of those configured automations plus follow-up run activity.
    const remind: any = await (this.db as any).selectFrom('reminder_settings').select([
      sql`count(*)`.as('configured'), sql`count(*) filter (where enabled = true)`.as('enabled'),
    ]).executeTakeFirst().catch(() => ({}));
    const followCfg: any = await (this.db as any).selectFrom('daily_follow_up_settings').select([
      sql`count(*)`.as('configured'), sql`count(*) filter (where enabled = true)`.as('enabled'),
    ]).executeTakeFirst().catch(() => ({}));
    const runAgg: any = await (this.db as any).selectFrom('daily_follow_up_generation_runs').select([
      sql`count(*)`.as('runs'),
      sql`coalesce(sum(created_count),0)`.as('created'),
      sql`coalesce(sum(skipped_count),0)`.as('skipped'),
      sql`count(*) filter (where business_date >= date_trunc('month', current_date))`.as('runs_month'),
    ]).executeTakeFirst().catch(() => ({}));
    const runsByStatusAgg: any[] = await (this.db as any).selectFrom('daily_follow_up_generation_runs').select(['run_status', sql`count(*)`.as('n')]).groupBy('run_status').orderBy('n', 'desc').execute().catch(() => []);
    // unified automation inventory rows: one per reminder config + one per follow-up config, joined to tenant
    const remRows: any[] = await (this.db as any).selectFrom('reminder_settings as rs').leftJoin('tenants as t', 't.id', 'rs.tenant_id')
      .select(['rs.tenant_id', 't.display_name as tenant_name', 'rs.enabled', 'rs.channel', 'rs.lead_minutes', 'rs.updated_at']).execute().catch(() => []);
    const folRows: any[] = await (this.db as any).selectFrom('daily_follow_up_settings as fs').leftJoin('tenants as t', 't.id', 'fs.tenant_id')
      .select(['fs.tenant_id', 't.display_name as tenant_name', 'fs.enabled', 'fs.generation_time', 'fs.create_mode', 'fs.require_manager_approval', 'fs.updated_at']).execute().catch(() => []);
    let rows = [
      ...remRows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name || null, type: 'appointment_reminder', name: 'Appointment Reminders', enabled: !!r.enabled, detail: `${(r.channel || '—')} · ${r.lead_minutes ?? '—'}m lead`, updatedAt: r.updated_at })),
      ...folRows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name || null, type: 'end_of_day_followup', name: 'End-of-Day Follow-ups', enabled: !!r.enabled, detail: `${r.create_mode || 'auto'} · ${r.generation_time || '—'}${r.require_manager_approval ? ' · approval' : ''}`, updatedAt: r.updated_at })),
    ];
    if (q.status === 'enabled') rows = rows.filter((r) => r.enabled);
    if (q.status === 'disabled') rows = rows.filter((r) => !r.enabled);
    if (q.search) { const s = q.search.toLowerCase(); rows = rows.filter((r) => r.name.toLowerCase().includes(s) || (r.tenantName || '').toLowerCase().includes(s)); }
    const total = rows.length;
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const reminderEnabled = Number(remind?.enabled ?? 0); const followEnabled = Number(followCfg?.enabled ?? 0);
    return {
      rows: rows.slice((page - 1) * ps, page * ps),
      total,
      kpis: {
        totalAutomations: Number(remind?.configured ?? 0) + Number(followCfg?.configured ?? 0),
        enabledAutomations: reminderEnabled + followEnabled,
        reminderAutomations: reminderEnabled,
        followupAutomations: followEnabled,
        followupRuns: Number(runAgg?.runs ?? 0),
        followupRunsThisMonth: Number(runAgg?.runs_month ?? 0),
        itemsCreated: Number(runAgg?.created ?? 0),
        itemsSkipped: Number(runAgg?.skipped ?? 0),
      },
      byType: [
        { type: 'Appointment Reminders', configured: Number(remind?.configured ?? 0), enabled: reminderEnabled },
        { type: 'End-of-Day Follow-ups', configured: Number(followCfg?.configured ?? 0), enabled: followEnabled },
      ],
      runsByStatus: runsByStatusAgg.map((s) => ({ status: s.run_status, count: Number(s.n) })),
    };
  }
  async platformIntegrations(q: IntegrationsQuery) {
    // Payment-processor connections (the richest integration signal) — raw creds never selected.
    const base = () => {
      let qb: any = (this.db as any).selectFrom('tenant_payment_config as pc')
        .leftJoin('tenants as t', 't.id', 'pc.tenant_id');
      if (q.processor) qb = qb.where('pc.processor', '=', q.processor);
      if (q.status) qb = qb.where('pc.status', '=', q.status);
      if (q.search) qb = qb.where((eb: any) => eb.or([eb('pc.processor', 'ilike', like(q.search!)), eb('t.display_name', 'ilike', like(q.search!))]));
      return qb;
    };
    const total = Number((await base().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rows: any[] = await base().clearSelect().select([
      'pc.tenant_id', 't.display_name as tenant_name', 'pc.processor', 'pc.environment', 'pc.status',
      'pc.fiserv_configured', 'pc.webhook_secret_enc', 'pc.configured_at', 'pc.updated_at',
    ]).orderBy('pc.updated_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    const procAgg: any[] = await (this.db as any).selectFrom('tenant_payment_config').select(['processor', sql`count(*)`.as('n')]).groupBy('processor').orderBy('n', 'desc').execute().catch(() => []);
    const payTotals: any = await (this.db as any).selectFrom('tenant_payment_config').select([
      sql`count(*)`.as('configured'),
      sql`count(*) filter (where status = 'active')`.as('active'),
      sql`count(*) filter (where webhook_secret_enc is not null)`.as('webhooks'),
      sql`count(distinct processor)`.as('processors'),
    ]).executeTakeFirst().catch(() => ({}));
    const booking: any = await (this.db as any).selectFrom('pos_booking_integrations').select([
      sql`count(*)`.as('rows'),
      sql`count(*) filter (where online_booking_enabled = true)`.as('online'),
      sql`count(*) filter (where google_reserve_connected = true)`.as('google'),
      sql`count(*) filter (where ai_phone_enabled = true)`.as('ai_phone'),
    ]).executeTakeFirst().catch(() => ({}));
    const gw: any = await (this.db as any).selectFrom('payment_gateway_events').select([
      sql`count(*)`.as('total'), sql`count(*) filter (where signature_valid = true)`.as('valid'),
    ]).executeTakeFirst().catch(() => ({}));
    const gwTotal = Number(gw?.total ?? 0);
    // integration catalog: each category with a real connected count + status
    const catalog = [
      { key: 'fiserv', name: 'Fiserv CardPointe / Bolt', category: 'Payments', connected: procAgg.filter((p) => p.processor === 'fiserv').reduce((a, p) => a + Number(p.n), 0), note: 'Card processing & settlement' },
      { key: 'clover', name: 'Clover', category: 'Payments', connected: procAgg.filter((p) => p.processor === 'clover').reduce((a, p) => a + Number(p.n), 0), note: 'Terminal & card processing' },
      { key: 'google_reserve', name: 'Google Reserve', category: 'Booking', connected: Number(booking?.google ?? 0), note: 'Reserve with Google' },
      { key: 'online_booking', name: 'Online Booking', category: 'Booking', connected: Number(booking?.online ?? 0), note: 'Public booking site' },
      { key: 'ai_phone', name: 'AI Phone Assistant', category: 'AI', connected: Number(booking?.ai_phone ?? 0), note: 'Inbound call handling' },
      { key: 'webhooks', name: 'Gateway Webhooks', category: 'Payments', connected: Number(payTotals?.webhooks ?? 0), note: 'Signed processor callbacks' },
    ];
    return {
      rows: rows.map((r) => ({
        tenantId: r.tenant_id, tenantName: r.tenant_name || null, processor: r.processor, environment: r.environment || null,
        status: r.status, configured: !!r.fiserv_configured, webhookConfigured: !!r.webhook_secret_enc,
        configuredAt: r.configured_at, updatedAt: r.updated_at,
      })),
      total,
      kpis: {
        paymentConfigured: Number(payTotals?.configured ?? 0),
        activeProcessors: Number(payTotals?.active ?? 0),
        processorsInUse: Number(payTotals?.processors ?? 0),
        webhooksConfigured: Number(payTotals?.webhooks ?? 0),
        bookingEnabled: Number(booking?.online ?? 0),
        googleReserve: Number(booking?.google ?? 0),
        aiPhone: Number(booking?.ai_phone ?? 0),
        gatewayEvents: gwTotal,
        signatureValidRate: gwTotal ? Math.round((Number(gw?.valid ?? 0) / gwTotal) * 1000) / 10 : 0,
      },
      catalog,
      byProcessor: procAgg.map((p) => ({ processor: p.processor, count: Number(p.n) })),
    };
  }
  async platformDevices(q: DevicesQuery) {
    // Unified device fleet across the modelled device sources. pos_payment_terminals.tenant_id is text while the
    // other sources use uuid, so we resolve tenant names from a map in app code rather than SQL-joining (avoids a
    // uuid=text mismatch). Pairing/token hashes are never selected. Merge + filter + paginate in app code.
    const t = (this.db as any);
    const tlist: any[] = await t.selectFrom('tenants').select(['id', 'display_name']).execute().catch(() => []);
    const tname = new Map<string, string>(tlist.map((x) => [String(x.id), x.display_name]));
    const nm = (id: any) => tname.get(String(id)) || null;
    // Optional single-tenant scope (Phase 1b). tenant_id types differ across these sources (text vs uuid), so we
    // narrow in app code by string-equality after fetch — same result as a SQL filter, no uuid=text cast.
    const tf = <T extends { tenant_id: any }>(arr: T[]): T[] => (q.tenantId ? arr.filter((r) => String(r.tenant_id) === String(q.tenantId)) : arr);
    const terminals: any[] = tf(await t.selectFrom('pos_payment_terminals').select(['id', 'label as name', 'status', 'paired_at as last_seen', 'tenant_id']).execute().catch(() => []));
    const displays: any[] = tf(await t.selectFrom('customer_display_devices').select(['id', 'device_name as name', 'device_type', 'pairing_status as status', 'last_seen_at as last_seen', 'tenant_id']).execute().catch(() => []));
    const kiosks: any[] = tf(await t.selectFrom('go_checkin_devices').select(['id', 'device_name as name', 'device_type', 'status', 'last_seen_at as last_seen', 'tenant_id']).execute().catch(() => []));
    const leased: any[] = tf(await t.selectFrom('hardware_package_devices').select(['id', 'device_name as name', 'device_type', 'status', 'assigned_at as last_seen', 'serial_number', 'tenant_id']).execute().catch(() => []));
    const activeish = (s: string) => ['paired', 'active', 'online', 'assigned', 'connected'].includes((s || '').toLowerCase());
    let rows = [
      ...terminals.map((r) => ({ id: r.id, category: 'Payment Terminal', name: r.name || '—', deviceType: 'terminal', status: r.status || 'unknown', online: activeish(r.status), lastSeen: r.last_seen, serial: null, tenantId: r.tenant_id, tenantName: nm(r.tenant_id) })),
      ...displays.map((r) => ({ id: r.id, category: 'Customer Display', name: r.name || '—', deviceType: r.device_type || 'display', status: r.status || 'unknown', online: activeish(r.status), lastSeen: r.last_seen, serial: null, tenantId: r.tenant_id, tenantName: nm(r.tenant_id) })),
      ...kiosks.map((r) => ({ id: r.id, category: 'Check-In Kiosk', name: r.name || '—', deviceType: r.device_type || 'kiosk', status: r.status || 'unknown', online: activeish(r.status), lastSeen: r.last_seen, serial: null, tenantId: r.tenant_id, tenantName: nm(r.tenant_id) })),
      ...leased.map((r) => ({ id: r.id, category: 'Leased Hardware', name: r.name || '—', deviceType: r.device_type || 'hardware', status: r.status || 'unknown', online: activeish(r.status), lastSeen: r.last_seen, serial: r.serial_number || null, tenantId: r.tenant_id, tenantName: nm(r.tenant_id) })),
    ];
    if (q.category) rows = rows.filter((r) => r.category === q.category);
    if (q.status === 'online') rows = rows.filter((r) => r.online);
    if (q.status === 'offline') rows = rows.filter((r) => !r.online);
    if (q.search) { const s = q.search.toLowerCase(); rows = rows.filter((r) => r.name.toLowerCase().includes(s) || (r.tenantName || '').toLowerCase().includes(s) || (r.serial || '').toLowerCase().includes(s)); }
    rows.sort((a, b) => { const ta = a.lastSeen ? new Date(a.lastSeen).getTime() : 0; const tb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0; return tb - ta; });
    const total = rows.length;
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const catMap = new Map<string, number>(); const stMap = new Map<string, number>(); let online = 0;
    for (const r of rows) { catMap.set(r.category, (catMap.get(r.category) || 0) + 1); stMap.set(r.status, (stMap.get(r.status) || 0) + 1); if (r.online) online++; }
    return {
      rows: rows.slice((page - 1) * ps, page * ps),
      total,
      kpis: {
        totalDevices: total, online, offline: total - online,
        paymentTerminals: terminals.length, customerDisplays: displays.length, checkinKiosks: kiosks.length, leasedHardware: leased.length,
      },
      byCategory: [...catMap.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      byStatus: [...stMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    };
  }
  async platformSecurity(q: SecurityQuery) {
    const t = (this.db as any);
    // MFA adoption — real signal from users.mfa_enabled
    const userAgg: any = await t.selectFrom('users').select([
      sql`count(*)`.as('total'), sql`count(*) filter (where mfa_enabled = true)`.as('mfa'),
    ]).executeTakeFirst().catch(() => ({}));
    // login attempts
    const loginAgg: any = await t.selectFrom('login_attempts').select([
      sql`count(*)`.as('total'),
      sql`count(*) filter (where success = false)`.as('failed'),
      sql`count(*) filter (where created_at >= now() - interval '24 hours')`.as('last24'),
    ]).executeTakeFirst().catch(() => ({}));
    const loginSplitAgg: any[] = await t.selectFrom('login_attempts').select(['success', sql`count(*)`.as('n')]).groupBy('success').execute().catch(() => []);
    // active sessions
    const sessAgg: any = await t.selectFrom('sessions').select([
      sql`count(*) filter (where status = 'active' and revoked_at is null and (expires_at is null or expires_at > now()))`.as('active'),
      sql`count(*)`.as('total'),
    ]).executeTakeFirst().catch(() => ({}));
    // privileged (support-access) sessions
    // Constitution 7: one Support Mode store (support_access_sessions; the legacy rows were copied in by migration 541)
    const supAgg: any = await sql<any>`select
        (select count(*) from support_access_sessions) as total,
        (select count(*) from support_access_sessions where ended_at is null and expires_at > now()) as active`
      .execute(t as any).then((r: any) => r.rows[0]).catch(() => ({}));
    // audit trail volume (append-only audit_events + legacy audit_logs)
    const aeTotal = Number((await t.selectFrom('audit_events').select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const alTotal = Number((await t.selectFrom('audit_logs').select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const sevAgg: any[] = await t.selectFrom('audit_events').select(['severity', sql`count(*)`.as('n')]).groupBy('severity').orderBy('n', 'desc').execute().catch(() => []);
    // compliance — opt-outs honored
    const optTotal = Number((await t.selectFrom('notification_opt_outs').select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const optChAgg: any[] = await t.selectFrom('notification_opt_outs').select(['channel', sql`count(*)`.as('n')]).groupBy('channel').orderBy('n', 'desc').execute().catch(() => []);
    // recent audit feed (filterable)
    const base = () => {
      let qb: any = t.selectFrom('audit_events as ae').leftJoin('tenants as te', 'te.id', 'ae.tenant_id');
      if (q.severity) qb = qb.where('ae.severity', '=', q.severity);
      if (q.search) qb = qb.where((eb: any) => eb.or([eb('ae.action', 'ilike', like(q.search!)), eb('ae.module', 'ilike', like(q.search!)), eb('ae.actor_name', 'ilike', like(q.search!)), eb('te.display_name', 'ilike', like(q.search!))]));
      return qb;
    };
    const total = Number((await base().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const rows: any[] = await base().clearSelect().select([
      'ae.id', 'ae.occurred_at', 'ae.actor_name', 'ae.actor_role', 'ae.module', 'ae.action', 'ae.resource_type',
      'ae.status', 'ae.severity', 'ae.ip', 'ae.tenant_id', 'te.display_name as tenant_name',
    ]).orderBy('ae.occurred_at', 'desc').limit(ps).offset((page - 1) * ps).execute().catch(() => []);
    const totalUsers = Number(userAgg?.total ?? 0); const mfa = Number(userAgg?.mfa ?? 0);
    return {
      rows: rows.map((r) => ({
        id: r.id, occurredAt: r.occurred_at, actorName: r.actor_name || null, actorRole: r.actor_role || null,
        module: r.module || null, action: r.action || null, resourceType: r.resource_type || null,
        status: r.status || null, severity: r.severity || null, ip: (safeInet(r?.ip) ?? undefined) || null, tenantId: r.tenant_id, tenantName: r.tenant_name || null,
      })),
      total,
      kpis: {
        totalUsers, mfaEnrolled: mfa, mfaAdoptionRate: totalUsers ? Math.round((mfa / totalUsers) * 1000) / 10 : 0,
        loginAttempts: Number(loginAgg?.total ?? 0), failedLogins: Number(loginAgg?.failed ?? 0), loginsLast24h: Number(loginAgg?.last24 ?? 0),
        activeSessions: Number(sessAgg?.active ?? 0),
        supportSessions: Number(supAgg?.total ?? 0), activeSupportSessions: Number(supAgg?.active ?? 0),
        auditEvents: aeTotal + alTotal,
        optOuts: optTotal,
      },
      bySeverity: sevAgg.map((s) => ({ severity: s.severity || 'info', count: Number(s.n) })),
      loginSplit: loginSplitAgg.map((s) => ({ outcome: s.success ? 'success' : 'failed', count: Number(s.n) })),
      optOutsByChannel: optChAgg.map((s) => ({ channel: s.channel, count: Number(s.n) })),
    };
  }
  async userById(id: string) {
    return (await (this.db as any).selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst().catch(() => undefined)) ?? null;  }
  async emailExists(email: string) {
    const r = await (this.db as any).selectFrom('users').select('id').where('email', '=', email).executeTakeFirst().catch(() => undefined);
    return !!r;
  }
  /** Mirrors findTenantUserForLogin's lookup EXACTLY (tenant_id + normalized_phone), so "already exists" here means
   *  "would collide at sign-in". Two staff in different stores may share a phone; two in the same store may not. */
  async phoneExists(tenantId: string | null, normalizedPhone: string) {
    let q = (this.db as any).selectFrom('users').select('id').where('normalized_phone', '=', normalizedPhone);
    q = tenantId ? q.where('tenant_id', '=', tenantId) : q.where('tenant_id', 'is', null);
    const r = await q.executeTakeFirst().catch(() => undefined);
    return !!r;
  }
  async setUserStatus(id: string, status: string) {
    const r: any = await (this.db as any).updateTable('users').set({ status, updated_at: new Date() }).where('id', '=', id).where(canMoveToSql(USER_ACCOUNT, status) as any).returning('id').executeTakeFirst().catch(() => undefined);
    return !!r;
  }
  /** Change a user's coarse role. Returns the previous role (for before/after audit), or null if the user is missing. */
  async userForRoleChange(id: string) {
    const u: any = await (this.db as any).selectFrom('users').select(['role', 'tenant_id']).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    return u ? { role: String(u.role), tenantId: u.tenant_id ? String(u.tenant_id) : null } : null;
  }
  async otherActiveOwnerCount(tenantId: string, excludeUserId: string) {
    const r: any = await (this.db as any).selectFrom('users').select(sql<number>`count(*)::int`.as('n'))
      .where('tenant_id', '=', tenantId).where('role', '=', 'OWNER').where('id', '<>', excludeUserId)
      .where(sql`coalesce(status, 'active')`, '=', 'active').executeTakeFirst();
    return Number(r?.n ?? 0);
  }
  async setUserRole(id: string, role: string) {
    const u: any = await (this.db as any).selectFrom('users').select(['role']).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    if (!u) return null;
    await (this.db as any).updateTable('users').set({ role, updated_at: new Date() }).where('id', '=', id).execute();
    return { before: u.role as string };
  }
  /** Set whether 2FA is required for a user (writes users.mfa_enabled). Returns the previous flag, or null if missing. */
  async setUserMfaRequired(id: string, required: boolean) {
    const u: any = await (this.db as any).selectFrom('users').select(['mfa_enabled']).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    if (!u) return null;
    await (this.db as any).updateTable('users').set({ mfa_enabled: required, updated_at: new Date() }).where('id', '=', id).execute();
    return { before: !!u.mfa_enabled };
  }

  /** A user's currently-active login sessions (status active, not revoked, not expired). Read-only oversight (§27). */
  async userActiveSessions(userId: string) {
    const rows: any[] = await sql`
      select id, device_id, host(ip_address) as ip_address, user_agent, created_at, expires_at
      from sessions
      where user_id = ${userId} and status = 'active' and revoked_at is null and expires_at > now()
      order by created_at desc limit 100
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return rows.map((s) => ({ id: s.id, deviceId: s.device_id || null, ipAddress: s.ip_address || null, userAgent: s.user_agent || null, createdAt: s.created_at, expiresAt: s.expires_at }));
  }

  /** Revoke a single session + its refresh tokens. Returns the owning user id, or null if no live session matched. */
  async revokeSession(sessionId: string) {
    const s: any = await sql`select user_id from sessions where id = ${sessionId} and revoked_at is null`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!s) return null;
    await sql`update sessions set status = 'revoked', revoked_at = now() where id = ${sessionId} and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')}`.execute(this.db);
    await sql`update refresh_tokens set revoked_at = now() where session_id = ${sessionId} and revoked_at is null`.execute(this.db);
    return { userId: String(s.user_id) };
  }

  /** Revoke every active session + refresh token for a user ("sign out everywhere"). Returns how many were revoked. */
  async revokeAllUserSessions(userId: string) {
    const rows: any[] = await sql`select id from sessions where user_id = ${userId} and status = 'active' and revoked_at is null`.execute(this.db).then((r: any) => r.rows).catch(() => []);
    await sql`update sessions set status = 'revoked', revoked_at = now() where user_id = ${userId} and status = 'active' and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')}`.execute(this.db);
    await sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`.execute(this.db);
    return { count: rows.length };
  }
  /** Same mechanism as the proven tenant-owner reset: mint temp, scrypt-hash, set status invited. */
  async resetUserPassword(id: string) {
    const u: any = await (this.db as any).selectFrom('users').select(['email']).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    if (!u) return null;
    const temporaryPassword = tempPassword();
    // Sep 2026 merge: the developer's version logged the user's email AND the new temporary password here. Removed —
    // the one-time password goes only to the Super Admin who reset it (the caller); the reset itself is audited upstream.
    const hash = await hashPassword(temporaryPassword);
    await (this.db as any).updateTable('users').set({ password_hash: hash, status: 'invited', updated_at: new Date() }).where('id', '=', id).where(canMoveToSql(USER_ACCOUNT, 'invited') as any).execute();
    return { temporaryPassword, email: u.email || '' };
  }
  async createSuperAdmin(input: { email: string; fullName: string }) {
    const temporaryPassword = tempPassword();
    const hash = await hashPassword(temporaryPassword);
    const r: any = await (this.db as any).insertInto('users').values({
      id: sql`gen_random_uuid()`, tenant_id: null, full_name: input.fullName, email: input.email,
      password_hash: hash, status: 'invited', role: 'SUPER_ADMIN',
    }).returning('id').executeTakeFirst();
    return { id: String(r.id), temporaryPassword };
  }

  /** General invite (§10): creates a user in status 'invited' with the chosen role + tenant/branch scope and mints a
   *  one-time temp password (only the scrypt hash is stored). Email/SMS delivery, invitation tokens and scheduling are
   *  not modelled (no invitations table / mailer) — the account simply lands in 'invited' until first login. */
  async inviteUser(input: { email?: string | null; phone?: string | null; fullName: string; role: string; tenantId?: string | null; branchId?: string | null }) {
    const temporaryPassword = tempPassword();
    const hash = await hashPassword(temporaryPassword);
    // normalized_phone is what sign-in matches on. An account set up with a phone and no email is a valid account:
    // both columns are nullable, and the service guarantees at least one identifier is present.
    const r: any = await (this.db as any).insertInto('users').values({
      id: sql`gen_random_uuid()`, tenant_id: input.tenantId || null, branch_id: input.branchId || null,
      full_name: input.fullName, email: input.email || null, normalized_phone: input.phone || null,
      password_hash: hash, status: 'invited', role: input.role,
    }).returning('id').executeTakeFirst();
    return { id: String(r.id), temporaryPassword };
  }

  // ── Secure invitation tokens (§23) — single-use, expiring, hashed. The raw token is returned ONCE (to deliver to the
  //    invitee, or to the admin for manual delivery when no notifier is connected); only its hash is ever stored. ──
  async createInvitation(input: { platformRole?: string | null; tenantId?: string | null; branchId?: string | null; email?: string | null; phone?: string | null; role: string; fullName?: string | null; invitedByUserId?: string | null; channel?: string }) {
    const email = String(input.email || '').trim() || null;
    const phone = String(input.phone || '').trim() || null;   // already E.164-normalized by the service
    return await this.db.transaction().execute(async (trx) => {
      // One outstanding invite per tenant + identifier. Matched on whichever identifier this invitation carries, so
      // an email invite and a phone invite to the same person are two distinct pending invitations by design.
      const existing: any = await (email
        ? sql`select id, token_prefix, expires_at from user_invitations
            where coalesce(tenant_id::text,'platform') = coalesce(${input.tenantId ?? null}::text,'platform') and lower(email) = lower(${email}) and status = 'pending' limit 1`
        : sql`select id, token_prefix, expires_at from user_invitations
            where coalesce(tenant_id::text,'platform') = coalesce(${input.tenantId ?? null}::text,'platform') and normalized_phone = ${phone} and status = 'pending' limit 1`)
        .execute(trx).then((r: any) => r.rows[0]).catch(() => undefined);
      if (existing) return { id: String(existing.id), userId: null, token: null, tokenPrefix: existing.token_prefix, expiresAt: existing.expires_at, reused: true };
      // Find-or-create the invited user (token-based: NO temp password is set or shown). Look the person up by the
      // identifier the invitation was addressed to — a phone invite must find the phone-only account, not miss it
      // and mint a second login for the same human.
      const found: any = await (email
        ? sql`select id from users where lower(email) = lower(${email}) and coalesce(tenant_id::text,'platform') = coalesce(${input.tenantId ?? null}::text,'platform') limit 1`
        : sql`select id from users where normalized_phone = ${phone} and coalesce(tenant_id::text,'platform') = coalesce(${input.tenantId ?? null}::text,'platform') limit 1`)
        .execute(trx).then((r: any) => r.rows[0]).catch(() => undefined);
      let userId: string;
      if (found) userId = String(found.id);
      else {
        const ins: any = await sql`insert into users (id, tenant_id, branch_id, full_name, email, normalized_phone, role, status)
          values (gen_random_uuid(), ${input.tenantId ?? null}, ${input.branchId ?? null}, ${input.fullName ?? null}, ${email}, ${phone}, ${input.role}, 'invited') returning id`
          .execute(trx).then((r: any) => r.rows[0]);
        userId = String(ins.id);
      }
      const { token, tokenHash, tokenPrefix } = mintInvitationToken();
      const expiresAt = invitationExpiry();
      // `user_id` — the row this token is for. It was found-or-created three lines above; recording it means the
      // accept path never has to re-derive it from an email column that, since 379, can be null.
      const inv: any = await sql`insert into user_invitations (tenant_id, branch_id, email, normalized_phone, role, invited_by_user_id, user_id, token_hash, token_prefix, delivery_channel, expires_at, platform_role)
        values (${input.tenantId ?? null}, ${input.branchId ?? null}, ${email}, ${phone}, ${input.role}, ${input.invitedByUserId ?? null}, ${userId}, ${tokenHash}, ${tokenPrefix}, ${input.channel ?? 'email'}, ${expiresAt}, ${(input as any).platformRole ?? null}) returning id`
        .execute(trx).then((r: any) => r.rows[0]);
      return { id: String(inv.id), userId, token, tokenPrefix, expiresAt: expiresAt.toISOString(), reused: false };
    });
  }

  async listInvitations(q: { status?: string; tenantId?: string; page?: number; pageSize?: number }) {
    // reconcile expiry first so the list/counts reflect reality
    await sql`update user_invitations set status='expired', updated_at=now() where ${canMoveToSql(USER_INVITATION, 'expired')} and expires_at < now()`.execute(this.db).catch(() => {});
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const where = sql`where 1=1 ${q.status ? sql`and i.status = ${q.status}` : sql``} ${q.tenantId ? sql`and i.tenant_id = ${q.tenantId}` : sql``}`;
    const totalRow: any = await sql`select count(*)::int as n from user_invitations i ${where}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));
    const rows: any[] = await sql`
      select i.id, i.tenant_id, i.email, i.normalized_phone, i.role, i.status, i.delivery_channel, i.delivery_status, i.token_prefix, i.send_count,
             i.last_sent_at, i.expires_at, i.created_at, i.accepted_at, t.display_name as tenant_name, b.name as branch_name
      from user_invitations i left join tenants t on t.id = i.tenant_id left join branches b on b.id = i.branch_id
      ${where} order by i.created_at desc limit ${ps} offset ${(page - 1) * ps}`.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return {
      total: Number(totalRow?.n || 0),
      rows: rows.map((r) => ({ id: String(r.id), email: r.email, phone: r.normalized_phone || null, role: r.role, status: r.status, deliveryChannel: r.delivery_channel || null, deliveryStatus: r.delivery_status, tokenPrefix: r.token_prefix, sendCount: Number(r.send_count || 0), lastSentAt: r.last_sent_at || null, expiresAt: r.expires_at, createdAt: r.created_at, acceptedAt: r.accepted_at || null, tenantName: r.tenant_name || (r.tenant_id ? null : 'Platform'), branchName: r.branch_name || null })),
    };
  }

  async setInvitationDelivery(id: string, deliveryStatus: string, error?: string | null) {
    await sql`update user_invitations set delivery_status=${deliveryStatus}, delivery_error=${error ?? null}, updated_at=now() where id=${id}`.execute(this.db).catch(() => {});
  }

  async resendInvitation(id: string) {
    const cur: any = await sql`select status, email, normalized_phone, delivery_channel from user_invitations where id=${id}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!cur || cur.status !== 'pending') return null;
    const { token, tokenHash, tokenPrefix } = mintInvitationToken();
    const expiresAt = invitationExpiry();
    await sql`update user_invitations set token_hash=${tokenHash}, token_prefix=${tokenPrefix}, expires_at=${expiresAt}, send_count=send_count+1, last_sent_at=now(), updated_at=now() where id=${id} and status='pending'`.execute(this.db);
    return { id, token, tokenPrefix, expiresAt: expiresAt.toISOString(), email: String(cur.email || ''), phone: cur.normalized_phone || null, channel: String(cur.delivery_channel || (cur.email ? 'email' : 'sms')) };
  }

  async cancelInvitation(id: string) {
    const r: any = await sql`update user_invitations set status='cancelled', updated_at=now() where id=${id} and ${canMoveToSql(USER_INVITATION, 'cancelled')} returning id`.execute(this.db).then((x: any) => x.rows[0]).catch(() => undefined);
    return r ? { id: String(r.id), status: 'cancelled' } : null;
  }

  /** Redeem a token: single-use + replay-safe (the status flip happens in the same tx and only if still pending),
   *  then provision/activate the user with THEIR chosen password (never an admin-set one). */
  async acceptInvitation(input: { token: string; password: string; fullName?: string }) {
    const tokenHash = hashInvitationToken(input.token);
    return await this.db.transaction().execute(async (trx) => {
      const inv: any = await sql`select id, tenant_id, branch_id, email, normalized_phone, role, status, expires_at, user_id, platform_role from user_invitations where token_hash=${tokenHash} limit 1`
        .execute(trx).then((r: any) => r.rows[0]).catch(() => undefined);
      const decision = decideAccept(inv ? { status: inv.status, expiresAt: inv.expires_at } : null);
      if (!decision.ok) return { ok: false as const, reason: decision.reason };
      const flipped: any = await sql`update user_invitations set status='accepted', accepted_at=now(), updated_at=now() where id=${inv.id} and ${canMoveToSql(USER_INVITATION, 'accepted')} returning id`
        .execute(trx).then((r: any) => r.rows[0]);
      if (!flipped) return { ok: false as const, reason: 'already_accepted' as const }; // lost a concurrent race
      // ── DOES SHE ALREADY HAVE A PASSWORD? ───────────────────────────────────────────────────────────────
      //
      // A technician who already works somewhere has ONE password (auth/password-scope.ts). Accepting a new
      // salon must NOT let her — or anyone holding her invite link — set a new one, because that would rotate
      // her credential at the salons she ALREADY works at. An invitation is an offer of employment. It is not a
      // password reset, and it must never become one.
      //
      // So: if a peer login already carries a hash, the password she typed is CHECKED against it and that same
      // hash is reused. Her existing password is never overwritten by a link somebody sent her. If she has no
      // peer, this is genuinely her first salon and the password she typed is a new one.
      const existingHash = inv.user_id ? await existingTechnicianPasswordHash(this.db as any, String(inv.user_id)) : null;
      if (existingHash) {
        const matches = await verifyPassword(input.password, existingHash);
        if (!matches) return { ok: false as const, reason: 'existing_account_password' as const };
      }
      const hash = existingHash ?? await hashPassword(input.password);

      // ── WHICH ACCOUNT DOES THIS TOKEN ACTIVATE? ─────────────────────────────────────────────────────────
      //
      // The invitation says so. It used to be re-derived with `lower(email) = lower(${inv.email})` — email only —
      // which returned NOTHING for an SMS invitation (email is null since 379) and dropped through to INSERTING A
      // SECOND `users` ROW: no global_tech_profile_id, not the row `technicians.user_id` points at, and so the
      // Tech App still would not open for a technician who had just been told she was all set.
      //
      // `user_id` is now recorded when the token is minted, by both invite paths. The email/phone lookup remains
      // ONLY as a fallback for invitations that predate the column.
      const found: any = inv.user_id
        ? await sql`select id from users where id=${inv.user_id} limit 1`.execute(trx).then((r: any) => r.rows[0]).catch(() => undefined)
        : await sql`
            select id from users
             where coalesce(tenant_id::text,'platform') = coalesce(${inv.tenant_id ?? null}::text,'platform')
               and ((${inv.email}::text is not null and lower(email) = lower(${inv.email}))
                 or (${inv.normalized_phone}::text is not null and normalized_phone = ${inv.normalized_phone}))
             limit 1`.execute(trx).then((r: any) => r.rows[0]).catch(() => undefined);
      let userId: string;
      if (found) {
        userId = String(found.id);
        // Constitution 7 §24: a platform invitee's pre-created account takes the platform role the invitation named
        await sql`update users set platform_role = case when role = 'SUPER_ADMIN' then coalesce(${inv.platform_role ?? null}, platform_role) else platform_role end, password_hash=${hash}, status='active', must_change_password=false, password_changed_at=now(), full_name=coalesce(${input.fullName ?? null}, full_name), updated_at=now() where ${canMoveToSql(USER_ACCOUNT, 'active')} and id=${userId}`.execute(trx);
      } else {
        // Constitution 7 §24: a platform invitee holds exactly the platform role the invitation named (NULL = read-only fail-safe)
        const ins: any = await sql`insert into users (id, tenant_id, branch_id, full_name, email, normalized_phone, role, status, password_hash, password_changed_at, platform_role)
          values (gen_random_uuid(), ${inv.tenant_id}, ${inv.branch_id}, ${input.fullName ?? null}, ${inv.email}, ${inv.normalized_phone ?? null}, ${inv.role}, 'active', ${hash}, now(), ${inv.role === 'SUPER_ADMIN' ? (inv.platform_role ?? null) : null}) returning id`
          .execute(trx).then((r: any) => r.rows[0]);
        userId = String(ins.id);
      }
      await sql`update user_invitations set accepted_user_id=${userId} where id=${inv.id}`.execute(trx);
      return { ok: true as const, userId, email: inv.email, role: inv.role, tenantId: inv.tenant_id ?? null };
    });
  }

  /** @internal — used by the live smoke to assert single-use without exposing token hashes elsewhere. */
  async _invitationStatus(id: string): Promise<string | null> {
    const r: any = await sql`select status from user_invitations where id=${id}`.execute(this.db).then((x: any) => x.rows[0]).catch(() => undefined);
    return r ? String(r.status) : null;
  }

  // ── Access-request workflow (§26) — request a role elevation; an approver decides; approval never exceeds the
  //    approver's authority; temporary grants expire and are reverted. Every decision is auditable. ──
  async createAccessRequest(input: { tenantId?: string | null; requestingUserId: string; currentRole?: string | null; requestedRole: string; requestedBranchIds?: string[]; reason: string; requestedDurationDays?: number | null }) {
    const highRisk = isHighRisk(input.requestedRole);
    const r: any = await sql`insert into access_requests (tenant_id, requesting_user_id, prior_role, requested_role, requested_branch_ids, reason, requested_duration_days, high_risk, status)
      values (${input.tenantId ?? null}, ${input.requestingUserId}, ${input.currentRole ?? null}, ${input.requestedRole}, ${JSON.stringify(input.requestedBranchIds ?? [])}::jsonb, ${input.reason}, ${input.requestedDurationDays ?? null}, ${highRisk}, 'submitted') returning id`
      .execute(this.db).then((x: any) => x.rows[0]);
    return { id: String(r.id), status: 'submitted', highRisk };
  }

  async pendingAccessRequestsCount(tenantId?: string) {
    await sql`update access_requests set status='expired', updated_at=now() where status='approved' and ${canMoveToSql(ACCESS_REQUEST, 'expired')} and expires_at is not null and expires_at < now()`.execute(this.db).catch(() => {});
    const r: any = await sql`select count(*)::int as n from access_requests where status in ('submitted','under_review') ${tenantId ? sql`and tenant_id=${tenantId}` : sql``}`
      .execute(this.db).then((x: any) => x.rows[0]).catch(() => ({ n: 0 }));
    return Number(r?.n || 0);
  }

  async listAccessRequests(q: { status?: string; tenantId?: string; requestingUserId?: string; page?: number; pageSize?: number }) {
    await this.expireStaleAccessRequests();
    const page = Math.max(1, q.page || 1); const ps = Math.min(100, q.pageSize || 50);
    const where = sql`where 1=1 ${q.status ? sql`and ar.status=${q.status}` : sql``} ${q.tenantId ? sql`and ar.tenant_id=${q.tenantId}` : sql``} ${q.requestingUserId ? sql`and ar.requesting_user_id=${q.requestingUserId}` : sql``}`;
    const totalRow: any = await sql`select count(*)::int as n from access_requests ar ${where}`.execute(this.db).then((x: any) => x.rows[0]).catch(() => ({ n: 0 }));
    const rows: any[] = await sql`
      select ar.id, ar.tenant_id, ar.requesting_user_id, ar.prior_role as current_role, ar.requested_role, ar.reason, ar.requested_duration_days,
             ar.status, ar.high_risk, ar.approver_user_id, ar.decision_notes, ar.expires_at, ar.decided_at, ar.created_at,
             u.full_name as requester_name, u.email as requester_email, t.display_name as tenant_name, ap.full_name as approver_name
      from access_requests ar
        left join users u on u.id = ar.requesting_user_id
        left join users ap on ap.id = ar.approver_user_id
        left join tenants t on t.id = ar.tenant_id
      ${where} order by ar.created_at desc limit ${ps} offset ${(page - 1) * ps}`.execute(this.db).then((x: any) => x.rows).catch(() => []);
    return {
      total: Number(totalRow?.n || 0),
      rows: rows.map((r) => ({ id: String(r.id), tenantId: r.tenant_id || null, tenantName: r.tenant_name || (r.tenant_id ? null : 'Platform'), requestingUserId: String(r.requesting_user_id), requesterName: r.requester_name || null, requesterEmail: r.requester_email || null, currentRole: r.current_role || null, requestedRole: r.requested_role, reason: r.reason, requestedDurationDays: r.requested_duration_days || null, status: r.status, highRisk: !!r.high_risk, approverName: r.approver_name || null, decisionNotes: r.decision_notes || null, expiresAt: r.expires_at || null, decidedAt: r.decided_at || null, createdAt: r.created_at })),
    };
  }

  async expireStaleAccessRequests() {
    // approved temporary grants past expiry → revert the user's role (only if still the granted role) and mark expired
    await sql`update users u set role = ar.prior_role, updated_at = now()
      from access_requests ar
      where ar.status='approved' and ar.expires_at is not null and ar.expires_at < now()
        and ar.requesting_user_id = u.id and u.role = ar.requested_role and ar.prior_role is not null`.execute(this.db).catch(() => {});
    await sql`update access_requests set status='expired', updated_at=now() where status='approved' and ${canMoveToSql(ACCESS_REQUEST, 'expired')} and expires_at is not null and expires_at < now()`.execute(this.db).catch(() => {});
  }

  async _accessRequest(id: string) {
    const r: any = await sql`select status, requested_role, requesting_user_id, expires_at from access_requests where id=${id}`.execute(this.db).then((x: any) => x.rows[0]).catch(() => undefined);
    return r ? { status: String(r.status), requestedRole: String(r.requested_role), requestingUserId: String(r.requesting_user_id), expiresAt: r.expires_at || null } : null;
  }

  /** Decide an access request. On approve: enforce approver authority + (for high-risk) explicit confirmation, then
   *  apply the role grant within a transaction and stamp the request. Reject/review/cancel only move status. */
  async decideAccessRequest(input: { id: string; approverUserId: string; approverRole: string; action: RequestAction; notes?: string; durationDays?: number | null; confirmHighRisk?: boolean }) {
    return await this.db.transaction().execute(async (trx) => {
      const ar: any = await sql`select id, tenant_id, requesting_user_id, prior_role as current_role, requested_role, requested_duration_days, status, high_risk from access_requests where id=${input.id} limit 1`
        .execute(trx).then((x: any) => x.rows[0]).catch(() => undefined);
      if (!ar) return { ok: false as const, reason: 'not_found' };
      const t = decideTransition(ar.status, input.action);
      if (!t.ok) return { ok: false as const, reason: 'invalid_transition' };
      if (input.action === 'approve') {
        if (!approverCanGrant(input.approverRole, ar.requested_role)) return { ok: false as const, reason: 'beyond_authority' };
        if (ar.high_risk && !input.confirmHighRisk) return { ok: false as const, reason: 'high_risk_confirmation_required' };
        const expiresAt = grantExpiry(new Date(), input.durationDays ?? ar.requested_duration_days);
        const upd: any = await sql`update access_requests set status='approved', approver_user_id=${input.approverUserId}, decision_notes=${input.notes ?? null}, expires_at=${expiresAt}, decided_at=now(), updated_at=now() where id=${ar.id} and status=${ar.status} and ${canMoveToSql(ACCESS_REQUEST, 'approved')} returning id`
          .execute(trx).then((x: any) => x.rows[0]);
        if (!upd) return { ok: false as const, reason: 'invalid_transition' };
        // Phase 12 (#27): the role changes only once the request itself has moved to approved (it used to change first)
        await sql`update users set role=${ar.requested_role}, updated_at=now() where id=${ar.requesting_user_id}`.execute(trx);
        return { ok: true as const, status: 'approved', requestingUserId: String(ar.requesting_user_id), requestedRole: ar.requested_role, expiresAt: expiresAt ? expiresAt.toISOString() : null };
      }
      const upd: any = await sql`update access_requests set status=${t.next}, approver_user_id=${input.approverUserId}, decision_notes=${input.notes ?? null}, decided_at=now(), updated_at=now() where id=${ar.id} and status=${ar.status} and ${canMoveToSql(ACCESS_REQUEST, t.next)} returning id`
        .execute(trx).then((x: any) => x.rows[0]);
      if (!upd) return { ok: false as const, reason: 'invalid_transition' };
      return { ok: true as const, status: t.next, requestingUserId: String(ar.requesting_user_id), requestedRole: ar.requested_role };
    });
  }

  async cancelAccessRequest(id: string) {
    const cur: any = await sql`select status from access_requests where id=${id}`.execute(this.db).then((x: any) => x.rows[0]).catch(() => undefined);
    if (!cur) return null;
    const t = decideTransition(cur.status, 'cancel');
    if (!t.ok) return null;
    const r: any = await sql`update access_requests set status='cancelled', updated_at=now() where id=${id} and status=${cur.status} and ${canMoveToSql(ACCESS_REQUEST, 'cancelled')} returning id`.execute(this.db).then((x: any) => x.rows[0]).catch(() => undefined);
    return r ? { id: String(r.id), status: 'cancelled' } : null;
  }

  // ── Scheduled reports (definitions) ──
  async createScheduledReport(input: { name: string; reportKey: string; filters: any; cadence: string; recipientEmail?: string | null; format?: string; createdByUserId?: string | null; nextRunAt: Date }) {
    const r: any = await sql`insert into scheduled_reports (name, report_key, filters, cadence, recipient_email, format, created_by_user_id, next_run_at)
      values (${input.name}, ${input.reportKey}, ${JSON.stringify(input.filters ?? {})}::jsonb, ${input.cadence}, ${input.recipientEmail ?? null}, ${input.format ?? 'csv'}, ${input.createdByUserId ?? null}, ${input.nextRunAt}) returning id`
      .execute(this.db).then((x: any) => x.rows[0]);
    return { id: String(r.id) };
  }
  private mapScheduledReport = (r: any) => ({ id: String(r.id), name: r.name, reportKey: r.report_key, filters: r.filters || {}, cadence: r.cadence, recipientEmail: r.recipient_email || null, format: r.format, enabled: !!r.enabled, lastRunAt: r.last_run_at || null, lastStatus: r.last_status || null, nextRunAt: r.next_run_at, createdAt: r.created_at });
  async listScheduledReports() {
    const rows: any[] = await sql`select id, name, report_key, filters, cadence, recipient_email, format, enabled, last_run_at, last_status, next_run_at, created_at from scheduled_reports order by created_at desc`.execute(this.db).then((x: any) => x.rows).catch(() => []);
    return { rows: rows.map(this.mapScheduledReport), total: rows.length };
  }
  async setScheduledReportEnabled(id: string, enabled: boolean) {
    const r: any = await sql`update scheduled_reports set enabled=${enabled}, updated_at=now() where id=${id} returning id`.execute(this.db).then((x: any) => x.rows[0]).catch(() => undefined);
    return !!r;
  }
  async deleteScheduledReport(id: string) {
    const r: any = await sql`delete from scheduled_reports where id=${id} returning id`.execute(this.db).then((x: any) => x.rows[0]).catch(() => undefined);
    return !!r;
  }
  async dueScheduledReports(now: Date) {
    const rows: any[] = await sql`select id, name, report_key, filters, cadence, recipient_email, format, enabled, last_run_at, last_status, next_run_at, created_at from scheduled_reports where enabled = true and next_run_at <= ${now} order by next_run_at asc`.execute(this.db).then((x: any) => x.rows).catch(() => []);
    return rows.map(this.mapScheduledReport);
  }
  async recordScheduledReportRun(id: string, status: string, ranAt: Date, nextRunAt: Date) {
    await sql`update scheduled_reports set last_run_at=${ranAt}, last_status=${status}, next_run_at=${nextRunAt}, updated_at=now() where id=${id}`.execute(this.db).catch(() => {});
  }
  async _scheduledReport(id: string) {
    const r: any = await sql`select last_status, next_run_at, enabled from scheduled_reports where id=${id}`.execute(this.db).then((x: any) => x.rows[0]).catch(() => undefined);
    return r ? { lastStatus: r.last_status || null, nextRunAt: r.next_run_at, enabled: !!r.enabled } : null;
  }

  /** Grant (or update) a tenant user's access to a branch (§15 "Assign Branch"). Idempotent via the
   *  UNIQUE(tenant_id,user_id,branch_id) key. Validates the branch and the user both belong to the tenant — returns
   *  null otherwise so the caller reports not_found. Tenant-local only; never crosses tenants. */
  async assignUserBranch(input: { tenantId: string; userId: string; branchId: string; accessLevel: string; byUserId?: string }) {
    const branch: any = await (this.db as any).selectFrom('branches').select(['id']).where('id', '=', input.branchId).where('tenant_id', '=', input.tenantId).executeTakeFirst().catch(() => undefined);
    const user: any = await (this.db as any).selectFrom('users').select(['id']).where('id', '=', input.userId).where('tenant_id', '=', input.tenantId).executeTakeFirst().catch(() => undefined);
    if (!branch || !user) return null;
    await sql`
      insert into user_branch_access (id, tenant_id, branch_id, user_id, access_level, created_by_user_id)
      values (gen_random_uuid(), ${input.tenantId}, ${input.branchId}, ${input.userId}, ${input.accessLevel}, ${input.byUserId || null})
      on conflict (tenant_id, user_id, branch_id) do update set access_level = excluded.access_level, updated_at = now()
    `.execute(this.db);
    return { ok: true, tenantId: input.tenantId, userId: input.userId, branchId: input.branchId, accessLevel: input.accessLevel };
  }

  /** Revoke a tenant user's access to a branch. Returns the number of rows removed (0 if none). */
  async revokeUserBranch(input: { tenantId: string; userId: string; branchId: string }) {
    const r: any = await (this.db as any).deleteFrom('user_branch_access')
      .where('tenant_id', '=', input.tenantId).where('user_id', '=', input.userId).where('branch_id', '=', input.branchId)
      .executeTakeFirst().catch(() => ({ numDeletedRows: 0n }));
    return { removed: Number(r?.numDeletedRows || 0) };
  }

  /** One tenant's own users (non-customer) and branches — backs the same-tenant branch-access picker. Strictly
   *  tenant-scoped; never returns another tenant's users or branches. */
  async tenantUsersAndBranches(tenantId: string) {
    const t: any = await sql`select display_name from tenants where id = ${tenantId}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({}));
    const users: any[] = await sql`select id, full_name, email, role from users where tenant_id = ${tenantId} and role <> 'CUSTOMER' order by full_name asc nulls last limit 200`.execute(this.db).then((r: any) => r.rows).catch(() => []);
    const branches: any[] = await sql`select id, name from branches where tenant_id = ${tenantId} order by name asc`.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return {
      tenantName: t?.display_name || null,
      users: users.map((u) => ({ id: u.id, fullName: u.full_name || u.email || u.id, email: u.email || null, role: u.role })),
      branches: branches.map((b) => ({ id: b.id, name: b.name })),
    };
  }

  /** Platform reports (spec §16) — every number derives from real tables; nothing synthesized. */
  async reports() {
    const d = this.db as any;
    const month = (col = 'created_at') => sql`to_char(date_trunc('month', ${sql.ref(col)}), 'YYYY-MM')`;
    const growth: any[] = await d.selectFrom('tenants')
      .select([month().as('month'), sql`count(*)`.as('n')])
      .where('created_at', '>=', sql`now() - interval '12 months'`)
      .groupBy(sql`1`).orderBy(sql`1`).execute().catch(() => []);
    const volume: any[] = await d.selectFrom('payments')
      .select([month().as('month'), sql`coalesce(sum(amount_cents),0)`.as('cents')])
      .where('status', '=', 'approved').where('created_at', '>=', sql`now() - interval '12 months'`)
      .groupBy(sql`1`).orderBy(sql`1`).execute().catch(() => []);
    const byStatus = async (table: string) => {
      const rows: any[] = await d.selectFrom(table).select(['status', sql`count(*)`.as('n')]).groupBy('status').execute().catch(() => []);
      return Object.fromEntries(rows.map((r) => [String(r.status), Number(r.n)]));
    };
    const tenantsByState: any[] = await d.selectFrom('branches')
      .select(['state', sql`count(distinct tenant_id)`.as('n')])
      .where('state', 'is not', null).groupBy('state').orderBy(sql`2`, 'desc').execute().catch(() => []);
    const top: any[] = await d.selectFrom('payments')
      .innerJoin('tenants as t', 't.id', 'payments.tenant_id')
      .select(['t.id as tenant_id', 't.display_name', sql`coalesce(sum(amount_cents),0)`.as('cents')])
      .where('payments.status', '=', 'approved')
      .groupBy(['t.id', 't.display_name']).orderBy(sql`3`, 'desc').limit(5).execute().catch(() => []);
    const subs: any[] = await d.selectFrom('tenant_subscriptions')
      .select(['plan', sql`count(*)`.as('n')]).where('status', 'in', ['active', 'trialing']).groupBy('plan').execute().catch(() => []);
    const totalsRow = async (q: any) => Number((await q.executeTakeFirst().catch((e: any) => { console.error('reports totalsRow error:', e?.message); return { n: 0 }; }))?.n ?? 0);
    // sequential on purpose: four tiny counts; parallel fan-out breaks single-connection harness/db setups
    const totalTenants = await totalsRow(d.selectFrom('tenants').select(sql`count(*)`.as('n')));
    const activeTenants = await totalsRow(d.selectFrom('tenants').select(sql`count(*)`.as('n')).where('status', '=', 'active'));
    const gatewayErrorTenants = await totalsRow(d.selectFrom('tenant_payment_config').select(sql`count(*)`.as('n')).where('status', '=', 'error'));
    const supportSessions30d = await totalsRow(d.selectFrom('support_access_sessions').select(sql`count(*)`.as('n')).where('started_at', '>=', sql`now() - interval '30 days'`));
    const vol: any = await d.selectFrom('payments').select(sql`coalesce(sum(amount_cents),0)`.as('cents')).where('status', '=', 'approved').executeTakeFirst().catch(() => ({ cents: 0 }));
    const ai: any = await d.selectFrom('tenant_usage_limits').select(sql`coalesce(sum(used_value),0)`.as('n')).where('metric', '=', 'ai_calls').executeTakeFirst().catch(() => ({ n: 0 }));
    // Tenant Performance: per-tenant current vs prior calendar month approved card volume + growth + txn metrics.
    const tenantPerformance = await this.perfRows(100);
    return {
      totals: {
        totalTenants, activeTenants, platformVolumeCents: Number(vol?.cents ?? 0), aiCallsUsed: Number(ai?.n ?? 0),
        supportSessions30d, gatewayErrorTenants,
      },
      monthlyTenantGrowth: growth.map((r) => ({ month: String(r.month), count: Number(r.n) })),
      monthlyPaymentVolume: volume.map((r) => ({ month: String(r.month), amountCents: Number(r.cents) })),
      tenantsByState: tenantsByState.map((r) => ({ state: String(r.state), tenants: Number(r.n) })),
      leadFunnel: await byStatus('website_leads'),
      applicationPipeline: await byStatus('tenant_applications'),
      hardwareByStatus: await byStatus('hardware_packages'),
      topTenantsByVolume: top.map((r) => ({ tenantId: r.tenant_id, tenantName: r.display_name, amountCents: Number(r.cents) })),
      subscriptionsByPlan: Object.fromEntries(subs.map((r) => [String(r.plan), Number(r.n)])),
      tenantPerformance,
    };
  }

  /** Shared per-tenant performance rows (current vs prior calendar-month approved card volume + growth + txn metrics),
   *  ranked by current volume. `reports()` uses cap=100; the paginated report endpoint uses a higher cap. */
  private async perfRows(cap: number): Promise<any[]> {
    const d = this.db as any;
    const rows: any[] = await sql`
      select t.id as tenant_id, t.display_name, t.status,
        (select ts.plan from tenant_subscriptions ts where ts.tenant_id = t.id order by ts.created_at desc limit 1) as plan,
        (select b.state from branches b where b.tenant_id = t.id and b.state is not null limit 1) as state,
        (select b.city  from branches b where b.tenant_id = t.id and b.city  is not null limit 1) as city,
        coalesce(sum(p.amount_cents) filter (where p.created_at >= date_trunc('month', now())), 0) as cur_cents,
        coalesce(sum(p.amount_cents) filter (where p.created_at >= date_trunc('month', now()) - interval '1 month' and p.created_at < date_trunc('month', now())), 0) as prior_cents,
        count(p.id) filter (where p.created_at >= date_trunc('month', now())) as txn_count
      from tenants t
      left join payments p on p.tenant_id = t.id and p.status = 'approved' and p.created_at >= date_trunc('month', now()) - interval '1 month'
      group by t.id, t.display_name, t.status
      order by cur_cents desc
      limit ${cap}
    `.execute(d).then((r: any) => r.rows).catch(() => []);
    return rows.map((r: any, i: number) => {
      const cur = Number(r.cur_cents || 0), prior = Number(r.prior_cents || 0), txn = Number(r.txn_count || 0);
      const growthPercent = prior > 0 ? Math.round(((cur - prior) / prior) * 1000) / 10 : (cur > 0 ? null : 0);
      return {
        rank: i + 1, tenantId: r.tenant_id, tenantName: r.display_name, city: r.city ?? null, state: r.state ?? null,
        plan: r.plan ?? null, status: r.status ?? null, monthlyCardVolumeCents: cur, priorMonthVolumeCents: prior,
        growthPercent, transactionCount: txn, averageTicketCents: txn > 0 ? Math.round(cur / txn) : 0,
      };
    });
  }

  /** Fuller ranked set for the paginated Tenant Performance report (server-side filter/sort/paginate happens in core). */
  async tenantPerformanceRows(cap = 1000): Promise<any[]> { return this.perfRows(cap); }

  async counts() {
    const n = async (t: string, w: (qb: any) => any) => Number((await w(this.db.selectFrom(t as any)).select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 })))?.n ?? 0);
    return {
      newApplications: await n('tenant_applications', (q: any) => q.where('status', '=', 'new')),
      newLeads: await n('website_leads', (q: any) => q.where('status', '=', 'new')),
      hardwarePending: await n('hardware_packages', (q: any) => q.where('status', 'in', ['not_started', 'pending_approval', 'ordered', 'ready'])),
      activeSupportSessions: await n('support_access_sessions', (q: any) => q.where('ended_at', 'is', null).where('expires_at', '>', sql`now()`)),
    };
  }
}

/** Offline/dev fallback so the app boots without a DB; never used when REPO_DRIVER=postgres. */
export class InMemorySuperAdminPlatformRepo implements SuperAdminPlatformRepo {
  private apps: any[] = []; private lds: any[] = []; private hw: any[] = []; private ss: any[] = []; private seq = 0;
  private id() { return `mem_${++this.seq}`; }
  private page<T>(rows: T[], q: PlatformListQuery) { const ps = q.pageSize || PAGE; const p = q.page || 1; return { rows: rows.slice((p - 1) * ps, p * ps), total: rows.length }; }
  async applications(q: PlatformListQuery) { return this.page(this.apps.filter((a) => !q.status || a.status === q.status), q); }
  async getApplication(id: string) { return this.apps.find((a) => a.id === id) ?? null; }
  async countRecentApplicationsFromIp(ip: string, sinceHours: number) { const since = Date.now() - sinceHours * 3_600_000; return this.apps.filter((a) => a.ip_address === ip && new Date(a.created_at).getTime() >= since).length; }
  public tenantEmails: string[] = [];
  async activeTenantEmailExists(email: string) { return this.tenantEmails.some((e) => e.toLowerCase() === email.toLowerCase()); }
  async applicationMetricsRows() { return this.apps.map((a) => ({ status: a.status, source: a.source ?? null, state: a.state ?? null, card_volume_band: a.card_volume_band ?? null, current_pos: a.current_pos ?? null, current_processor: a.current_processor ?? null, assigned_to_user_id: a.assigned_to_user_id ?? null, duplicate_risk_score: a.duplicate_risk_score ?? null, follow_up_at: a.follow_up_at ?? null, created_at: a.created_at, approved_at: a.approved_at ?? null })); }
  async createApplication(i: any) { const r = { id: this.id(), status: 'new', notes: [], created_at: new Date().toISOString(), ...i }; this.apps.unshift(r); return r; }
  async findApplicationByIdempotencyKey(key: string) { return this.apps.find((a) => a.idempotency_key === key) ?? null; }
  async applicationDuplicateCandidates(probe: { email: string | null; einLast4: string | null; salonName: string | null }) {
    return this.apps.filter((a) => !a.archived_at && (
      (probe.email && String(a.email || '').toLowerCase() === probe.email.toLowerCase()) ||
      (probe.einLast4 && a.ein_last4 === probe.einLast4) ||
      (probe.salonName && String(a.salon_name || '').toLowerCase() === probe.salonName.toLowerCase())
    ));
  }
  async updateApplication(id: string, p: any) { const r = this.apps.find((x) => x.id === id); if (r) Object.assign(r, p); return r ?? null; }
  async appendApplicationNote(id: string, n: NoteInput) { const r = this.apps.find((x) => x.id === id); if (r) r.notes = [...(r.notes || []), { ...n, at: new Date().toISOString() }]; return r ?? null; }
  async leads(q: PlatformListQuery) { return this.page(this.lds.filter((a) => (!q.status || a.status === q.status) && (!q.kind || a.kind === q.kind)), q); }
  async createLead(i: any) { const r = { id: this.id(), kind: 'contact', status: 'new', notes: [], created_at: new Date().toISOString(), ...i }; this.lds.unshift(r); return r; }
  async updateLead(id: string, p: any) { const r = this.lds.find((x) => x.id === id); if (r) Object.assign(r, p); return r ?? null; }
  async hardware(q: PlatformListQuery) { return this.page(this.hw.filter((a) => (!q.status || a.status === q.status) && (!q.tenantId || a.tenant_id === q.tenantId)), q); }
  async createHardware(i: any) { const r = { id: this.id(), status: 'not_started', agreement_status: 'pending', payment_setup_status: 'pending', notes: [], created_at: new Date().toISOString(), ...i }; this.hw.unshift(r); return r; }
  async updateHardware(id: string, p: any) { const r = this.hw.find((x) => x.id === id); if (r) Object.assign(r, p); return r ?? null; }
  async startSupportSession(i: any) { const r = { id: this.id(), tenant_id: i.tenantId, admin_user_id: i.adminUserId, admin_email: i.adminEmail, reason: i.reason, scope: i.scope ?? 'READ_ONLY', started_at: new Date().toISOString(), expires_at: new Date(Date.now() + i.minutes * 60000).toISOString(), ended_at: null }; this.ss.unshift(r); return r; }
  async endSupportSession(id: string) { const r = this.ss.find((x) => x.id === id && !x.ended_at); if (r) r.ended_at = new Date().toISOString(); return r ?? null; }
  async supportSessions(activeOnly: boolean) { return activeOnly ? this.ss.filter((s) => !s.ended_at && new Date(s.expires_at).getTime() > Date.now()) : this.ss.slice(0, 100); }
  async auditLogs() { return { rows: [], total: 0 }; }
  async paymentGateways() { return []; }
  async paymentGatewaysState() { return { gateways: [], events: [], chargebacksTracked: false }; }
  async aiPackages() { return []; }
  async setAiPackage() { /* no-op */ }
  async setAiFeature() { /* no-op */ }
  async usageLimits() { return []; }
  async setUsageLimit() { /* no-op */ }
  async users() { return { rows: [], total: 0 }; }
  async usersDashboard() { return { kpis: { totalUsers: 0, activeUsers: 0, admins: 0, managers: 0, staff: 0, pendingInvites: 0, deactivated: 0 }, kpiCards: [], rolesDistribution: [], roleHealth: [], permissions: { total: 0, byCategory: [] }, permissionLevels: [], branchAllocation: { totalAssignments: 0, rows: [] }, branchAccess: { totalBranches: 0, branchesWithoutAdmin: 0, byLevel: [] }, topTenants: { totalUsers: 0, rows: [] }, pendingInvitations: { total: 0, rows: [] }, growth: [], growthDaily: { series: [], newUsersThisMonth: 0 }, recentActivity: [], accessAlerts: [], mfaAdoptionPct: null, securityScore: null, avgLoginTime: null }; }
  async branchesDashboard() { return { kpis: { totalBranches: 0, activeBranches: 0, newThisMonth: 0, totalStaff: 0, todaysAppointments: 0, monthlyRevenueCents: 0, suspendedBranches: 0, pendingOpenings: 0, openTodayBranches: 0, posDevices: 0, customersCheckedIn: 0, todaysRevenueCents: 0, openSupportTickets: 0, totalTechs: 0 }, statusDistribution: { active: 0, maintenance: 0, inactive: 0, total: 0, raw: [] }, directory: [], recentActivity: [], healthDistribution: { excellent: 0, good: 0, average: 0, poor: 0, critical: 0, scored: 0, unscored: 0, total: 0 }, operationalAlerts: [], deviceStatus: { total: 0, online: 0, offline: 0, maintenance: 0, inactive: 0 }, performanceTrend: [], topBranches: [], revenueByCity: [], queueByBranch: [], upcomingByBranch: [], onboardingPipeline: { received: 0, underReview: 0, siteVerified: 0, setupInProgress: 0, readyToLaunch: 0, conversionRate: 0 }, hoursAvailability: { full: 0, partial: 0, limited: 0, total: 0, avgAvailabilityPct: 0 }, atAGlance: { totalBranches: 0, totalTechs: 0, customersToday: 0, apptsToday: 0, revenueTodayCents: 0 }, capacity: null, healthScore: null }; }
  async branchesDirectory() { return { rows: [], total: 0, page: 1, pageSize: 10, pages: 1, facets: { statuses: [], tenants: [], cities: [] } }; }
  async branchesExport() { return []; }
  async createBranch() { return { ok: false as const, code: 'invalid' as const, message: 'Branch creation requires a database connection.' }; }
  async assignableManagers() { return null; }
  async assignBranchManager() { return { ok: false as const, code: 'invalid' as const, message: 'Manager assignment requires a database connection.' }; }
  async transferOptions() { return null; }
  async transferPreflight() { return { ok: false as const, code: 'not_found' as const, message: 'Branch not found.' }; }
  async createTransferRequest() { return { ok: false as const, code: 'invalid' as const, message: 'Branch transfer requires a database connection.' }; }
  async getBranchHours() { return null; }
  async setBranchHours() { return { ok: false as const, code: 'invalid' as const, message: 'Updating hours requires a database connection.' }; }
  async branchDevices() { return null; }
  async allocateDevice() { return { ok: false as const, code: 'invalid' as const, message: 'Device allocation requires a database connection.' }; }
  async getBranchForStatus() { return null; }
  async applyBranchStatus() { return null; }
  async bulkApplyStatus() { return []; }
  async platformServices() { return { rows: [], total: 0, kpis: { totalServices: 0, activeServices: 0, categories: 0, avgPriceCents: 0, avgDurationMinutes: 0, onlineBookable: 0, bookingsThisMonth: 0, revenueCentsThisMonth: 0, bookingsTotal: 0, revenueCentsTotal: 0, avgRating: 0, reviewCount: 0 }, byCategory: [], byStatus: [], catalogHealth: { active: 0, inactive: 0, needsUpdate: 0, missingInfo: 0 }, monthly: [], topServices: [], lowServices: [], recentActivity: [], packages: [], pricing: { avgCents: 0, highestCents: null, highestName: null, lowestCents: null, lowestName: null }, healthPct: null, topByRevenue: [], staffAvailability: [] }; }
  async platformProducts() { return { rows: [], total: 0, kpis: { totalProducts: 0, activeSkus: 0, lowStockAlerts: 0, categories: 0, inventoryValueCents: 0, outOfStock: 0, overstock: 0, monthlySalesCents: 0, avgGrossMarginPct: 0, suppliersActive: 0 }, byCategory: [], stockHealth: { inStock: 0, outOfStock: 0, reorderPending: 0, overstock: 0, expiringSoon: 0, total: 0 }, lowStockList: [], topProducts: [], suppliers: [], recentActivity: [], monthly: [], byBranch: [], movement: [], dataQualityPct: null }; }
  async platformCategories() { return { rows: [], total: 0, kpis: { totalCategories: 0, distinctNames: 0, activeCategories: 0, tenantsCovered: 0, uncategorizedProducts: 0 }, duplicates: [] }; }
  async platformBrands() { return { rows: [], total: 0, kpis: { totalCategories: 0, distinctNames: 0, activeCategories: 0, tenantsCovered: 0, uncategorizedProducts: 0 }, duplicates: [] }; }
  async platformSuppliers() { return { rows: [], total: 0, kpis: { totalSuppliers: 0, activeSuppliers: 0, distinctNames: 0, tenantsCovered: 0, withContact: 0, integrationsConnected: null }, duplicates: [] }; }
  async platformServiceCategories() { return { rows: [], total: 0, kpis: { totalCategories: 0, distinctNames: 0, activeCategories: 0, tenantsCovered: 0, uncategorizedServices: 0 }, duplicates: [] }; }
  async tenantServiceCategories() { return { tenantName: null, categories: [] }; }
  async platformAppointments() { return { rows: [], total: 0, kpis: { totalAppointments: 0, today: 0, confirmedToday: 0, completedToday: 0, onlineBookings: 0, walkIns: 0, pending: 0, cancelledCount: 0, cancellationRate: 0, avgServiceMinutes: 0, noShowCount: 0, noShowRate: 0 }, byStatus: [], bySource: [], byTechnician: [], trend: [], byBranch: [], topServices: [], byHour: [], byDay: [], oversight: { duplicateBookings: 0, technicianConflicts: 0, failedDeposits: 0, missingContact: 0, reminderFailures: 0 }, walkInQueue: [], recentActivity: [] }; }
  async platformPayments() { return { rows: [], total: 0, kpis: { processedVolumeCents: 0, todayVolumeCents: 0, todayCount: 0, successfulCount: 0, failedCount: 0, averageTicketCents: 0, tipsCents: 0, successRate: 0, refundCount: 0, refundCentsMonth: 0, refundCentsToday: 0, refundRatePct: 0, netRevenueTodayCents: 0, topMethod: null, topMethodCents: 0, activeTerminals: 0, terminalCount: 0 }, byMethod: [], byProcessor: [], byStatus: [], byBranch: [], byHour: [], terminals: [], recentActivity: [], monthly: [] }; }
  async paymentsTransactions() { return { total: 0, rows: [], kpiRaw: { total: 0, approved: 0, failed: 0, volumeCents: 0, processingFeesCents: 0, settledCount: 0, refundVoidCount: 0, duplicateAlerts: 0 }, byMethod: [], trend: [], failed: [], processors: [] }; }
  async paymentTransactionDetail() { return null; }
  async paymentAuthorizationHistory() { return null; }
  async platformCustomers() { return { rows: [], total: 0, kpis: { totalCustomers: 0, activeCustomers: 0, newThisMonth: 0, loyaltyMembers: 0, vipCustomers: 0, totalSpentCents: 0, avgVisitValueCents: 0 }, segmentation: [], byBranch: [], growth: [], topSpending: [], retention: null, csat: { count: 0, avg: 0, dist: [] }, loyalty: { members: 0, pointsIssued: 0, pointsRedeemed: 0, redemptionValueCents: null, activeMembers: 0 }, recentActivity: [], signups: [], feedback: [], oversight: { duplicatePhones: 0, duplicateEmails: 0, inactiveCustomers: 0 } }; }
  async customerDuplicates() { return { cases: [], total: 0 }; }
  async mergeCustomers() { return null; }
  async mergeServiceCategories() { return null; }
  async mergeProductCategories() { return null; }
  async tenantProductCategories() { return { tenantName: null, categories: [] }; }
  async privacyRequests() { return { rows: [], total: 0, kpis: { total: 0, overdue: 0, byStatus: [] } }; }
  async createPrivacyRequest() { return null; }
  async setPrivacyRequestStatus() { return null; }
  async platformReportExports() { return { rows: [], total: 0, kpis: { totalReports: 0, reportsThisMonth: 0, reportTypes: 0, tenantsCovered: 0 }, byReportType: [], byFormat: [], byMonth: [], recentActivity: [] }; }
  async platformReminders() { return { rows: [], total: 0, kpis: { appointmentRemindersSent: 0, remindersSentThisMonth: 0, tenantsConfigured: 0, remindersEnabled: 0, avgLeadMinutes: 0, deliveryLogs: 0, delivered: 0, failed: 0, deliveryRate: 0 }, byChannel: [], byStatus: [], settingsByChannel: [], byDay: [] }; }
  async platformAutomations() { return { rows: [], total: 0, kpis: { totalAutomations: 0, enabledAutomations: 0, reminderAutomations: 0, followupAutomations: 0, followupRuns: 0, followupRunsThisMonth: 0, itemsCreated: 0, itemsSkipped: 0 }, byType: [], runsByStatus: [] }; }
  async platformIntegrations() { return { rows: [], total: 0, kpis: { paymentConfigured: 0, activeProcessors: 0, processorsInUse: 0, webhooksConfigured: 0, bookingEnabled: 0, googleReserve: 0, aiPhone: 0, gatewayEvents: 0, signatureValidRate: 0 }, catalog: [], byProcessor: [] }; }
  async platformDevices() { return { rows: [], total: 0, kpis: { totalDevices: 0, online: 0, offline: 0, paymentTerminals: 0, customerDisplays: 0, checkinKiosks: 0, leasedHardware: 0 }, byCategory: [], byStatus: [] }; }
  async platformSecurity() { return { rows: [], total: 0, kpis: { totalUsers: 0, mfaEnrolled: 0, mfaAdoptionRate: 0, loginAttempts: 0, failedLogins: 0, loginsLast24h: 0, activeSessions: 0, supportSessions: 0, activeSupportSessions: 0, auditEvents: 0, optOuts: 0 }, bySeverity: [], loginSplit: [], optOutsByChannel: [] }; }
  async userById() { return null; }
  async emailExists() { return false; }
  async phoneExists() { return false; }
  async setUserStatus() { return false; }
  async setUserRole() { return null; }
  async setUserMfaRequired() { return null; }
  async userActiveSessions() { return []; }
  async revokeSession() { return null; }
  async revokeAllUserSessions() { return { count: 0 }; }
  async resetUserPassword() { return null; }
  async createSuperAdmin() { return { id: 'mem_sa', temporaryPassword: 'Tmp-MEM0' }; }
  async inviteUser() { return { id: 'mem_inv', temporaryPassword: 'Tmp-INV0' }; }
  async createInvitation() { return { id: 'mem_invite', userId: 'mem_u', token: 'mem-token', tokenPrefix: 'mem-toke', expiresAt: new Date().toISOString(), reused: false }; }
  async listInvitations() { return { rows: [], total: 0 }; }
  async setInvitationDelivery() { /* no-op */ }
  async resendInvitation() { return { id: 'mem_invite', token: 'mem-token2', tokenPrefix: 'mem-toke', expiresAt: new Date().toISOString(), email: 'mem@example.com', phone: null, channel: 'email' }; }
  async cancelInvitation() { return { id: 'mem_invite', status: 'cancelled' }; }
  async acceptInvitation() { return { ok: true as const, userId: 'mem_u', email: 'mem@example.com', role: 'MANAGER', tenantId: null }; }
  async _invitationStatus() { return 'pending'; }
  async createAccessRequest() { return { id: 'mem_ar', status: 'submitted', highRisk: false }; }
  async pendingAccessRequestsCount() { return 0; }
  async listAccessRequests() { return { rows: [], total: 0 }; }
  async expireStaleAccessRequests() { /* no-op */ }
  async _accessRequest() { return { status: 'submitted', requestedRole: 'MANAGER', requestingUserId: 'mem_u', expiresAt: null }; }
  async decideAccessRequest() { return { ok: true as const, status: 'approved', requestingUserId: 'mem_u', requestedRole: 'MANAGER', expiresAt: null }; }
  async cancelAccessRequest() { return { id: 'mem_ar', status: 'cancelled' }; }
  async createScheduledReport() { return { id: 'mem_sr' }; }
  async listScheduledReports() { return { rows: [], total: 0 }; }
  async setScheduledReportEnabled() { return true; }
  async deleteScheduledReport() { return true; }
  async dueScheduledReports() { return []; }
  async recordScheduledReportRun() { /* no-op */ }
  async _scheduledReport() { return { lastStatus: null, nextRunAt: new Date().toISOString(), enabled: true }; }
  async assignUserBranch() { return null; }
  async revokeUserBranch() { return { removed: 0 }; }
  async tenantUsersAndBranches() { return { tenantName: null, users: [], branches: [] }; }
  async reports() { return { totals: { totalTenants: 0, activeTenants: 0, platformVolumeCents: 0, aiCallsUsed: 0, supportSessions30d: 0, gatewayErrorTenants: 0 }, monthlyTenantGrowth: [], monthlyPaymentVolume: [], tenantsByState: [], leadFunnel: {}, applicationPipeline: {}, hardwareByStatus: {}, topTenantsByVolume: [], subscriptionsByPlan: {}, tenantPerformance: [] }; }
  async tenantPerformanceRows() { return [] as any[]; }
  async counts() { return { newApplications: this.apps.filter((a) => a.status === 'new').length, newLeads: this.lds.filter((a) => a.status === 'new').length, hardwarePending: this.hw.filter((a) => ['not_started', 'pending_approval', 'ordered', 'ready'].includes(a.status)).length, activeSupportSessions: (await this.supportSessions(true)).length }; }
}
