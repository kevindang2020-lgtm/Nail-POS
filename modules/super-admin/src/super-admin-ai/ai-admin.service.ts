// ai-admin.service.ts — Super-Admin AI subscription operations with audit. Lets Super Admin assign/grant-trial,
// update limits/status, and cancel the 15-package subscriptions, plus catalog rollup + usage summary. Audited to
// audit_logs (action_type 'super_admin_ai_*'), mirroring the platform module.
import { sql, type Kysely } from 'kysely';
import { catalogWithRollup, normalizeAssign, normalizeUpdate } from './ai-admin-core';
import type { AiAdminRepo } from './ai-admin.repository';

export class AiAdminError extends Error { constructor(public code: 'not_found' | 'bad_request', message: string) { super(message); } }
export interface AdminCtx { userId?: string; ip?: string }

export class AiAdminService {
  constructor(private readonly repo: AiAdminRepo, private readonly db: Kysely<any> | null = null) {}

  async catalog() {
    const subs = await this.repo.listSubscriptions();
    const packages = catalogWithRollup(subs);
    const totals = packages.reduce((a, p) => ({ subscribers: a.subscribers + p.subscribers, activeSubscribers: a.activeSubscribers + p.activeSubscribers, mrrCents: a.mrrCents + p.mrrCents }), { subscribers: 0, activeSubscribers: 0, mrrCents: 0 });
    return { packages, totals };
  }
  packageTenants(code: string) { return this.repo.packageTenants(code); }
  usageSummary() { return this.repo.usageSummary(); }
  usageStats() { return this.repo.usageStats(); }

  async assign(ctx: AdminCtx, tenantId: string, body: any) {
    const norm = normalizeAssign(body || {});
    if (!norm.ok) throw new AiAdminError('bad_request', norm.error);
    await this.repo.upsert(tenantId, norm.value);
    await this.audit(ctx, 'super_admin_ai_subscription_assigned', tenantId, { packageCode: norm.value.packageCode, status: norm.value.status, usageLimit: norm.value.usageLimit, trialEndsAt: norm.value.trialEndsAt });
    return { ok: true as const, tenantId, ...norm.value };
  }
  async update(ctx: AdminCtx, tenantId: string, code: string, body: any) {
    const norm = normalizeUpdate(body || {});
    if (!norm.ok) throw new AiAdminError('bad_request', norm.error);
    const ok = await this.repo.update(tenantId, code, norm.value);
    if (!ok) throw new AiAdminError('not_found', 'subscription_not_found');
    await this.audit(ctx, 'super_admin_ai_subscription_updated', tenantId, { packageCode: code, ...norm.value });
    return { ok: true as const };
  }
  async cancel(ctx: AdminCtx, tenantId: string, code: string) {
    const ok = await this.repo.cancel(tenantId, code);
    if (!ok) throw new AiAdminError('not_found', 'subscription_not_found');
    await this.audit(ctx, 'super_admin_ai_subscription_cancelled', tenantId, { packageCode: code });
    return { ok: true as const };
  }

  private async audit(ctx: AdminCtx, action: string, tenantId: string, meta?: Record<string, unknown>) {
    if (!this.db) return;
    await this.db.insertInto('audit_logs' as any).values({
      id: sql`gen_random_uuid()` as any, tenant_id: tenantId as any, user_id: (ctx.userId || null) as any, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'tenant_ai_subscription', entity_id: tenantId, metadata_json: JSON.stringify(meta || {}) as any,
    } as any).execute().catch(() => undefined);
  }
}
