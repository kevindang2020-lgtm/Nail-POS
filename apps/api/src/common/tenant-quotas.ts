// tenant-quotas.ts — BUILD_PLAN Phase 11 (Constitution 4 §113/§160): ONE read API for every per-salon quota,
// `QuotaService.limitFor(tenantId, kind)`, over the sources that already exist plus the two tables migration 552 adds.
//
//   kind                         source (first that answers)
//   api_requests_per_min         tenant_quotas → plan_quota_defaults → env RATE_LIMIT_MAX_PER_TENANT (600)
//   jobs_in_flight               tenant_quotas → plan_quota_defaults → env JOBS_PER_TENANT_CAP (3)   (claimJobs reads the same rows)
//   storage_bytes                tenant_quotas → plan_quota_defaults → unlimited
//   ai_budget_daily_micro_usd    ai_budgets (tenant, '*', daily)    — the AI platform enforces it (437); read here only
//   ai_budget_monthly_micro_usd  ai_budgets (tenant, '*', monthly)
//   sms_cycle_allowance          the open SMS package cycle, when its hard limit is on (427) — the SMS gate enforces it
//
// Enforcement added here: storage bytes on upload (StorageQuotaGuard — reserve before the upload, release when it
// fails) → 429 QUOTA_EXCEEDED with the limit. Jobs in flight is enforced by the queue's claim. The API-requests quota is
// read by the per-tenant limiter.
import { CanActivate, ExecutionContext, Global, HttpException, Inject, Injectable, Module, Optional } from '@nestjs/common';
import { STORAGE_QUOTA } from '@aipowersalon/media';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { isPlatformPrincipal } from '@aipowersalon/permissions';
import { registry } from '@aipowersalon/observability';

export const QUOTA_KINDS = ['api_requests_per_min', 'jobs_in_flight', 'storage_bytes', 'ai_budget_daily_micro_usd', 'ai_budget_monthly_micro_usd', 'sms_cycle_allowance'] as const;
export type QuotaKind = (typeof QUOTA_KINDS)[number];
export const EDITABLE_QUOTA_KINDS = ['api_requests_per_min', 'jobs_in_flight', 'storage_bytes'] as const;
export type EditableQuotaKind = (typeof EDITABLE_QUOTA_KINDS)[number];
export type QuotaSource = 'tenant' | 'plan' | 'platform' | 'ai_budgets' | 'sms_package' | 'none';
export interface QuotaLimit { kind: QuotaKind; limit: number | null; source: QuotaSource }

export const quotaRejections = registry.counter('aipowersalon_quota_rejections_total', 'Requests refused by a per-salon quota', ['kind']);

/** The platform default for an editable kind (env-tunable, unchanged from before Phase 11). null = unlimited. */
export function platformQuotaDefault(kind: EditableQuotaKind, env: NodeJS.ProcessEnv = process.env): number | null {
  if (kind === 'api_requests_per_min') return Number(env.RATE_LIMIT_MAX_PER_TENANT) || 600;
  if (kind === 'jobs_in_flight') return Number(env.JOBS_PER_TENANT_CAP) || 3;
  return null;
}

/** Pure: tenant override → plan default → platform default. A null column means "inherit". */
export function resolveQuota(kind: EditableQuotaKind, tenant: Record<string, unknown> | null, plan: Record<string, unknown> | null, env: NodeJS.ProcessEnv = process.env): QuotaLimit {
  const v = (row: Record<string, unknown> | null) => (row && row[kind] != null ? Number(row[kind]) : null);
  const t = v(tenant); if (t !== null) return { kind, limit: t, source: 'tenant' };
  const p = v(plan); if (p !== null) return { kind, limit: p, source: 'plan' };
  const d = platformQuotaDefault(kind, env);
  return { kind, limit: d, source: d === null ? 'none' : 'platform' };
}

export class QuotaExceededError extends HttpException {
  constructor(readonly kind: QuotaKind, readonly limit: number, readonly used: number, message?: string) {
    super({ statusCode: 429, code: 'QUOTA_EXCEEDED', error: 'Too Many Requests', kind, limit, used,
      message: message ?? `This salon has reached its ${kind.replace(/_/g, ' ')} quota (${limit}).` }, 429);
  }
}

const TTL_MS = 30_000;

@Injectable()
export class QuotaService {
  private cache = new Map<string, { v: QuotaLimit; exp: number }>();
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null, private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** The tenant's own row and its active plan's default row (either may be null). */
  async rows(tenantId: string): Promise<{ tenant: Record<string, unknown> | null; plan: (Record<string, unknown> & { plan_code?: string }) | null }> {
    if (!this.db) return { tenant: null, plan: null };
    const r: any = (await sql`
      SELECT row_to_json(tq) AS tenant, row_to_json(pd) AS plan
        FROM (SELECT ${tenantId}::uuid AS id) x
        LEFT JOIN tenant_quotas tq ON tq.tenant_id = x.id
        LEFT JOIN LATERAL (
          SELECT d.*, p.code AS plan_code FROM tenant_subscriptions s
            JOIN subscription_plans p ON lower(p.code) = lower(s.plan) OR lower(p.name) = lower(s.plan)
            JOIN plan_quota_defaults d ON d.plan_id = p.id
           WHERE s.tenant_id = x.id AND lower(s.status) = 'active'
           ORDER BY s.current_period_end DESC NULLS LAST LIMIT 1) pd ON true`.execute(this.db as any)).rows[0];
    return { tenant: r?.tenant ?? null, plan: r?.plan ?? null };
  }

  /** The ONE read API (§113/§160). Cached 30 s per (tenant, kind); a read error fails OPEN to the platform default. */
  async limitFor(tenantId: string, kind: QuotaKind): Promise<QuotaLimit> {
    const k = `${tenantId}|${kind}`;
    const hit = this.cache.get(k);
    if (hit && hit.exp > Date.now()) return hit.v;
    let v: QuotaLimit;
    try { v = await this.read(tenantId, kind); }
    catch { v = (EDITABLE_QUOTA_KINDS as readonly string[]).includes(kind) ? resolveQuota(kind as EditableQuotaKind, null, null, this.env) : { kind, limit: null, source: 'none' }; }
    this.cache.set(k, { v, exp: Date.now() + TTL_MS });
    return v;
  }

  private async read(tenantId: string, kind: QuotaKind): Promise<QuotaLimit> {
    if ((EDITABLE_QUOTA_KINDS as readonly string[]).includes(kind)) {
      const { tenant, plan } = await this.rows(tenantId);
      return resolveQuota(kind as EditableQuotaKind, tenant, plan, this.env);
    }
    if (!this.db) return { kind, limit: null, source: 'none' };
    if (kind === 'ai_budget_daily_micro_usd' || kind === 'ai_budget_monthly_micro_usd') {
      const period = kind === 'ai_budget_daily_micro_usd' ? 'daily' : 'monthly';
      const r: any = (await sql`SELECT limit_micro_usd FROM ai_budgets WHERE tenant_id = ${tenantId} AND scope_key = '*' AND period = ${period}`.execute(this.db as any)).rows[0];
      const lim = r ? Number(r.limit_micro_usd) : 0;
      return lim > 0 ? { kind, limit: lim, source: 'ai_budgets' } : { kind, limit: null, source: 'none' };   // <= 0 = no limit (437's convention)
    }
    // sms_cycle_allowance: only a HARD limit is a quota; a soft package bills overage instead of refusing
    const c: any = (await sql`
      SELECT c.included_count, c.credit_allowance, c.hard_limit_enabled, s.custom_allowance
        FROM tenant_sms_billing_cycles c
        LEFT JOIN tenant_sms_subscriptions s ON s.tenant_id = c.tenant_id AND s.status = 'active'
       WHERE c.tenant_id = ${tenantId} AND c.status = 'open' ORDER BY c.cycle_start DESC LIMIT 1`.execute(this.db as any)).rows[0];
    if (!c || !c.hard_limit_enabled) return { kind, limit: null, source: 'none' };
    return { kind, limit: Number(c.included_count) + Number(c.credit_allowance ?? 0) + Number(c.custom_allowance ?? 0), source: 'sms_package' };
  }

  async storageUsed(tenantId: string): Promise<number> {
    if (!this.db) return 0;
    const r: any = (await sql`SELECT bytes_used FROM tenant_storage_usage WHERE tenant_id = ${tenantId}`.execute(this.db as any)).rows[0];
    return r ? Number(r.bytes_used) : 0;
  }

  /**
   * Reserve `bytes` of the tenant's storage quota. One conditional statement, so two concurrent uploads cannot both pass
   * under the limit. Throws QuotaExceededError (429) when it would go over. No limit → the bytes are still counted.
   */
  async reserveStorage(tenantId: string, bytes: number): Promise<void> {
    if (!this.db || !(bytes > 0)) return;
    const { limit } = await this.limitFor(tenantId, 'storage_bytes');
    const n = Math.ceil(bytes);
    if (limit !== null && n > limit) { quotaRejections.inc({ kind: 'storage_bytes' }); throw new QuotaExceededError('storage_bytes', limit, await this.storageUsed(tenantId)); }
    const r: any = (await sql`
      INSERT INTO tenant_storage_usage (tenant_id, bytes_used, uploads) VALUES (${tenantId}, ${n}, 1)
      ON CONFLICT (tenant_id) DO UPDATE SET bytes_used = tenant_storage_usage.bytes_used + EXCLUDED.bytes_used,
        uploads = tenant_storage_usage.uploads + 1, updated_at = now()
      WHERE ${limit === null} OR tenant_storage_usage.bytes_used + EXCLUDED.bytes_used <= ${limit ?? 0}
      RETURNING bytes_used`.execute(this.db as any)).rows[0];
    if (!r) { quotaRejections.inc({ kind: 'storage_bytes' }); throw new QuotaExceededError('storage_bytes', limit ?? 0, await this.storageUsed(tenantId)); }
  }

  /** Give back a reservation whose upload failed. */
  async releaseStorage(tenantId: string, bytes: number): Promise<void> {
    if (!this.db || !(bytes > 0)) return;
    await sql`UPDATE tenant_storage_usage SET bytes_used = greatest(0, bytes_used - ${Math.ceil(bytes)}), uploads = greatest(0, uploads - 1), updated_at = now()
              WHERE tenant_id = ${tenantId}`.execute(this.db as any);
  }

  clear(): void { this.cache.clear(); }
}

/**
 * Storage quota on upload: a multipart request from a salon reserves its Content-Length against the salon's
 * storage_bytes quota BEFORE the upload interceptor reads the body, and releases it if the request fails. A global
 * guard (runs after TenantContextMiddleware); requests without a tenant, Super Admin, and non-multipart requests pass.
 */
@Injectable()
export class StorageQuotaGuard implements CanActivate {
  constructor(private readonly quotas: QuotaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req: any = context.switchToHttp().getRequest();
    const ctype = String(req?.headers?.['content-type'] ?? '');
    if (!/^multipart\//i.test(ctype)) return true;
    const tenantId = req?.ctx?.tenantId;
    if (!tenantId || isPlatformPrincipal(req.ctx)) return true;
    const bytes = Number(req?.headers?.['content-length'] ?? 0);
    if (!(bytes > 0)) return true;
    await this.quotas.reserveStorage(String(tenantId), bytes);
    const res: any = context.switchToHttp().getResponse();
    let settled = false;
    // finished with a 2xx → the bytes stay counted; an error status or a connection closed before the response → released
    const settle = (finished: boolean) => {
      if (settled) return; settled = true;
      const ok = finished && Number(res?.statusCode) >= 200 && Number(res?.statusCode) < 300;
      if (!ok) void this.quotas.releaseStorage(String(tenantId), bytes).catch(() => undefined);
    };
    res?.once?.('finish', () => settle(true)); res?.once?.('close', () => settle(false));
    return true;
  }
}

// Phase 12 (#34): GLOBAL, so every module's JSON-body / presigned upload (salon logo, support attachments, OCR receipts,
// safety evidence) can charge the salon's storage quota through @aipowersalon/media's STORAGE_QUOTA port — the multipart
// guard above only ever sees multipart requests
@Global()
@Module({
  providers: [{ provide: QuotaService, useFactory: (db: AppDatabase | null) => new QuotaService(db), inject: [{ token: DATABASE, optional: true }] }, StorageQuotaGuard, { provide: STORAGE_QUOTA, useExisting: QuotaService }],
  exports: [QuotaService, StorageQuotaGuard, STORAGE_QUOTA],
})
export class QuotaModule {}
