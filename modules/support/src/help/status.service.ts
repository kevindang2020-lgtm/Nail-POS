// status.service.ts — System Status + Recent Product Updates for the Help Center (spec §7, §43). The overall
// status is gated by a real DB health probe (a failed probe reports degraded regardless of stored rows); when
// healthy, it's the worst of the published component statuses. Incident history and the release-notes feed come
// from platform-managed tables. Raw SQL, fail-soft. Pure helpers are exported for DB-free testing.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { StatusComponent, StatusIncident } from '@aipowersalon/api-contracts/tenant';
import type { StatusComponent, StatusIncident, HelpSystemStatus } from '@aipowersalon/api-contracts/tenant';

export const COMPONENT_STATUSES = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'] as const;
export type ComponentStatus = typeof COMPONENT_STATUSES[number];

// Severity ranking for worst-of rollup. 'maintenance' sits just above operational (planned, non-failing).
const RANK: Record<string, number> = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 };

export function statusLabel(s: string): string {
  switch (s) {
    case 'operational': return 'All Systems Operational';
    case 'maintenance': return 'Under Maintenance';
    case 'degraded': return 'Degraded Performance';
    case 'partial_outage': return 'Partial Outage';
    case 'major_outage': return 'Major Outage';
    default: return 'Status Unknown';
  }
}

/** Overall status: a failed health probe is always degraded; otherwise the worst published component (operational
 * when none are published). */
export function deriveOverall(components: { status: string }[], healthy: boolean): { status: ComponentStatus; label: string; healthy: boolean } {
  if (!healthy) return { status: 'major_outage', label: 'Service degraded', healthy: false };
  if (!components.length) return { status: 'operational', label: statusLabel('operational'), healthy: true };
  const worstRank = components.reduce((m, c) => Math.max(m, RANK[c.status] ?? 0), 0);
  const status = ((Object.keys(RANK) as ComponentStatus[]).find((k) => RANK[k] === worstRank) || 'operational') as ComponentStatus;
  return { status, label: statusLabel(status), healthy: status === 'operational' };
}

/** `lastCheckedAt` is status_components.updated_at — when this component's status was last written.
 *  It is the ONLY per-component metric with a real source: the table has no response-time or uptime columns,
 *  so those stay off the screen rather than being invented. */
export type ProductUpdate = { id: string; version: string | null; title: string; category: string | null; body: string | null; publishedAt: string | null };

function iso(v: any): string | null { return v ? new Date(v).toISOString() : null; }

export class StatusService {
  constructor(private readonly db: Kysely<DB> | null) {}

  private async healthy(): Promise<boolean> {
    if (!this.db) return true; // DB-free dev/test: report operational
    try { await sql`SELECT 1`.execute(this.db); return true; } catch { return false; }
  }
  private async rows<T>(text: ReturnType<typeof sql>): Promise<T[]> {
    if (!this.db) return [];
    try { const r = await text.execute(this.db); return ((r as any).rows || []) as T[]; } catch { return []; }
  }

  async status(): Promise<HelpSystemStatus> {
    const healthy = await this.healthy();
    const comps = await this.rows<any>(sql`SELECT key, name, status, updated_at FROM status_components ORDER BY sort_order, name`);
    const components = comps.map((c) => ({ key: c.key, name: c.name, status: c.status, lastCheckedAt: iso(c.updated_at) }));
    const inc = await this.rows<any>(sql`SELECT id, title, status, impact, started_at, resolved_at FROM status_incidents ORDER BY started_at DESC LIMIT 10`);
    const incidents = inc.map((i) => ({ id: i.id, title: i.title, status: i.status, impact: i.impact, startedAt: iso(i.started_at), resolvedAt: iso(i.resolved_at) }));
    return { overall: deriveOverall(components, healthy), components, incidents };
  }

  async updates(limit = 8): Promise<ProductUpdate[]> {
    const lim = Math.min(50, Math.max(1, limit));
    const rows = await this.rows<any>(sql`SELECT id, version, title, category, body, published_at FROM product_updates ORDER BY published_at DESC LIMIT ${lim}`);
    return rows.map((u) => ({ id: u.id, version: u.version ?? null, title: u.title, category: u.category ?? null, body: u.body ?? null, publishedAt: iso(u.published_at) }));
  }
}
