import { api } from './client';

// superAdminCheckinApi — platform-wide kiosk Check-in activity (Super Admin, read-only). Cross-tenant aggregation over
// go_checkin_sessions. Complements the existing platform Appointments oversight; this is the check-in side.

export interface SACheckinKpis { activeNow: number; completedToday: number; sessionsToday: number; totalSessions: number }
export interface SACheckinTenantRow { tenantId: string; tenantName: string | null; sessionCount: number; activeCount: number }
export interface SACheckinSessionRow { sessionId: string; tenantId: string; tenantName: string | null; branchName: string | null; deviceName: string | null; status: string; startedAt: string | null; completedAt: string | null; lastSeenAt: string | null }
export interface SACheckinStatusSlice { status: string; count: number }

export interface SACheckinOverview {
  ok: boolean;
  kpis: SACheckinKpis;
  tenants: SACheckinTenantRow[];
  sessions: SACheckinSessionRow[];
  statusBreakdown: SACheckinStatusSlice[];
  tenantCount: number;
}

export const superAdminCheckinApi = {
  overview: (q?: { search?: string; status?: string; limit?: number }) =>
    api.get<SACheckinOverview>('/super-admin/checkin/overview', q as Record<string, unknown> | undefined),
};
