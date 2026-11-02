import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { LanguageService } from '../account/language.controller';
import { buildAccountOverview, type AccountRows, type PosAccountOverview } from './pos-account-overview.core';

export type AccountContext = { tenantId: string; branchId?: string | null; userId: string; role: string };

/** The signed-in user's own account, their salon, their branches — every read scoped to their tenant. */
@Injectable()
export class PosAccountService {
  constructor(@Optional() @Inject(DATABASE) private readonly db?: AppDatabase) {}

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
        .select(['p.name as plan_name', 's.plan_code', 's.status', 's.current_period_end', 's.monthly_price_cents']).orderBy('s.created_at', 'desc').executeTakeFirst().catch(() => null),
      db.selectFrom('user_branch_access as a').innerJoin('branches as b', 'b.id', 'a.branch_id').where('a.tenant_id', '=', t).where('b.tenant_id', '=', t).where('a.user_id', '=', ctx.userId)
        .select(['b.name', 'b.address', 'b.city', 'b.state', 'a.role', 'a.access_level', 'b.status']).orderBy('b.name').execute().catch(() => []),
      db.selectFrom('users').where('tenant_id', '=', t).where('status', '=', 'active').select(['role']).select((eb: any) => eb.fn.countAll().as('n')).groupBy('role').execute().catch(() => []),
      db.selectFrom('branches').where('tenant_id', '=', t).where('deleted_at', 'is', null).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => null),
      // WP-A: the same answer GET pos/me/locale gives (own choice ?? salon default) — not the derived tenants.locale
      new LanguageService(db).posLocale({ userId: ctx.userId, tenantId: t, branchId: ctx.branchId ?? null })
        .catch((e: unknown) => { new Logger('PosAccountService').warn(`language read failed: ${String((e as Error)?.message ?? e)}`); return null; }),
    ]);
    return buildAccountOverview({
      user: user ?? null, tenant: tenant ?? null, branch: branch ?? null, subscription: subscription ?? null,
      branches: (branches as any[]) ?? [], roleCounts: ((roleCounts as any[]) ?? []).map((r) => ({ role: String(r.role ?? ''), n: Number(r.n ?? 0) })),
      activeBranchCount: Number(activeBranches?.n ?? 0),
      language: locale?.language ?? null,
    });
  }
}
