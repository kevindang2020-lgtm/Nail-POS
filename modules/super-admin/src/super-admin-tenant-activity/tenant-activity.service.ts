// tenant-activity.service.ts — validates query params, formats raw audit rows into activity items, then filters,
// summarizes, and paginates via the pure core. Summary reflects the active filters (minus pagination).
import { applyFilters, paginate, summarize, toActivity, type ActivityCategory, type ActivityQuery, type ActivitySeverity } from './tenant-activity-core';
import type { TenantActivityRepo } from './tenant-activity.repository';

const SEVERITIES: ActivitySeverity[] = ['info', 'success', 'warning', 'error'];
const CATEGORIES: ActivityCategory[] = ['tenant', 'payment', 'hardware', 'ai', 'application', 'support', 'other'];

export class SuperAdminTenantActivityService {
  constructor(private readonly repo: TenantActivityRepo) {}

  private async items() { return (await this.repo.all()).map(toActivity); }

  private clean(q: any): ActivityQuery {
    const severity = SEVERITIES.includes(q?.severity) ? (q.severity as ActivitySeverity) : undefined;
    const category = CATEGORIES.includes(q?.category) ? (q.category as ActivityCategory) : undefined;
    return {
      search: q?.search ? String(q.search).slice(0, 120) : undefined,
      tenantId: q?.tenantId ? String(q.tenantId) : undefined,
      eventType: q?.eventType ? String(q.eventType).slice(0, 120) : undefined,
      severity,
      category,
      from: q?.from ? String(q.from) : undefined,
      to: q?.to ? String(q.to) : undefined,
      page: Math.max(1, Number(q?.page) || 1),
      limit: Math.min(100, Math.max(1, Number(q?.limit) || 25)),
      sortDirection: q?.sortDirection === 'asc' ? 'asc' : 'desc',
    };
  }

  async list(q: any) {
    const query = this.clean(q);
    return paginate(applyFilters(await this.items(), query), query.page, query.limit);
  }

  /** Recent Tenant Activity card feed — newest-first, capped (default 5). Reuses the same audit_logs read-model. */
  async recent(q: any) {
    const limit = Math.min(50, Math.max(1, Number(q?.limit) || 5));
    const query = this.clean({ ...q, page: 1, limit });
    const items = applyFilters(await this.items(), { ...query, sortDirection: 'desc' });
    return { activities: items.slice(0, limit).map((a) => ({ ...a, timeAgo: a.ageLabel })) };
  }

  /** Activity detail (for the detail panel/page). Resolves within the bounded recent audit window. */
  async byId(id: string) {
    const found = (await this.items()).find((a) => a.id === id);
    if (!found) return { ok: false as const, error: 'Activity not found' };
    return { ...found, timeAgo: found.ageLabel };
  }

  async summary(q: any) {
    const query = this.clean(q);
    return summarize(applyFilters(await this.items(), query));
  }
}
