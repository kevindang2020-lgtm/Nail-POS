// super-admin-queue.service.ts — read-only, cross-tenant live Queue Management for Super Admin (Phase 9). Thin
// orchestration; all aggregation lives in the Kysely repository. Reads pos_queue_items (the canonical front-desk queue
// the tenant POS Queue module uses) across all tenants, limited to currently-active queue statuses. No write paths by
// design (tenants run their own queues via the POS). Mirrors the super-admin-staff / super-admin-checkin service shape.

import type { OverviewScope } from '@aipowersalon/database';

export interface QueueOverviewFilters {
  search: string;  // free-text match on customer name / salon name (server-side, trimmed)
  status: string;  // '' = all active, else exact status (waiting|called|assigned|in_service)
  limit: number;   // live-list row cap (default 200)
  scope?: OverviewScope;  // optional single-tenant narrowing (Phase 1); absent = platform-wide
}

export interface PlatformQueueKpis {
  waitingNow: number;            // active items not yet in service (waiting/called/assigned)
  inServiceNow: number;          // active items currently in service
  vipWaiting: number;            // VIP customers currently waiting
  longestWaitMin: number;        // longest current wait among waiting items (minutes)
  salonsWithActiveQueue: number; // distinct salons with any active queue item
}
export interface PlatformQueueTenantRow { tenantId: string; tenantName: string | null; waitingCount: number; servingCount: number }
export interface PlatformQueueItemRow { queueItemId: string; tenantId: string; tenantName: string | null; branchName: string | null; customerName: string; isVip: boolean; priority: string; status: string; station: string | null; technicianName: string | null; checkedInAt: string | null; waitMinutes: number }
export interface PlatformQueueStatusSlice { status: string; count: number }

export interface PlatformQueueOverview {
  kpis: PlatformQueueKpis;
  tenants: PlatformQueueTenantRow[];
  items: PlatformQueueItemRow[];
  statusBreakdown: PlatformQueueStatusSlice[];
  tenantCount: number;
}

export interface AdminCtx { userId?: string; email?: string; ip?: string }

interface Repo {
  platformQueueOverview(f: QueueOverviewFilters): Promise<PlatformQueueOverview>;
}

const clampInt = (v: unknown, def: number, min: number, max: number): number => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
};
const clampStr = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export class SuperAdminQueueService {
  constructor(private readonly repo: Repo) {}

  getOverview(_ctx: AdminCtx, q: { search?: unknown; status?: unknown; limit?: unknown; scope?: OverviewScope }): Promise<PlatformQueueOverview> {
    return this.repo.platformQueueOverview({
      search: clampStr(q?.search),
      status: clampStr(q?.status, 40),
      limit: clampInt(q?.limit, 200, 1, 1000),
      scope: q?.scope,
    });
  }
}
