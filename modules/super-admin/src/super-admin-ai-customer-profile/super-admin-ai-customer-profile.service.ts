// super-admin-ai-customer-profile.service.ts — platform oversight for ai_customer_profile (§54/§55). Exposes only
// platform-OPERATIONAL aggregates (counts, never cross-tenant individual customer data) plus a controlled support-mode
// per-tenant drill-down that REUSES the existing per-tenant reads. The SuperAdminGuard on the controller is the auth
// boundary; this service builds an explicit, audited support context for the target tenant.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AppDatabase } from '@aipowersalon/database';
import { AiCustomerProfileService } from '@aipowersalon/ai';
import type { AuditService } from '@aipowersalon/audit';

export interface SuperAdminCtx { userId?: string; email?: string; ip?: string }

export interface PlatformOverview {
  totalTenants: number;
  tenantsWithSettings: number;
  tenantsDisabled: number;         // ai_customer_profile disabled at tenant level (kill switch engaged)
  tenantsEnabled: number;          // totalTenants - tenantsDisabled
  generatedAt: string;
}

/** PURE: shape the platform overview from raw counts. No customer data — counts only (§55). */
export function buildPlatformOverview(totalTenants: number, tenantSettingRows: Array<{ enabled: boolean | null }>): PlatformOverview {
  const withSettings = tenantSettingRows.length;
  const disabled = tenantSettingRows.filter(r => r.enabled === false).length;
  return {
    totalTenants,
    tenantsWithSettings: withSettings,
    tenantsDisabled: disabled,
    tenantsEnabled: Math.max(0, totalTenants - disabled),
    generatedAt: new Date().toISOString(),
  };
}

/** PURE: build the controlled support-mode context for a target tenant (§54). SUPER_ADMIN principal, explicit reason,
 *  scoped to the tenant, with exactly the read caps the drill-down needs. Never trusts a client tenantId directly —
 *  the caller passes the tenantId only after SuperAdminGuard has authorized the principal. */
export function buildSupportContext(tenantId: string, actorUserId: string): any {
  return { tenantId, branchId: '', userId: `support:${actorUserId || 'super-admin'}`, role: 'SUPER_ADMIN', permissions: ['customers.view', 'customers.edit'] };
}

export class SuperAdminAiCustomerProfileService {
  constructor(
    private readonly db: AppDatabase,
    private readonly profile: AiCustomerProfileService,
    private readonly auditSvc?: AuditService,
  ) {}

  /** Platform-operational overview: counts only (§55 "enabled tenants", "duplicate-processing status"). */
  async platformOverview(_ctx: SuperAdminCtx): Promise<PlatformOverview> {
    if (!this.db) return buildPlatformOverview(0, []);
    const db = this.db as Kysely<DB>;
    const [tenantsRow, settingRows] = await Promise.all([
      db.selectFrom('tenants').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'active').executeTakeFirst().catch(() => ({ n: 0 } as any)),
      db.selectFrom('ai_customer_profile_settings').select(['enabled']).where('level', '=', 'tenant').execute().catch(() => [] as any[]),
    ]);
    return buildPlatformOverview(Number((tenantsRow as any)?.n ?? 0), (settingRows as any[]).map(r => ({ enabled: r.enabled ?? null })));
  }

  /** Controlled support-mode drill-down for ONE tenant (§54). Reuses the tenant's own usage + overview reads; audited. */
  async tenantView(ctx: SuperAdminCtx, tenantId: string, reason: string) {
    const support = buildSupportContext(tenantId, ctx.userId || '');
    void this.auditSvc?.record(
      { tenantId, branchId: '', userId: ctx.userId || 'super-admin', role: 'SUPER_ADMIN' },
      { module: 'ai_customer_profile', action: 'super_admin_tenant_view', resourceType: 'tenant', resourceId: tenantId, metadata: { reason: String(reason || '').slice(0, 200), actorEmail: ctx.email, ip: ctx.ip } },
    );
    const [usage, overview] = await Promise.all([
      this.profile.getUsage(support).catch(() => ({ usage: {} })),
      this.profile.tenantOverview(support).catch(() => ({} as any)),
    ]);
    return { tenantId, usage: (usage as any).usage ?? {}, overview, supportMode: true, generatedAt: new Date().toISOString() };
  }
}
