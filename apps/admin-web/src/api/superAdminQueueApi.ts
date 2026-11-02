import { api } from './client';
import type { LiveQueueOverview } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

// superAdminQueueApi — platform-wide live Queue Management (Super Admin, read-only). Cross-tenant aggregation over
// pos_queue_items, limited to currently-active queue statuses. This is a live monitor; refresh to re-poll.

export interface SAQueueKpis { waitingNow: number; inServiceNow: number; vipWaiting: number; longestWaitMin: number; salonsWithActiveQueue: number }
export interface SAQueueTenantRow { tenantId: string; tenantName: string | null; waitingCount: number; servingCount: number }
export interface SAQueueItemRow { queueItemId: string; tenantId: string; tenantName: string | null; branchName: string | null; customerName: string; isVip: boolean; priority: string; status: string; station: string | null; technicianName: string | null; checkedInAt: string | null; waitMinutes: number }
export interface SAQueueStatusSlice { status: string; count: number }

export interface SAQueueOverview {
  ok: boolean;
  kpis: SAQueueKpis;
  tenants: SAQueueTenantRow[];
  items: SAQueueItemRow[];
  statusBreakdown: SAQueueStatusSlice[];
  tenantCount: number;
}

export const superAdminQueueApi = {
  overview: (q?: { search?: string; status?: string; limit?: number }) =>
    api.get<SAQueueOverview>('/super-admin/queue/overview', q as Record<string, unknown> | undefined),
  liveOverview: (q?: LiveQueueQuery) =>
    api.get<LiveQueueOverview>('/super-admin/queue/live-overview', q as Record<string, unknown> | undefined),
  openIncident: (b: LQIncidentInput) => api.post<LQActionResult>('/super-admin/queue/incidents', b as unknown as Record<string, unknown>),
  notifyBranch: (b: LQNotifyInput) => api.post<LQActionResult>('/super-admin/queue/notify-branch', b as unknown as Record<string, unknown>),
  supportSession: (b: LQSupportSessionInput) => api.post<LQActionResult>('/super-admin/queue/support-session', b as unknown as Record<string, unknown>),
  exportCsv: (q?: LiveQueueQuery) => api.exportAsync<string>('/super-admin/queue/export', q as Record<string, unknown> | undefined, 'text'),
  exportXlsx: (q?: LiveQueueQuery) => api.exportAsync<Blob>('/super-admin/queue/export-xlsx', q as Record<string, unknown> | undefined, 'blob'),
  exportPdf: (q?: LiveQueueQuery) => api.exportAsync<Blob>('/super-admin/queue/export-pdf', q as Record<string, unknown> | undefined, 'blob'),
};

export interface LQIncidentInput { tenantId: string; branchId?: string; queueIds?: string[]; deviceIds?: string[]; category?: string; severity?: string; description?: string; idempotencyKey?: string }
export interface LQNotifyInput { tenantId: string; branchId?: string; queueIds?: string[]; severity?: string; message?: string }
export interface LQSupportSessionInput { tenantId: string; branchId?: string; reason?: string; ticketId?: string }
export interface LQActionResult { ok: boolean; error?: string; ticketNumber?: string; ticketId?: string; sessionId?: string; status?: string; delivered?: boolean; retryable?: boolean; reason?: string }

// --- Live Queue Monitor (full overview) -----------------------------------------------------------------------------
// The richer /super-admin/queue/live-overview payload (11 KPIs + every reference module). Read-only. Modules with no
// canonical source (per-item sync, full timelines) arrive as { available:false } and render NotConnected — never faked.

export type LQBucket = 'waiting' | 'assigned' | 'in_service' | 'unassigned' | 'other';
export type LQThresholdFlag = 'none' | 'warning' | 'alert' | 'critical';
export interface LQRow {
  queueId: string; tenantId: string; branchId: string | null; customer: string; tenantName: string | null; branchName: string | null; status: string;
  bucket: LQBucket; waitMin: number; technicianName: string | null; service: string | null; isVip: boolean;
  deviceStatus: 'unknown'; syncStatus: 'unknown'; thresholdFlag: LQThresholdFlag; stuck: boolean; stuckReason: string | null;
}
export interface LQTechAvailability { total: number; available: number; busy: number; onBreak: number; slices: { label: string; count: number }[] }
export interface LQNotConnected { available: false; reason: string }
export interface LQWaitBranchStat { branchId: string; branch: string | null; waiting: number; overThreshold: number; avgMin: number; medianMin: number; p90Min: number; longestMin: number }
export interface LQWaitAnalytics { overall: { count: number; avgMin: number; medianMin: number; p90Min: number; longestMin: number }; overThreshold: number; thresholds: { warningMin: number; alertMin: number; criticalMin: number }; byBranch: LQWaitBranchStat[] }
export interface LQMetricTrend { delta: number; pct: number | null; favorable: boolean | null }
export interface LQTimelineEvent { at: string; label: string; state: string; kind: string }
export interface LQQueueTimeline { queueId: string; customer: string; tenantName: string | null; branchName: string | null; source: string | null; currentState: string; events: LQTimelineEvent[] }
export interface LQStuckRecord { queueId: string; tenantName: string | null; branchName: string | null; customer: string; status: string; reason: string | null; stuckMin: number; waitMin: number }

export interface LiveQueueQuery {
  search?: string; status?: string; tenantId?: string; branchId?: string;
  page?: number; pageSize?: number; sort?: string; direction?: 'asc' | 'desc';
  /** Support mode: unmask THIS tenant's customer names — honoured server-side only while this admin holds a live
   *  controlled-support session for it (otherwise names stay masked; the response's `supportMode` says which). */
  supportTenantId?: string;
}

export function lqTechConnected(t: LQTechAvailability | LQNotConnected): t is LQTechAvailability {
  return (t as LQNotConnected).available !== false;
}
export type { LiveQueueOverview };
