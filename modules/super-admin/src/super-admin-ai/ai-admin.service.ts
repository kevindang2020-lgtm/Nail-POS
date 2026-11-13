// ai-admin.service.ts — Super-Admin AI subscription operations with audit. Lets Super Admin assign/grant-trial,
// update limits/status, and cancel the 15-package subscriptions, plus catalog rollup + usage summary. Audited to
// audit_logs (action_type 'super_admin_ai_*'), mirroring the platform module.
import { sql, type Kysely } from 'kysely';
import { catalogWithRollup, normalizeAssign, normalizeUpdate } from './ai-admin-core';
import type { AiAdminRepo } from './ai-admin.repository';
import { AI_PACKAGES, getAiPackage } from '@aipowersalon/ai';
import { AiPriceTable } from '../tenant-ai/ai-price-table';

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
  /** extras AI Usage Limits 07 (round 11): the Super Admin AI price table (needs the database) */
  priceTable(): AiPriceTable { if (!this.db) throw new AiAdminError('bad_request', 'database_required'); return new AiPriceTable(this.db); }
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

  /** AI Usage & Limits guide §7/§16: Super Admin's GLOBAL availability of one package (platform_ai_package_settings). The
   *  access gate reads it, so turning a package off stops it for every salon at once; the salon screen shows
   *  "Disabled by admin" and never suggests an upgrade restores it. Optimistic version; the platform audit row is written
   *  in the same transaction (no row → no change). */
  async packageAvailability() {
    if (!this.db) return { items: [] as { code: string; enabled: boolean; reason: string | null; version: number; updatedAt: string | null }[] };
    const rows = (await sql<any>`select package_code, enabled, disabled_reason, version, updated_at from platform_ai_package_settings`.execute(this.db)).rows;
    const by = new Map(rows.map((r: any) => [String(r.package_code), r]));
    return { items: AI_PACKAGES.map((p) => { const r: any = by.get(p.code); return { code: p.code, enabled: r ? !!r.enabled : true, reason: r?.disabled_reason ?? null, version: r ? Number(r.version) : 0, updatedAt: r?.updated_at ? new Date(r.updated_at).toISOString() : null }; }) };
  }
  async setPackageAvailability(ctx: AdminCtx, code: string, body: { enabled?: unknown; reason?: unknown; expectedVersion?: unknown }) {
    if (!this.db) throw new AiAdminError('bad_request', 'database_required');
    if (!getAiPackage(code)) throw new AiAdminError('not_found', 'unknown_ai_package');
    if (typeof body.enabled !== 'boolean') throw new AiAdminError('bad_request', 'enabled_required');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!body.enabled && (reason.length < 3 || reason.length > 300)) throw new AiAdminError('bad_request', 'reason_required');
    const expected = Math.trunc(Number(body.expectedVersion));
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'ai-pkg:' + code}))`.execute(trx);
      const cur = (await sql<any>`select enabled, version from platform_ai_package_settings where package_code = ${code}`.execute(trx)).rows[0];
      const version = cur ? Number(cur.version) : 0;
      if (expected !== version) throw new AiAdminError('bad_request', 'version_conflict');
      await sql`insert into platform_ai_package_settings (package_code, enabled, disabled_reason, version, updated_by_user_id)
        values (${code}, ${body.enabled}, ${body.enabled ? null : reason}, 1, ${ctx.userId && /^[0-9a-f-]{36}$/i.test(ctx.userId) ? ctx.userId : null})
        on conflict (package_code) do update set enabled = excluded.enabled, disabled_reason = excluded.disabled_reason, version = platform_ai_package_settings.version + 1,
          updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`.execute(trx);
      await this.audit(ctx, body.enabled ? 'super_admin_ai_package_enabled' : 'super_admin_ai_package_disabled', null,
        { packageCode: code, before: { enabled: cur ? !!cur.enabled : true }, after: { enabled: body.enabled }, reason: body.enabled ? null : reason }, trx, { type: 'ai_package', id: code });
      return { ok: true as const, code, enabled: body.enabled, version: version + 1 };
    });
  }

  /** the file's ONE audit write. With `trx` it is part of that transaction and fails closed (the change rolls back);
   *  without, it keeps its historic best-effort behaviour. */
  private async audit(ctx: AdminCtx, action: string, tenantId: string | null, meta?: Record<string, unknown>, trx?: Kysely<any>, entity: { type: string; id: string | null } = { type: 'tenant_ai_subscription', id: tenantId }) {
    const db = trx ?? this.db; if (!db) return;
    const user = ctx.userId && /^[0-9a-f-]{36}$/i.test(ctx.userId) ? ctx.userId : null;
    const w = sql`insert into audit_logs (id, tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (gen_random_uuid(), ${tenantId}, ${user}, 'SUPER_ADMIN', ${action}, ${entity.type}, ${entity.id}, ${JSON.stringify(meta || {})})`.execute(db);
    if (trx) await w; else await w.catch(() => undefined);
  }

}
