// logs.kysely.repository.ts — production adapter over tenant_event_logs. Tenant + branch-or-null scoped on read.
import { escapeLike } from '@aipowersalon/database';   // Security Deep Scan D8: wildcard-escaped LIKE input
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { LogsContext, LogWriteCtx, LogEntryInput } from './logs.dto';
import type { LogsRepositoryPort, StoredLog, LogPageFilters, LogSummary, LogPaymentEnvironment } from './logs.repository';
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
    if (f.relatedId) q = q.where('related_id', '=', f.relatedId);
    if (f.correlationId) q = q.where('correlation_id', '=', f.correlationId);
    const rows = await q.orderBy('created_at', 'desc').limit(f.limit).execute().catch(() => []);
    return rows.map(this.map);
  }

  /** the branch's own merchant account when it has one, else the salon default (the same order the payment router uses) */
  async paymentEnvironment(ctx: LogsContext): Promise<LogPaymentEnvironment> {
    const T = ctx.tenantId; const br = ctx.branchId && /^[0-9a-f-]{36}$/i.test(ctx.branchId) ? ctx.branchId : null;
    const b = br ? (await sql<any>`select processor, environment from payment_merchant_accounts where tenant_id = ${T} and branch_id = ${br} limit 1`.execute(this.db)).rows[0] : undefined;
    const t = b ? undefined : (await sql<any>`select processor, environment from tenant_payment_config where tenant_id = ${T} limit 1`.execute(this.db)).rows[0];
    const row = b ?? t;
    if (!row) return { environment: null, source: null, processor: null, certification: null };
    const processor = String(row.processor ?? '') || null;
    const environment = row.environment === 'production' ? 'production' : row.environment === 'sandbox' ? 'sandbox' : null;
    // validations are recorded per provider name; only an exact match on the stored processor name is reported (no family guessing)
    const v = processor ? (await sql<any>`select status from payment_platform_validations where provider = ${processor} and environment = 'production' order by created_at desc limit 1`.execute(this.db)).rows[0] : undefined;
    return { environment, source: b ? 'branch' : 'salon', processor, certification: v ? String(v.status) : null };
  }

  /** SUNMI batch 8 (Nov 9 2026): the page reads the log store PLUS the real device events already kept by their owners —
   *  display / register / terminal changes (audit_logs) and kiosk events (go_checkin_logs) — as category 'device', so the
   *  Device Logs page is no longer empty while no device writes to tenant_event_logs. No second log store; nothing copied. */
  async page(ctx: LogsContext, f: LogPageFilters): Promise<{ rows: StoredLog[]; total: number; summary: LogSummary }> {
    const T = ctx.tenantId; const br = ctx.branchId || null;
    const lo = f.from ? `${f.from}T00:00:00Z` : null; const hi = f.to ? `${f.to}T23:59:59.999Z` : null;
    // the three table aliases of this UNION, as literal column refs (never request data)
    const COLS = { a: { b: sql.ref('a.branch_id'), c: sql.ref('a.created_at') }, e: { b: sql.ref('e.branch_id'), c: sql.ref('e.created_at') }, l: { b: sql.ref('l.branch_id'), c: sql.ref('l.created_at') } } as const;
    const scope = (a: keyof typeof COLS) => br ? sql`AND (${COLS[a].b} = ${br} OR ${COLS[a].b} IS NULL)` : sql``;
    const range = (a: keyof typeof COLS) => sql`${lo ? sql`AND ${COLS[a].c} >= ${lo}` : sql``} ${hi ? sql`AND ${COLS[a].c} <= ${hi}` : sql``}`;
    const devSev = (col: any) => sql`CASE WHEN ${col} ~* '(revoked|failed|error|offline|expired|disabled)' THEN 'warning' ELSE 'info' END`;
    const all = sql`
      SELECT e.id::text AS id, e.category, e.severity, e.source, e.message, e.correlation_id, e.related_id, e.status, e.metadata, e.created_at
        FROM tenant_event_logs e WHERE e.tenant_id = ${T} ${scope('e')} ${range('e')}
      UNION ALL
      SELECT a.id::text, 'device', ${devSev(sql`a.action_type`)}, a.entity_type, replace(a.action_type, '_', ' '), NULL, a.entity_id::text, NULL, NULL, a.created_at
        FROM audit_logs a WHERE a.tenant_id = ${T} AND a.entity_type = ANY(${['customer_display', 'pos_station', 'payment_terminal']}::text[]) ${scope('a')} ${range('a')}
      UNION ALL
      SELECT l.id::text, 'device', ${devSev(sql`l.event_type`)}, 'kiosk', COALESCE(l.safe_message, replace(l.event_type, '_', ' ')), NULL, l.device_id::text, NULL, NULL, l.created_at
        FROM go_checkin_logs l WHERE l.tenant_id = ${T} ${scope('l')} ${range('l')}`;
    const where = sql.join([sql`TRUE`,
      ...(f.category ? [sql`x.category = ${f.category}`] : []), ...(f.severity ? [sql`x.severity = ${f.severity}`] : []),
      ...(f.source ? [sql`lower(x.source) = ${f.source}`] : []),
      ...(f.search ? [sql`lower(x.message || ' ' || x.source) LIKE ${'%' + escapeLike(String(f.search).toLowerCase()) + '%'}`] : []),
      ...(f.relatedId ? [sql`x.related_id = ${f.relatedId}`] : []), ...(f.correlationId ? [sql`x.correlation_id = ${f.correlationId}`] : [])], sql` AND `);
    const rows = await sql<any>`SELECT x.* FROM (${all}) x WHERE ${where}
        ORDER BY x.created_at DESC, x.id DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`.execute(this.db);
    const sum = await sql<any>`SELECT count(*)::int AS events, count(*) FILTER (WHERE x.severity = 'warning')::int AS warnings,
        count(*) FILTER (WHERE x.severity IN ('error', 'critical'))::int AS errors, count(*) FILTER (WHERE x.category = 'device')::int AS device,
        count(*) FILTER (WHERE x.category = 'integration')::int AS integration FROM (${all}) x WHERE ${where}`.execute(this.db);
    const s = sum.rows[0] ?? {};
    return { rows: rows.rows.map((r: any) => this.map(r)), total: Number(s.events ?? 0),   // the count comes from the summary (a page past the end still knows the total)
      summary: { events: Number(s.events ?? 0), warnings: Number(s.warnings ?? 0), errors: Number(s.errors ?? 0), device: Number(s.device ?? 0), integration: Number(s.integration ?? 0) } };
  }
}
