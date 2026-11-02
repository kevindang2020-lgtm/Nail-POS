import type { Semantic } from '@aipowersalon/api-contracts/platform';   // the one KPI tone (Constitution 13 §15)
import { api } from './client';
import type { TrendDir, WaitStatus } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

// superAdminBookingCheckinApi — Super Admin Booking & Check-In Monitor (read-only, cross-tenant). Mirrors the live
// aggregate served at GET /super-admin/booking-checkin/overview. Every section carries honest availability so the UI
// can render real zeros / "—" / "Not yet provisioned" instead of fabricated values.


export interface SAKpi { key: string; label: string; value: number; display: string; deltaPct: number; direction: TrendDir; semantic: Semantic; available: boolean; href: string | null }
export interface SALifecycleStage { key: string; label: string; count: number; pct: number }
export interface SASourceRow { key: string; label: string; count: number; pct: number }
export interface SATrendPoint { day: string; checkIns: number; failed: number }
export interface SABranchWait { rank: number; branchId: string; branch: string; avgWaitSeconds: number; avgWaitDisplay: string; bookings: number; checkIns: number; status: WaitStatus }
export interface SADeviceRow { type: string; online: number; offline: number; uptime: number }
export interface SAFlag { value: number | null; available: boolean }
export interface SAPendingRow { id: string; branch: string; bookedAt: string }
export interface SAFailedEventRow { eventCode: string; branch: string; source: string; failureType: string; time: string; retryStatus: string }
export interface SAHandoffRow { callCode: string; branch: string; transferredTo: string; reason: string; status: string; time: string }
export interface SAUnmatchedRow { id: string; name: string; source: string; possibleMatches: number; lastContact: string | null }

export interface SABookingCheckinOverview {
  ok: boolean;
  metadata: { generatedAt: string; range: { start: string; endInclusive: string }; prior: { start: string; end: string } };
  scope: { tenantId: string | null; branchId: string | null; label: string };
  boundary: string;
  kpis: SAKpi[];
  lifecycle: { cohort: string; stages: SALifecycleStage[] };
  sourceBreakdown: { total: number; rows: SASourceRow[] };
  bookingsBySource: SASourceRow[];
  checkInTrend: SATrendPoint[];
  branchWaitTimes: SABranchWait[];
  deviceStatus: { available: boolean; rows: SADeviceRow[]; totalDevices: number; totalOffline: number; overallUptime: number };
  integrationHealth: { available: boolean; tenantsConfigured: number; onlineBookingEnabled: number; googleReserveConnected: number; aiPhoneEnabled: number; successRate24h: SAFlag; failedRequests24h: SAFlag; retryQueue: SAFlag; syncIssues: SAFlag };
  pendingConfirmations: { available: boolean; count: number; rows: SAPendingRow[] };
  aiHandoffs: { available: boolean; rows: SAHandoffRow[]; note?: string };
  unmatchedCustomers: { available: boolean; rows: SAUnmatchedRow[]; note?: string };
  failedEvents: { available: boolean; rows: SAFailedEventRow[]; note?: string };
  todaySummary: {
    avgWait: { seconds: number; display: string; available: boolean };
    duplicateCheckInRate: SAFlag;
    confirmationRate: SAFlag;
    deviceUptime: SAFlag;
    queueConversion: SAFlag;
  };
}

export interface SABookingCheckinFilters {
  startDate?: string; endDate?: string; tenantId?: string; branchId?: string;
  source?: string; checkInMethod?: string; technicianId?: string; status?: string;
}

export interface SAFailedEventDetail {
  id: string; eventCode: string; branch: string; category: string; source: string; checkInMethod: string;
  failureType: string; errorCode: string; errorMessage: string; correlationId: string; retryStatus: string;
  retryCount: number; attemptCount: number; escalationState: string; resolution: string;
  occurredAt: string; lastAttemptAt: string | null;
}
export interface SAFailedEventsPage {
  ok: boolean; scope: { tenantId: string | null; branchId: string | null; label: string };
  range: { start: string; endInclusive: string }; page: number; pageSize: number; total: number; rows: SAFailedEventDetail[];
}
export interface SAFailedEventsQuery { startDate?: string; endDate?: string; tenantId?: string; branchId?: string; category?: string; retryStatus?: string; search?: string; page?: number; pageSize?: number }

export interface SADeviceDetail { id: string; deviceName: string; deviceType: string; branch: string; state: string; registeredStatus: string; lastSeenAt: string | null; disabledAt: string | null; registeredAt: string }
export interface SADevicesPage { ok: boolean; scope: { tenantId: string | null; branchId: string | null; label: string }; page: number; pageSize: number; total: number; rows: SADeviceDetail[] }
export interface SADevicesQuery { tenantId?: string; branchId?: string; status?: string; deviceType?: string; search?: string; page?: number; pageSize?: number }

export interface SAHandoffDetail { id: string; callCode: string; branch: string; transferredTo: string; reason: string; status: string; requestedAt: string; connectedAt: string | null; waitSeconds: number | null; failureReason: string; bookingResult: string }
export interface SAHandoffsPage { ok: boolean; scope: { tenantId: string | null; branchId: string | null; label: string }; range: { start: string; endInclusive: string }; page: number; pageSize: number; total: number; rows: SAHandoffDetail[] }
export interface SAHandoffsQuery { startDate?: string; endDate?: string; tenantId?: string; branchId?: string; status?: string; transferredTo?: string; search?: string; page?: number; pageSize?: number }

export interface SABookingSourceRow { key: string; label: string; total: number; confirmed: number; completed: number; cancelled: number; noShow: number; failed: number; confirmationRate: number; completionRate: number; cancellationRate: number }
export interface SABookingSourceTotals { total: number; confirmed: number; completed: number; cancelled: number; noShow: number; failed: number }
export interface SABookingSourcesResponse { ok: boolean; scope: { tenantId: string | null; branchId: string | null; label: string }; range: { start: string; endInclusive: string }; rows: SABookingSourceRow[]; totals: SABookingSourceTotals }
export interface SABookingSourcesQuery { startDate?: string; endDate?: string; tenantId?: string; branchId?: string }

export interface SACheckinMethodRow { key: string; label: string; sessions: number; completed: number; expired: number; failed: number; active: number; completionRate: number; avgDurationSec: number; avgDurationDisplay: string }
export interface SACheckinSummary { totalSessions: number; completed: number; expired: number; failed: number; active: number; completionRate: number; avgDurationSec: number; avgDurationDisplay: string; available: boolean }
export interface SACheckinPerformanceResponse { ok: boolean; scope: { tenantId: string | null; branchId: string | null; label: string }; range: { start: string; endInclusive: string }; summary: SACheckinSummary; methods: SACheckinMethodRow[] }
export interface SACheckinPerformanceQuery { startDate?: string; endDate?: string; tenantId?: string; branchId?: string }

export interface SAWaitSummary { avgWaitSec: number; avgWaitDisplay: string; medianWaitSec: number; medianWaitDisplay: string; p90WaitSec: number; p90WaitDisplay: string; longestWaitSec: number; longestWaitDisplay: string; sampled: number; entered: number; abandoned: number; abandonmentRate: number; available: boolean }
export interface SAWaitBranchRow { branchId: string; branch: string; avgWaitSec: number; avgWaitDisplay: string; medianWaitSec: number; p90WaitSec: number; longestWaitSec: number; longestWaitDisplay: string; waits: number; checkins: number; status: string }
export interface SAWaitSourceRow { key: string; label: string; avgWaitSec: number; avgWaitDisplay: string; waits: number }
export interface SAWaitHourRow { hour: number; avgWaitSec: number; waits: number }
export interface SAWaitTimeResponse { ok: boolean; scope: { tenantId: string | null; branchId: string | null; label: string }; range: { start: string; endInclusive: string }; summary: SAWaitSummary; branches: SAWaitBranchRow[]; sources: SAWaitSourceRow[]; hours: SAWaitHourRow[] }
export interface SAWaitTimeQuery { startDate?: string; endDate?: string; tenantId?: string; branchId?: string }

export interface SARetryResult {
  ok: boolean; eligible?: boolean; idempotentReplay?: boolean; escalated?: boolean;
  attempt?: { id: string; attemptNumber: number; status: string; backoffSeconds: number; nextRetryAt: string | null; createdAt: string } | null;
  event?: { retryStatus: string; retryCount: number; escalationState: string; nextRetryAt?: string };
}

export interface SAExportResult { ok: boolean; type: string; format: string; available: boolean; filename: string | null; csv: string | null; rowCount: number; reason?: string }

export const superAdminBookingCheckinApi = {
  overview: (q?: SABookingCheckinFilters) =>
    api.get<SABookingCheckinOverview>('/super-admin/booking-checkin/overview', q as Record<string, unknown> | undefined),
  exportReport: (q?: { type?: string; format?: string; tenantId?: string; branchId?: string; startDate?: string; endDate?: string; category?: string; retryStatus?: string; search?: string }) =>
    api.exportAsync<SAExportResult>('/super-admin/booking-checkin/export', q as Record<string, unknown> | undefined),
  failedEvents: (q?: SAFailedEventsQuery) =>
    api.get<SAFailedEventsPage>('/super-admin/booking-checkin/failed-events', q as Record<string, unknown> | undefined),
  retryFailedEvent: (id: string, body?: { reason?: string; idempotencyKey?: string; tenantId?: string }) =>
    api.post<SARetryResult>(`/super-admin/booking-checkin/failed-events/${encodeURIComponent(id)}/retry`, (body ?? {}) as Record<string, unknown>),
  devices: (q?: SADevicesQuery) =>
    api.get<SADevicesPage>('/super-admin/booking-checkin/devices', q as Record<string, unknown> | undefined),
  aiHandoffs: (q?: SAHandoffsQuery) =>
    api.get<SAHandoffsPage>('/super-admin/booking-checkin/ai-handoffs', q as Record<string, unknown> | undefined),
  bookingSources: (q?: SABookingSourcesQuery) =>
    api.get<SABookingSourcesResponse>('/super-admin/booking-checkin/booking-sources', q as Record<string, unknown> | undefined),
  checkinPerformance: (q?: SACheckinPerformanceQuery) =>
    api.get<SACheckinPerformanceResponse>('/super-admin/booking-checkin/check-in-performance', q as Record<string, unknown> | undefined),
  waitTimeAnalysis: (q?: SAWaitTimeQuery) =>
    api.get<SAWaitTimeResponse>('/super-admin/booking-checkin/wait-time-analysis', q as Record<string, unknown> | undefined),
};
export type { TrendDir, WaitStatus };
export type { Semantic };
