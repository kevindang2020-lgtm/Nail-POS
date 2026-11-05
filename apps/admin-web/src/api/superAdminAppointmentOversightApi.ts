// superAdminAppointmentOversightApi.ts — typed client for GET /super-admin/appointment-oversight/overview.
// Reads via the shared root-relative `api` (credentials: include). Honest gaps surface as available:false.
import type { Gap } from '@aipowersalon/api-contracts/platform';
export type { Gap };   // the platform-wide honest-gap marker (Constitution 13 §15) — never re-declare it here
import { api } from './client';

export type AoKpi = { key: string; label: string; available: boolean; value: number | null; unfavorableUp?: boolean; financial?: boolean };
export type AoTrend = { available: boolean; dates: string[]; series: { total: number[]; completed: number[]; cancelled: number[]; noShows: number[] } };
export type AoStatusDist = { available: boolean; total: number; slices: { label: string; value: number; pct: number }[] };
export type AoSourceDist = { available: boolean; total: number; bars: { label: string; value: number; pct: number }[] };
export type AoIssueTab = Gap | { available: true; count: number };
export type AoRecentIssues = {
  tabs: { all: number; failedBookings: AoIssueTab; duplicates: AoIssueTab; overlapping: AoIssueTab; syncFailures: AoIssueTab; missingInfo: AoIssueTab };
  rows: { issueType: string; appointmentId: string; customer: string; tenantBranch: string; dateTime: string; technician: string; source: string; status: string; severity: string }[];
};
export type AoSummaryCard = { available: boolean; value: number; financial?: boolean };
export type AppointmentOversight = {
  metadata: { generatedAt: string; generatedBy: string | null };
  scope: { tenantId: string | null; label: string };
  kpis: AoKpi[];
  trend: AoTrend;
  statusDistribution: AoStatusDist;
  sourceDistribution: AoSourceDist;
  recentIssues: AoRecentIssues;
  platformSummary: {
    totalTenants: AoSummaryCard; activeBranches: AoSummaryCard; activeTechnicians: AoSummaryCard;
    totalCustomers: AoSummaryCard; todaysAppointments: AoSummaryCard; todaysRevenueCents: AoSummaryCard;
  };
};

export function fetchAppointmentOversight(tenantId?: string | null): Promise<AppointmentOversight> {
  return api.get<AppointmentOversight>('/super-admin/appointment-oversight/overview', tenantId ? { tenantId } : undefined);
}

export type AoSearchRow = { id: string; customerName: string | null; customerPhone: string | null; apptDate: string | null; startTime: string | null; status: string | null; source: string | null; tenantName: string | null; branchName: string | null; technicianName: string | null };
export type AoSearchResult = { scope: { tenantId: string | null; label: string }; page: number; pageSize: number; total: number; rows: AoSearchRow[] };
export function searchAppointments(opts: { q?: string; status?: string; source?: string; page?: number; pageSize?: number } = {}): Promise<AoSearchResult> {
  return api.get<AoSearchResult>('/super-admin/appointment-oversight/search', {
    page: opts.page ?? 1, pageSize: opts.pageSize ?? 25,
    ...(opts.q ? { q: opts.q } : {}), ...(opts.status ? { status: opts.status } : {}), ...(opts.source ? { source: opts.source } : {}),
  });
}

export type AoDuplicateGroup = { tenantName: string | null; customerName: string | null; apptDate: string | null; startTime: string | null; count: number; appointmentIds: string[]; matchReasons: string[]; confidence: number };
export type AoDuplicateResult = { scope: { tenantId: string | null; label: string }; page: number; pageSize: number; total: number; groups: AoDuplicateGroup[] };
export function detectDuplicates(opts: { page?: number; pageSize?: number } = {}): Promise<AoDuplicateResult> {
  return api.get<AoDuplicateResult>('/super-admin/appointment-oversight/duplicates', { page: opts.page ?? 1, pageSize: opts.pageSize ?? 25 });
}

export type AoOverlapEnd = { id: string; customerName: string | null; startTime: string | null; endTime: string | null };
export type AoOverlapConflict = { tenantName: string | null; technicianName: string | null; apptDate: string | null; overlapMinutes: number; a: AoOverlapEnd; b: AoOverlapEnd };
export type AoOverlapResult = { scope: { tenantId: string | null; label: string }; page: number; pageSize: number; total: number; conflicts: AoOverlapConflict[] };
export function detectOverlaps(opts: { page?: number; pageSize?: number } = {}): Promise<AoOverlapResult> {
  return api.get<AoOverlapResult>('/super-admin/appointment-oversight/overlapping', { page: opts.page ?? 1, pageSize: opts.pageSize ?? 25 });
}

export type AoChangeRow = { id: string; tenantName: string | null; appointmentId: string; changeType: string; field: string | null; oldValue: string | null; newValue: string | null; actorType: string | null; actorId: string | null; source: string | null; createdAt: string | null };
export type AoChangeResult = { scope: { tenantId: string | null; label: string }; page: number; pageSize: number; total: number; rows: AoChangeRow[]; available: boolean };
export function fetchChangeHistory(opts: { page?: number; pageSize?: number } = {}): Promise<AoChangeResult> {
  return api.get<AoChangeResult>('/super-admin/appointment-oversight/change-history', { page: opts.page ?? 1, pageSize: opts.pageSize ?? 25 });
}

export type AoFailedRow = { id: string; customerName: string | null; customerPhone: string | null; tenantName: string | null; branchName: string | null; technicianName: string | null; apptDate: string | null; startTime: string | null; status: string | null; depositStatus: string | null };
export type AoFailuresResult = { scope: { tenantId: string | null; label: string }; page: number; pageSize: number; total: number; rows: AoFailedRow[]; sources: { failedDeposits: { available: boolean }; failedBookings: { available: boolean; reason?: string }; syncFailures: { available: boolean; reason?: string } } };
export function fetchFailures(opts: { page?: number; pageSize?: number } = {}): Promise<AoFailuresResult> {
  return api.get<AoFailuresResult>('/super-admin/appointment-oversight/failures', { page: opts.page ?? 1, pageSize: opts.pageSize ?? 25 });
}

export function fetchReschedules(opts: { page?: number; pageSize?: number } = {}): Promise<AoChangeResult> {
  return api.get<AoChangeResult>('/super-admin/appointment-oversight/rescheduled', { page: opts.page ?? 1, pageSize: opts.pageSize ?? 25 });
}

export type AoMissingRow = { id: string; customerName: string | null; tenantName: string | null; branchName: string | null; technicianName: string | null; apptDate: string | null; startTime: string | null; status: string | null; missing: string[] };
export type AoMissingResult = { scope: { tenantId: string | null; label: string }; page: number; pageSize: number; total: number; rows: AoMissingRow[]; available: boolean };
export function fetchMissingInfo(opts: { page?: number; pageSize?: number } = {}): Promise<AoMissingResult> {
  return api.get<AoMissingResult>('/super-admin/appointment-oversight/missing-info', { page: opts.page ?? 1, pageSize: opts.pageSize ?? 25 });
}

export type AoHistoryResult = { scope: { tenantId: string | null; label: string }; appointmentId: string | null; page: number; pageSize: number; total: number; rows: AoChangeRow[]; available: boolean };
export function fetchAppointmentHistory(appointmentId: string, opts: { page?: number; pageSize?: number } = {}): Promise<AoHistoryResult> {
  return api.get<AoHistoryResult>('/super-admin/appointment-oversight/history', { appointmentId, page: opts.page ?? 1, pageSize: opts.pageSize ?? 50 });
}

export type AoIntegrityRow = { id: string; tenantName: string | null; apptDate: string | null; startTime: string | null; status: string | null; issues: string[] };
export type AoIntegrityResult = { scope: { tenantId: string | null; label: string }; page: number; pageSize: number; total: number; rows: AoIntegrityRow[]; available: boolean };
export function fetchDataIntegrity(opts: { page?: number; pageSize?: number } = {}): Promise<AoIntegrityResult> {
  return api.get<AoIntegrityResult>('/super-admin/appointment-oversight/data-integrity', { page: opts.page ?? 1, pageSize: opts.pageSize ?? 25 });
}

export type AoCorrectionProposal = { issue: string; correctionType: 'clear_invalid_reference'; field: string; before: string; after: null; reversible: boolean; impact: string };
export type AoCorrectionPreview = { scope: { tenantId: string | null; label: string }; appointmentId: string | null; eligible: boolean; reason?: string; issues: string[]; proposals: AoCorrectionProposal[]; nonCorrectable?: string[]; requiredToApply?: string[]; note?: string };
export function fetchCorrectionPreview(appointmentId: string): Promise<AoCorrectionPreview> {
  return api.get<AoCorrectionPreview>('/super-admin/appointment-oversight/correction/preview', { appointmentId });
}
