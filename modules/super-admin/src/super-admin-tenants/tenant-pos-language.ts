// tenant-pos-language.ts — English + Vietnamese POS mandate WP-A (§93): the Super Admin views / sets ONE salon's default
// POS language. The authority is the salon-wide `tenant_settings` 'business-branch' row's settings_json.defaultLanguage —
// the same value the owner edits in POS Settings → Business and that `GET pos/me/locale` reads (LanguageService.salonDefault).
// Migration 695's trigger mirrors it to the branch rows and to tenants.locale; nothing here writes those.
//
// A staff member's own choice (users.preferred_language) always wins over this default and is never touched here.
// Every change is audited twice: settings_audit_logs in the same transaction (the salon's own settings trail, §94 parity with
// an owner's change), then the controller writes the Super Admin tenant audit through SuperAdminTenantsService (audit_logs,
// GET super-admin/tenants/:id/audit — the one allowlisted writer, check:audit-writers).
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { safeInet } from '@aipowersalon/database';
import { notifySettingsChanged, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { isAppLanguage, type AppLanguage, type TenantPosLanguage } from '@aipowersalon/api-contracts';

export class TenantPosLanguageError extends Error {
  constructor(readonly code: 'RESOURCE_NOT_FOUND' | 'VALIDATION_FAILED', message: string) { super(message); }
}

export type PosLanguageActor = { userId?: string; ip?: string };

export class TenantPosLanguageService {
  constructor(private readonly db: Kysely<DB>, private readonly rt?: RealtimeEmitter | null) {}

  private async tenantExists(db: Kysely<DB>, tenantId: string): Promise<boolean> {
    const r = await sql<{ n: number }>`select count(*)::int as n from tenants where id::text = ${tenantId}`.execute(db);
    return Number(r.rows[0]?.n ?? 0) > 0;
  }

  async get(tenantId: string, db: Kysely<DB> = this.db): Promise<TenantPosLanguage> {
    if (!(await this.tenantExists(db, tenantId))) throw new TenantPosLanguageError('RESOURCE_NOT_FOUND', 'Tenant not found.');
    const row = await sql<{ lang: string | null; updated_at: unknown }>`select settings_json->>'defaultLanguage' as lang, updated_at
      from tenant_settings where tenant_id = ${tenantId}::uuid and category = 'business-branch' and branch_id is null`.execute(db);
    const v = row.rows[0]?.lang ?? null;
    const language: AppLanguage | null = isAppLanguage(v) ? v : null;
    const counts = await sql<{ lang: string; n: number }>`select preferred_language as lang, count(*)::int as n from users
      where tenant_id = ${tenantId}::uuid and preferred_language in ('en', 'vi') and coalesce(status, 'active') <> 'deleted'
      group by preferred_language`.execute(db);
    const by = Object.fromEntries(counts.rows.map((r) => [r.lang, Number(r.n)]));
    const at = row.rows[0]?.updated_at;
    return {
      tenantId, language, effective: language ?? 'en',
      staffWithOwnChoice: { en: by.en ?? 0, vi: by.vi ?? 0 },
      updatedAt: language && at ? new Date(at as string | Date).toISOString() : null,
    };
  }

  async set(tenantId: string, language: unknown, actor: PosLanguageActor, reason?: string | null): Promise<TenantPosLanguage & { changed: boolean }> {
    if (!isAppLanguage(language)) throw new TenantPosLanguageError('VALIDATION_FAILED', 'Choose English or Vietnamese.');
    if (!actor.userId) throw new TenantPosLanguageError('VALIDATION_FAILED', 'A signed-in Super Admin is required.');
    const out = await this.db.transaction().execute(async (trx) => {
      const before = await this.get(tenantId, trx);
      if (before.language === language) return { ...before, changed: false };
      await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json, updated_by_user_id)
        values (${tenantId}::uuid, null, 'business-branch', jsonb_build_object('defaultLanguage', ${language}::text), ${actor.userId}::uuid)
        on conflict (tenant_id, category) where branch_id is null
        do update set settings_json = tenant_settings.settings_json || jsonb_build_object('defaultLanguage', ${language}::text),
                      updated_by_user_id = ${actor.userId}::uuid, updated_at = now()`.execute(trx);
      const meta = { source: 'super_admin', reason: reason?.trim() || null, changedKeys: ['defaultLanguage'], ip: safeInet(actor.ip) ?? null };
      await sql`insert into settings_audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, before_json, after_json, metadata)
        values (${tenantId}::uuid, null, ${actor.userId}::uuid, 'SUPER_ADMIN', 'pos_settings_default_language_updated', 'business_branch', 'business-branch',
                ${JSON.stringify({ defaultLanguage: before.language })}::jsonb, ${JSON.stringify({ defaultLanguage: language })}::jsonb, ${JSON.stringify(meta)}::jsonb)`.execute(trx);
      return { ...(await this.get(tenantId, trx)), changed: true };
    });
    // the salon's open POS Settings screens re-read Business & Branch (same signal as an owner's own save)
    if (out.changed) notifySettingsChanged(this.rt, tenantId, 'business-branch');
    return out;
  }
}
