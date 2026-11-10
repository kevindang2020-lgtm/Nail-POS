// settings.kysely.repository.ts — production SettingsRepositoryPort over Postgres (Kysely).
// subscriptionPlan.aiPackage/aiFeatures are LIVE-resolved on every read from tenant_ai_packages (+ per-feature
// overrides in tenant_ai_features) using the same effective rule the Super Admin view uses — single source of truth.
// Near-fully-real: the generic per-category JSONB store `tenant_settings` (one row per (tenant, branch, category))
// persists every editable settings category for REAL — getRaw assembles RawSettings by overlaying each stored row's
// settings_json onto the DEFAULT_SETTINGS template, and saveCategory upserts the matching category row. The audit
// trail is REAL too: appendAudit inserts into `settings_audit_logs` (before_json/after_json + changedKeys/ip/ua folded
// into the metadata JSONB) and listAudit reads it back, tenant/branch-scoped, newest first.
//
// Honest, documented exception (NOT faked): the Fiserv payments SECRET and live MID have no column in this schema
// (secrets must never be stored in an app table), so they are read from server-side env (FISERV_SECRET /
// FISERV_MERCHANT_ID). With no env configured there is no live MID, so payments correctly reports not-live and the
// credential surfaces as '' (masked only) — matching the in-memory adapter's honest "not configured" behavior.
import { withoutRetiredQueueWorkflowKeys } from './settings.dto';
import { effectiveAiFeatures, isAiEnabled } from '@aipowersalon/platform';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { POSSettingsAuditLogRow, SettingsCategory, SettingsContext, DEFAULT_SETTINGS, maskSecret } from './settings.dto';
import { SettingsRepositoryPort, RawSettings, CAT_TO_KEY } from './settings.repository';

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
const parseJson = (v: any): any => { if (v == null) return undefined; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };

export class KyselySettingsRepository implements SettingsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private branchEq(eb: any, ctx: SettingsContext) { return ctx.branchId ? eb('branch_id', '=', ctx.branchId) : eb('branch_id', 'is', null); }

  async getRaw(ctx: SettingsContext): Promise<RawSettings> {
    const base = clone(DEFAULT_SETTINGS) as RawSettings;
    const rows = await this.db.selectFrom('tenant_settings')
      .where('tenant_id', '=', ctx.tenantId).where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId || ''), eb('branch_id', 'is', null)]))
      .select(['category', 'settings_json']).execute().catch(() => []);
    for (const row of rows) {
      const field = CAT_TO_KEY[row.category as SettingsCategory];
      const val = parseJson(row.settings_json);
      if (field && val && typeof val === 'object') base[field] = { ...base[field], ...val };
    }
    // BUILD_PLAN Phase 6: stored rows still carry the retired queue switches (autoAssign / assignBy) — the AI queue
    // assignment settings own them now; never hand them back to a client that might think they work
    (base as any).queueWorkflow = withoutRetiredQueueWorkflowKeys((base as any).queueWorkflow ?? {});
    // live AI overlay (Super Admin -> tenant flow, master doc §7): latest package row wins; overrides refine within it
    try {
      const pkgRow: any = await this.db.selectFrom('tenant_ai_packages').select(['package'])
        .where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      const pkg = String(pkgRow?.package ?? 'None');
      const featRows: any[] = await this.db.selectFrom('tenant_ai_features')
        .select(['feature_key', 'enabled']).where('tenant_id', '=', ctx.tenantId).execute().catch(() => []);
      const overrides = new Map<string, boolean>(featRows.map((f) => [String(f.feature_key), !!f.enabled]));
      base.subscriptionPlan = {
        ...base.subscriptionPlan,
        aiPackage: pkg,
        aiPackageIncluded: isAiEnabled(pkg),
        aiFeatures: effectiveAiFeatures(pkg, overrides),
      };
    } catch { /* keep template values if the AI tables are unreachable */ }
    // batch 8 decision 8: the plan, tier, status and counts come from the authoritative rows — never a sample.
    // plan = the subscription's own text; tier = the catalogue plan it maps to (linked code first); "" when none.
    const sub: any = await sql`SELECT s.plan, s.status, p.name AS catalog_name FROM tenant_subscriptions s
        LEFT JOIN subscription_plans p ON lower(p.code) = lower(coalesce(s.plan_code, '')) OR lower(p.code) = lower(s.plan) OR lower(p.name) = lower(s.plan)
       WHERE s.tenant_id = ${ctx.tenantId} AND lower(s.status) <> 'cancelled' ORDER BY s.created_at DESC, (lower(p.code) = lower(coalesce(s.plan_code, ''))) DESC LIMIT 1`
      .execute(this.db).then((r: any) => r.rows[0] ?? null);
    const counts: any = await sql`SELECT (SELECT count(*)::int FROM customers c WHERE c.tenant_id = ${ctx.tenantId} AND coalesce(c.status, 'active') <> 'merged') AS customers,
        (SELECT count(*)::int FROM technicians t WHERE t.tenant_id = ${ctx.tenantId} AND t.archived_at IS NULL AND coalesce(t.is_active, true)) AS technicians`
      .execute(this.db).then((r: any) => r.rows[0] ?? null);
    base.subscriptionPlan = {
      ...base.subscriptionPlan,
      plan: sub?.plan ? String(sub.plan) : '', tier: sub?.catalog_name ? String(sub.catalog_name) : '', billingStatus: sub?.status ? String(sub.status).toLowerCase() : '',
      customerCount: counts ? Number(counts.customers) : null, technicianCount: counts ? Number(counts.technicians) : null,
      smsThisMonth: null,   // no tenant-facing monthly SMS counter here — the SMS package page owns usage
    };
    return base;
  }

  async saveCategory(ctx: SettingsContext, category: SettingsCategory, value: unknown): Promise<RawSettings> {
    const field = CAT_TO_KEY[category];
    // Business & Branch's time zone IS the location's zone: branches.timezone is what every salon "today", business date,
    // payroll period and report reads (branchTimeZone). Saving it only into the settings blob left a new salon's branch
    // at NULL (the default zone) whatever the owner chose (wave 4 PILOT, Oct 13 2026). The service validated the name.
    const tz = category === 'business-branch' ? (value as any)?.timezone : null;
    if (tz && ctx.branchId) {
      await this.db.updateTable('branches').set({ timezone: String(tz), updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', ctx.branchId).execute();
      clearBranchTimeZoneCache();
    }
    if (field) {
      const existing = await this.db.selectFrom('tenant_settings').select('id')
        .where('tenant_id', '=', ctx.tenantId).where('category', '=', category).where((eb: any) => this.branchEq(eb, ctx))
        .executeTakeFirst().catch(() => undefined);
      const json = JSON.stringify(value);
      // A failed write is an error the owner must see (wave 4 pilot): it used to be swallowed and the save answered 200.
      if (existing) {
        await this.db.updateTable('tenant_settings').set({ settings_json: json, updated_by_user_id: ctx.userId, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', existing.id).execute();
      } else {
        await this.db.insertInto('tenant_settings').values({ tenant_id: ctx.tenantId, branch_id: (ctx.branchId || null), category, settings_json: json, updated_by_user_id: ctx.userId }).execute();
      }
    }
    return this.getRaw(ctx);
  }

  async paymentsCredentialMasked(ctx: SettingsContext): Promise<string> {
    const s = process.env.FISERV_SECRET || '';
    return s ? maskSecret(s) : ''; // '' => not configured (no schema column for secrets; server-only)
  }
  async paymentsConfig(ctx: SettingsContext): Promise<{ merchantId?: string; secret?: string }> {
    return { merchantId: process.env.FISERV_MERCHANT_ID || undefined, secret: process.env.FISERV_SECRET || undefined };
  }

  async appendAudit(row: POSSettingsAuditLogRow): Promise<void> {
    const metadata = { changedKeys: row.changedKeys, ipAddress: row.ipAddress, userAgent: row.userAgent };
    await this.db.insertInto('settings_audit_logs').values({
      tenant_id: row.tenantId, branch_id: (row.branchId || null), user_id: (row.userId || null), role: row.role ?? null,
      action_type: row.actionType, entity_type: row.entityType ?? null, entity_id: row.entityId || row.entityType || 'settings', // NOT NULL — a row without an entity was lost (w4 SQL)
      before_json: (row.before == null ? null : JSON.stringify(row.before)), after_json: (row.after == null ? null : JSON.stringify(row.after)),
      metadata: JSON.stringify(metadata), created_at: (row.createdAt ? new Date(row.createdAt) : sql`now()`),
    }).execute().catch((e: unknown) => {
      // Payment Terminals guide audit (Nov 4 2026): a lost audit row is said in the log with what it was (it vanished silently);
      // the settings change itself already happened and is not undone
      console.error(`[settings-audit] could not record ${row.actionType} on ${row.entityId ?? row.entityType ?? 'settings'} (tenant ${row.tenantId}): ${(e as Error)?.message ?? e}`);
    });
  }

  async listAudit(ctx: SettingsContext, limit: number): Promise<POSSettingsAuditLogRow[]> {
    const rows = await this.db.selectFrom('settings_audit_logs')
      .where('tenant_id', '=', ctx.tenantId).where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId || ''), eb('branch_id', 'is', null)]))
      .selectAll().orderBy('created_at', 'desc').limit(limit).execute().catch(() => []);
    return rows.map((r: any): POSSettingsAuditLogRow => {
      const meta = parseJson(r.metadata) || {};
      return {
        id: r.id, tenantId: r.tenant_id, branchId: r.branch_id || undefined, userId: r.user_id || '', role: r.role || '',
        actionType: r.action_type, entityType: r.entity_type || '', entityId: r.entity_id || undefined,
        before: parseJson(r.before_json), after: parseJson(r.after_json), changedKeys: meta.changedKeys,
        ipAddress: meta.ipAddress, userAgent: meta.userAgent, createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
      };
    });
  }
}
