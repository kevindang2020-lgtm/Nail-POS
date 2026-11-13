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
  /** Device Integration Logs 06 (Nov 12 2026): the payment environment these logs come from (optional — no store, no label) */
  paymentEnvironment?(ctx: LogsContext): Promise<LogPaymentEnvironment>;
  /** Device Integration Logs 08 (Nov 12 2026): the exporter's audit row, fail-closed (throws when it cannot be written).
   *  Optional — a store without it cannot export. Only the range, filters and counts are recorded, never the rows. */
  recordExport?(ctx: LogsContext, e: LogExportAudit): Promise<void>;
  /** Device Integration Logs 09 (Nov 12 2026): the salon's rows in the platform's existing retry stores (job queue + outbound
   *  webhook deliveries), read-only. Optional — no store, no retry view. */
  retryQueue?(ctx: LogsContext, p: { page: number; pageSize: number; deadWindowDays: number }): Promise<RetryQueueRead>;
}
export interface RetryRow { id: string; store: 'job' | 'webhook'; type: string; state: 'waiting' | 'retrying' | 'running' | 'dead'; attempt: number; maxAttempts: number;
  nextAttemptAt: string | null; lagSeconds: number | null; lastError: string | null; correlationId: string | null; createdAt: string | null; updatedAt: string | null }
export interface RetryStoreCounts { waiting: number; retrying: number; running: number; dead: number; oldestDueLagSeconds: number | null }
export interface RetryQueueRead { rows: RetryRow[]; total: number; jobs: RetryStoreCounts; webhooks: RetryStoreCounts }
export interface LogExportAudit { from: string; to: string; rows: number; total: number; filters: Record<string, string> }
/** sandbox = test / UAT traffic (never certification or production evidence); production = live merchant. `certification`
 *  is the latest recorded production validation for that processor, null when none is recorded or it cannot be told. */
export interface LogPaymentEnvironment { environment: 'sandbox' | 'production' | null; source: 'branch' | 'salon' | null; processor: string | null; certification: string | null }
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
