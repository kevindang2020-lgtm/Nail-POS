// super-admin-checkin.service.ts — read-only, cross-tenant kiosk Check-in activity for Super Admin (Booking & Check-in,
// Phase 9). Thin orchestration; all aggregation lives in the Kysely repository. Reads go_checkin_sessions across all
// tenants (joined to devices/branches/tenants for names). No write paths by design (tenants manage their own kiosks via
// the Check-In Devices surface). Complements the existing platform Appointments oversight — this is the check-in side,
// which nothing else surfaces at the platform level. Mirrors the super-admin-staff service shape.

import type { OverviewScope } from '@aipowersalon/database';

export interface CheckinOverviewFilters {
  search: string;  // free-text match on salon name / device name (server-side, trimmed)
  status: string;  // '' = all, else exact session status (e.g. 'active', 'completed', 'expired')
  limit: number;   // recent-session row cap (default 200)
  scope?: OverviewScope;  // optional single-tenant narrowing (Phase 1); absent = platform-wide
}

export interface PlatformCheckinKpis {
  activeNow: number;        // sessions currently in 'active' status
  completedToday: number;   // sessions completed since local midnight (DB now())
  sessionsToday: number;    // sessions started today
  totalSessions: number;    // all-time session count
}
export interface PlatformCheckinTenantRow { tenantId: string; tenantName: string | null; sessionCount: number; activeCount: number }
export interface PlatformCheckinSessionRow { sessionId: string; tenantId: string; tenantName: string | null; branchName: string | null; deviceName: string | null; status: string; startedAt: string | null; completedAt: string | null; lastSeenAt: string | null }
export interface PlatformCheckinStatusSlice { status: string; count: number }

export interface PlatformCheckinOverview {
  kpis: PlatformCheckinKpis;
  tenants: PlatformCheckinTenantRow[];
  sessions: PlatformCheckinSessionRow[];
  statusBreakdown: PlatformCheckinStatusSlice[];
  tenantCount: number;
}

export interface AdminCtx { userId?: string; email?: string; ip?: string }

interface Repo {
  platformCheckinOverview(f: CheckinOverviewFilters): Promise<PlatformCheckinOverview>;
}

const clampInt = (v: unknown, def: number, min: number, max: number): number => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
};
const clampStr = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export class SuperAdminCheckinService {
  constructor(private readonly repo: Repo) {}

  getOverview(_ctx: AdminCtx, q: { search?: unknown; status?: unknown; limit?: unknown; scope?: OverviewScope }): Promise<PlatformCheckinOverview> {
    return this.repo.platformCheckinOverview({
      search: clampStr(q?.search),
      status: clampStr(q?.status, 40),
      limit: clampInt(q?.limit, 200, 1, 1000),
      scope: q?.scope,
    });
  }
}
