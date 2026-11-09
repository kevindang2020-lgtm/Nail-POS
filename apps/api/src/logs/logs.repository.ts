// logs.repository.ts — port + in-memory adapter (dev/offline/test default). Seeded for tenant 'luxe001' only with a
// few recent integration entries so the store isn't empty in dev; production starts empty and is filled by producers.
import type { LogsContext, LogWriteCtx, LogEntryInput } from './logs.dto';
import type { LogFilters } from './logs-core';

export interface StoredLog {
  id: string; category: string; severity: string; source: string; message: string;
  correlationId: string | null; relatedId: string | null; status: string | null; metadata: unknown; createdMs: number; branchId: string | null;
}

export interface LogsRepositoryPort {
  insert(ctx: LogWriteCtx, e: LogEntryInput): Promise<StoredLog>;
  query(ctx: LogsContext, f: LogFilters): Promise<StoredLog[]>;
  /** SUNMI batch 8 (Nov 9 2026): dated, numbered pages + the range's counts (optional — the in-memory store pages in the service) */
  page?(ctx: LogsContext, f: LogPageFilters): Promise<{ rows: StoredLog[]; total: number; summary: LogSummary }>;
}
export interface LogPageFilters extends LogFilters { from?: string; to?: string; page: number; pageSize: number }
export interface LogSummary { events: number; warnings: number; errors: number; device: number; integration: number }

const SEED = 'luxe001';
let seq = 1;

export class InMemoryLogsRepository implements LogsRepositoryPort {
  private byTenant = new Map<string, StoredLog[]>();
  private arr(tenantId: string): StoredLog[] {
    if (!this.byTenant.has(tenantId)) {
      const now = Date.now();
      this.byTenant.set(tenantId, tenantId === SEED ? [
        { id: 'log_seed_1', category: 'integration', severity: 'info', source: 'webhook', message: 'Test delivery to hooks.example.com succeeded', correlationId: null, relatedId: 'wh_seed_1', status: 'delivered', metadata: { status: 200 }, createdMs: now - 600_000, branchId: null },
        { id: 'log_seed_2', category: 'integration', severity: 'info', source: 'google_calendar', message: 'Calendar sync completed', correlationId: null, relatedId: null, status: 'ok', metadata: null, createdMs: now - 3_600_000, branchId: null },
      ] : []);
    }
    return this.byTenant.get(tenantId)!;
  }
  async insert(ctx: LogWriteCtx, e: LogEntryInput): Promise<StoredLog> {
    const row: StoredLog = { id: `log_${seq++}`, category: e.category, severity: e.severity, source: e.source, message: e.message, correlationId: e.correlationId ?? null, relatedId: e.relatedId ?? null, status: e.status ?? null, metadata: e.metadata ?? null, createdMs: Date.now(), branchId: ctx.branchId ?? null };
    this.arr(ctx.tenantId).unshift(row); return { ...row };
  }
  async query(ctx: LogsContext, f: LogFilters): Promise<StoredLog[]> {
    const { matchesFilters } = await import('./logs-core');
    return this.arr(ctx.tenantId)
      .filter((r) => matchesFilters({ category: r.category, severity: r.severity, source: r.source, message: r.message, createdMs: r.createdMs }, f))
      .sort((a, b) => b.createdMs - a.createdMs)
      .slice(0, f.limit)
      .map((r) => ({ ...r }));
  }
}
