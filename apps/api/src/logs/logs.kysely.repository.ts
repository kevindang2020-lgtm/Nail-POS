// logs.kysely.repository.ts — production adapter over tenant_event_logs. Tenant + branch-or-null scoped on read.
import { escapeLike } from '@aipowersalon/database';   // Security Deep Scan D8: wildcard-escaped LIKE input
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { LogsContext, LogWriteCtx, LogEntryInput } from './logs.dto';
import type { LogsRepositoryPort, StoredLog } from './logs.repository';
import type { LogFilters } from './logs-core';

const toMs = (v: unknown): number => { if (v instanceof Date) return v.getTime(); const n = Date.parse(String(v)); return Number.isNaN(n) ? Date.now() : n; };

export class KyselyLogsRepository implements LogsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private map = (r: any): StoredLog => ({ id: r.id, category: r.category, severity: r.severity, source: r.source, message: r.message, correlationId: r.correlation_id ?? null, relatedId: r.related_id ?? null, status: r.status ?? null, metadata: r.metadata ?? null, createdMs: toMs(r.created_at), branchId: r.branch_id ?? null });

  async insert(ctx: LogWriteCtx, e: LogEntryInput): Promise<StoredLog> {
    const r = await this.db.insertInto('tenant_event_logs').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, category: e.category, severity: e.severity, source: e.source, message: e.message, correlation_id: e.correlationId ?? null, related_id: e.relatedId ?? null, status: e.status ?? null, metadata: (e.metadata ?? null) }).returningAll().executeTakeFirstOrThrow();
    return this.map(r);
  }
  async query(ctx: LogsContext, f: LogFilters): Promise<StoredLog[]> {
    let q = this.db.selectFrom('tenant_event_logs').selectAll().where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]));
    if (f.category) q = q.where('category', '=', f.category);
    if (f.severity) q = q.where('severity', '=', f.severity);
    if (f.source) q = q.where(sql`lower(source)`, '=', f.source);
    if (f.search) q = q.where(sql`lower(message || ' ' || source)`, 'like', `%${escapeLike(String(f.search).toLowerCase())}%`);
    const rows = await q.orderBy('created_at', 'desc').limit(f.limit).execute().catch(() => []);
    return rows.map(this.map);
  }
}
