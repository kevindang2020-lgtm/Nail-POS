// copilot-usage.service.ts — Super-Admin-only, cross-tenant rollup of Reception Copilot activity (spec §46/§51). The
// canonical source is the audit trail: every confirmed Copilot action emits a `reception_copilot` audit event, so a
// GROUP BY over audit_events gives a complete, honest count (no separate metrics store to drift). Cross-tenant reads
// are legitimate here only because this is reached through the SuperAdminGuard-protected controller. Read-only.
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

export interface CopilotUsageRow { action: string; tenantId: string; count: number }
export interface CopilotUsageSummary {
  available: boolean;
  window: { from: string | null; to: string | null };
  total: number;
  byAction: { action: string; count: number }[];
  byTenant: { tenantId: string; count: number }[];
}

// Pure aggregation — unit-testable without a database.
export function aggregateCopilotUsage(rows: CopilotUsageRow[], window: { from: string | null; to: string | null }): CopilotUsageSummary {
  const byActionMap = new Map<string, number>();
  const byTenantMap = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const c = Number(r.count) || 0;
    total += c;
    byActionMap.set(r.action, (byActionMap.get(r.action) ?? 0) + c);
    byTenantMap.set(r.tenantId, (byTenantMap.get(r.tenantId) ?? 0) + c);
  }
  const byAction = [...byActionMap.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count);
  const byTenant = [...byTenantMap.entries()].map(([tenantId, count]) => ({ tenantId, count })).sort((a, b) => b.count - a.count);
  return { available: true, window, total, byAction, byTenant };
}

@Injectable()
export class CopilotUsageService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  async summary(opts: { from?: string; to?: string } = {}): Promise<CopilotUsageSummary> {
    // Scale guard: never scan all-time across 10k+ tenants. Default to the last 30 days unless an explicit window is
    // given, so the query is always time-bounded and uses the (module, occurred_at) index (migration 308).
    const from = opts.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const window = { from, to: opts.to ?? null };
    if (!this.db) return { available: false, window, total: 0, byAction: [], byTenant: [] };
    const res: any = await sql`
      SELECT action, tenant_id, COUNT(*)::int AS c
      FROM audit_events
      WHERE module = 'reception_copilot'
        AND (${window.from}::timestamptz IS NULL OR occurred_at >= ${window.from}::timestamptz)
        AND (${window.to}::timestamptz IS NULL OR occurred_at <= ${window.to}::timestamptz)
      GROUP BY action, tenant_id
    `.execute(this.db as any);
    const rows: CopilotUsageRow[] = (res.rows || []).map((r: any) => ({ action: r.action, tenantId: r.tenant_id, count: Number(r.c) }));
    return aggregateCopilotUsage(rows, window);
  }
}
