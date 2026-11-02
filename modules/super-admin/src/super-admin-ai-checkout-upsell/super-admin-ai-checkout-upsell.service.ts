// super-admin-ai-checkout-upsell.service.ts — platform oversight for ai_checkout_upsell. Exposes only platform-
// OPERATIONAL aggregates (counts + rates, never cross-tenant individual customer data) plus a controlled, audited
// support-mode per-tenant drill-down. The SuperAdminGuard on the controller is the auth boundary.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AppDatabase } from '@aipowersalon/database';
import type { AuditService } from '@aipowersalon/audit';

export interface SuperAdminCtx { userId?: string; email?: string; ip?: string }

export interface UpsellPlatformOverview {
  totalTenants: number; tenantsDisabled: number; tenantsEnabled: number;
  recommendationsGenerated: number; recommendationsApplied: number; recommendationsDismissed: number;
  acceptanceRatePct: number | null; generatedAt: string;
}

/** PURE: shape platform counts. acceptanceRate = applied / generated (null when nothing generated — never fabricated). */
export function buildPlatformOverview(input: {
  totalTenants: number; disabledRows: Array<{ enabled: boolean | null }>;
  generated: number; applied: number; dismissed: number;
}): UpsellPlatformOverview {
  const disabled = input.disabledRows.filter(r => r.enabled === false).length;
  const rate = input.generated > 0 ? Math.round((input.applied / input.generated) * 1000) / 10 : null;
  return {
    totalTenants: input.totalTenants, tenantsDisabled: disabled, tenantsEnabled: Math.max(0, input.totalTenants - disabled),
    recommendationsGenerated: input.generated, recommendationsApplied: input.applied, recommendationsDismissed: input.dismissed,
    acceptanceRatePct: rate, generatedAt: new Date().toISOString(),
  };
}

export interface UpsellTenantView {
  tenantId: string; disabled: boolean;
  generated: number; applied: number; dismissed: number; acceptanceRatePct: number | null;
  byType: { type: string; generated: number; applied: number }[];
  supportMode: true; generatedAt: string;
}

/** PURE: shape a single tenant's operational stats for the support-mode drill-down. */
export function buildTenantView(tenantId: string, input: {
  disabled: boolean; generated: number; applied: number; dismissed: number; byType: { type: string; generated: number; applied: number }[];
}): UpsellTenantView {
  const rate = input.generated > 0 ? Math.round((input.applied / input.generated) * 1000) / 10 : null;
  return { tenantId, disabled: input.disabled, generated: input.generated, applied: input.applied, dismissed: input.dismissed, acceptanceRatePct: rate, byType: input.byType, supportMode: true, generatedAt: new Date().toISOString() };
}

export class SuperAdminAiCheckoutUpsellService {
  constructor(private readonly db: AppDatabase, private readonly auditSvc?: AuditService) {}

  async platformOverview(_ctx: SuperAdminCtx): Promise<UpsellPlatformOverview> {
    if (!this.db) return buildPlatformOverview({ totalTenants: 0, disabledRows: [], generated: 0, applied: 0, dismissed: 0 });
    const db = this.db as Kysely<DB>;
    const [tenants, disabledRows, gen, app, dis] = await Promise.all([
      db.selectFrom('tenants').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'active').executeTakeFirst().catch(() => ({ n: 0 })),
      db.selectFrom('ai_checkout_upsell_settings').select(['enabled']).where('level', '=', 'tenant').execute().catch(() => [] as any[]),
      db.selectFrom('ai_checkout_upsell_recommendations').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst().catch(() => ({ n: 0 })),
      db.selectFrom('ai_checkout_upsell_recommendations').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'APPLIED').executeTakeFirst().catch(() => ({ n: 0 })),
      db.selectFrom('ai_checkout_upsell_recommendations').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'DISMISSED').executeTakeFirst().catch(() => ({ n: 0 })),
    ]);
    return buildPlatformOverview({ totalTenants: Number(tenants?.n ?? 0), disabledRows: disabledRows.map(r => ({ enabled: r.enabled ?? null })), generated: Number(gen?.n ?? 0), applied: Number(app?.n ?? 0), dismissed: Number(dis?.n ?? 0) });
  }

  async tenantView(ctx: SuperAdminCtx, tenantId: string, reason: string): Promise<UpsellTenantView> {
    void this.auditSvc?.record(
      { tenantId, branchId: '', userId: ctx.userId || 'super-admin', role: 'SUPER_ADMIN' },
      { module: 'ai_checkout_upsell', action: 'super_admin_tenant_view', resourceType: 'tenant', resourceId: tenantId, metadata: { reason: String(reason || '').slice(0, 200), actorEmail: ctx.email, ip: ctx.ip } },
    );
    if (!this.db) return buildTenantView(tenantId, { disabled: false, generated: 0, applied: 0, dismissed: 0, byType: [] });
    const db = this.db as Kysely<DB>;
    const [disabledRow, gen, app, dis, byType] = await Promise.all([
      db.selectFrom('ai_checkout_upsell_settings').select(['enabled']).where('tenant_id', '=', tenantId).where('level', '=', 'tenant').executeTakeFirst().catch(() => null),
      db.selectFrom('ai_checkout_upsell_recommendations').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => ({ n: 0 })),
      db.selectFrom('ai_checkout_upsell_recommendations').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('status', '=', 'APPLIED').executeTakeFirst().catch(() => ({ n: 0 })),
      db.selectFrom('ai_checkout_upsell_recommendations').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('status', '=', 'DISMISSED').executeTakeFirst().catch(() => ({ n: 0 })),
      db.selectFrom('ai_checkout_upsell_recommendations').select(['type']).select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).groupBy('type').execute().catch(() => [] as any[]),
    ]);
    return buildTenantView(tenantId, {
      disabled: disabledRow?.enabled === false,
      generated: Number(gen?.n ?? 0), applied: Number(app?.n ?? 0), dismissed: Number(dis?.n ?? 0),
      byType: byType.map(r => ({ type: String(r.type), generated: Number(r.n ?? 0), applied: 0 })),
    });
  }
}
