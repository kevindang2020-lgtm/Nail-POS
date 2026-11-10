import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { LanguageService } from '../account/language.controller';
import { buildAccountOverview, type AccountRows, type PosAccountOverview } from './pos-account-overview.core';
import { QuotaService } from '../common/tenant-quotas';

export type AccountContext = { tenantId: string; branchId?: string | null; userId: string; role: string };

/** The signed-in user's own account, their salon, their branches — every read scoped to their tenant. */
@Injectable()
export class PosAccountService {
  constructor(@Optional() @Inject(DATABASE) private readonly db?: AppDatabase, @Optional() private readonly quotas?: QuotaService) {}

  async getOverview(ctx: AccountContext): Promise<PosAccountOverview> {
    const empty: AccountRows = { user: null, tenant: null, branch: null, subscription: null, branches: [], roleCounts: [], activeBranchCount: 0 };
    const db: any = this.db;
    if (!db || !ctx.tenantId) return buildAccountOverview(empty);
    const t = ctx.tenantId;
    const [user, tenant, branch, subscription, branches, roleCounts, activeBranches, locale] = await Promise.all([
      db.selectFrom('users').where('tenant_id', '=', t).where('id', '=', ctx.userId)
        .select(['email', 'normalized_phone', 'role', 'created_at', 'last_login_at', 'password_changed_at']).executeTakeFirst().catch(() => null),
      db.selectFrom('tenants').where('id', '=', t).select(['display_name', 'legal_name', 'business_phone', 'tenant_code']).executeTakeFirst().catch(() => null),
      ctx.branchId ? db.selectFrom('branches').where('tenant_id', '=', t).where('id', '=', ctx.branchId)
        .select(['name', 'address', 'city', 'state', 'zip', 'phone', 'timezone', 'public_display_name']).executeTakeFirst().catch(() => null) : null,
      db.selectFrom('tenant_subscriptions as s').leftJoin('subscription_plans as p', 'p.code', 's.plan_code').where('s.tenant_id', '=', t)
        .select(['p.name as plan_name', 's.plan_code', 's.plan as plan_text', 's.status', 's.current_period_end', 's.monthly_price_cents']).orderBy('s.created_at', 'desc').executeTakeFirst().catch(() => null),
      db.selectFrom('user_branch_access as a').innerJoin('branches as b', 'b.id', 'a.branch_id').where('a.tenant_id', '=', t).where('b.tenant_id', '=', t).where('a.user_id', '=', ctx.userId)
        .select(['b.name', 'b.address', 'b.city', 'b.state', 'a.role', 'a.access_level', 'b.status']).orderBy('b.name').execute().catch(() => []),
      db.selectFrom('users').where('tenant_id', '=', t).where('status', '=', 'active').select(['role']).select((eb: any) => eb.fn.countAll().as('n')).groupBy('role').execute().catch(() => []),
      db.selectFrom('branches').where('tenant_id', '=', t).where('deleted_at', 'is', null).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => null),
      // WP-A: the same answer GET pos/me/locale gives (own choice ?? salon default) — not the derived tenants.locale
      new LanguageService(db).posLocale({ userId: ctx.userId, tenantId: t, branchId: ctx.branchId ?? null })
        .catch((e: unknown) => { new Logger('PosAccountService').warn(`language read failed: ${String((e as Error)?.message ?? e)}`); return null; }),
    ]);
    const usage = await this.storageUsage(t);
    const out = buildAccountOverview({
      user: user ?? null, tenant: tenant ?? null, branch: branch ?? null, subscription: subscription ?? null,
      branches: (branches as any[]) ?? [], roleCounts: ((roleCounts as any[]) ?? []).map((r) => ({ role: String(r.role ?? ''), n: Number(r.n ?? 0) })),
      activeBranchCount: Number(activeBranches?.n ?? 0),
      language: locale?.language ?? null,
    });
    return { ...out, usage };
  }

  /** read-only: bytes recorded by the upload pipeline + the storage quota the guard enforces (tenant → plan → platform) */
  private async storageUsage(tenantId: string): Promise<NonNullable<PosAccountOverview['usage']>> {
    const db: any = this.db;
    const log = new Logger('PosAccountService');
    const row = await db.selectFrom('tenant_storage_usage').where('tenant_id', '=', tenantId).select(['bytes_used', 'updated_at']).executeTakeFirst()
      .catch((e: unknown) => { log.warn(`storage usage read failed: ${String((e as Error)?.message ?? e)}`); return false as const; });
    const lim = this.quotas ? await this.quotas.limitFor(tenantId, 'storage_bytes')
      .catch((e: unknown) => { log.warn(`storage quota read failed: ${String((e as Error)?.message ?? e)}`); return undefined; }) : undefined;
    return {
      // no row yet = nothing uploaded (the table is written on first upload); a failed read stays null
      storageBytesUsed: row === false ? null : row ? Number(row.bytes_used) : 0,
      storageLimitBytes: lim ? lim.limit : null, storageLimitSource: lim ? lim.source : null,
      storageUpdatedAt: row && row.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
  }
}
