// copilot-settings.service.ts — per-tenant Reception Copilot toggles (spec §47). REUSES the existing generic
// `tenant_settings` JSONB store (one row per (tenant, branch, category)) under category 'reception_copilot' — no new
// table, and PosSettingsService safely ignores this category. Settings gate the action spine for real: a disabled
// master switch or per-action flag makes the corresponding Copilot action refuse with ACTION_DISABLED. Scope is
// server-derived; writes require ai.manage and are audited. Branch-level overrides are a documented future layer;
// today settings are tenant-wide (branch_id NULL).
import { notifySettingsChanged, REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import type { CopilotSettings } from '@aipowersalon/api-contracts/tenant';
export type { CopilotSettings };   // owned by packages/api-contracts (Constitution 13 §13)
import { Injectable, Inject, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';
import { AuditService } from '@aipowersalon/audit';
import type { CachePort } from '../cache/cache-port';

export const DEFAULT_COPILOT_SETTINGS: CopilotSettings = {
  enabled: true, actionsEnabled: true, allowCreate: true, allowReschedule: true, allowCancel: true, allowSendMessage: true,
  allowDrafting: true, showCustomerHistory: true, allowAiPhoneActivity: true, allowExplainServices: true, allowWaitlist: true,
};

export interface CopilotSettingsCtx { tenantId: string; userId: string; role: string; permissions: string[]; branchId?: string | null }

const KEYS: (keyof CopilotSettings)[] = ['enabled', 'actionsEnabled', 'allowCreate', 'allowReschedule', 'allowCancel', 'allowSendMessage', 'allowDrafting', 'showCustomerHistory', 'allowAiPhoneActivity', 'allowExplainServices', 'allowWaitlist'];

// Pure overlay of a stored partial onto a base, coercing only known boolean keys (ignores junk).
export function overlayCopilotSettings(base: CopilotSettings, stored: Record<string, unknown> | null | undefined): CopilotSettings {
  const out: CopilotSettings = { ...base };
  if (stored) for (const k of KEYS) if (typeof stored[k] === 'boolean') out[k] = stored[k] as boolean;
  return out;
}
export function mergeCopilotSettings(stored: Record<string, unknown> | null | undefined): CopilotSettings {
  return overlayCopilotSettings(DEFAULT_COPILOT_SETTINGS, stored);
}

@Injectable()
export class CopilotSettingsService {
  // Short-TTL, size-capped in-memory cache: the action spine calls get() on every confirmed action, so at 10k+ tenants
  // and high action volume an uncached DB read per action is real load. TTL bounds staleness across instances (a patch
  // on another instance is picked up within TTL); the cap bounds memory. Correctness on the same instance is exact —
  // patch() invalidates the tenant's entries immediately.
  private localCache = new Map<string, { v: CopilotSettings; exp: number }>();
  private static readonly TTL_MS = 30_000;
  private static readonly MAX = 50_000;

  // Optional cross-instance cache (Redis-backed CachePort). When absent, the per-process localCache is used — same
  // single-node behaviour as before. When present, all nodes share settings + see invalidations immediately.
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly audit: AuditService, @Optional() @Inject('COPILOT_CACHE') private readonly shared?: CachePort, @Optional() @Inject(REALTIME) private readonly rt?: RealtimeEmitter) {}

  async get(ctx: CopilotSettingsCtx): Promise<CopilotSettings> {
    if (!this.db) return { ...DEFAULT_COPILOT_SETTINGS };
    const ns = `copilot:${ctx.tenantId}`;
    const key = ctx.branchId ?? '';
    const now = Date.now();
    if (this.shared) {
      const cached = await this.shared.get(ns, key).catch(() => null);
      if (cached) { try { return JSON.parse(cached) as CopilotSettings; } catch { /* fall through */ } }
      const v = await this.computeEffective(ctx);
      await this.shared.set(ns, key, JSON.stringify(v), CopilotSettingsService.TTL_MS).catch(() => undefined);
      return { ...v };
    }
    const mapKey = `${ctx.tenantId}:${key}`;
    const hit = this.localCache.get(mapKey);
    if (hit && hit.exp > now) return { ...hit.v };
    const v = await this.computeEffective(ctx);
    if (this.localCache.size >= CopilotSettingsService.MAX) this.localCache.clear();
    this.localCache.set(mapKey, { v, exp: now + CopilotSettingsService.TTL_MS });
    return { ...v };
  }

  private async invalidateTenant(tenantId: string): Promise<void> {
    if (this.shared) { await this.shared.invalidate(`copilot:${tenantId}`).catch(() => undefined); return; }
    const prefix = `${tenantId}:`;
    for (const k of this.localCache.keys()) if (k.startsWith(prefix)) this.localCache.delete(k);
  }

  private async computeEffective(ctx: CopilotSettingsCtx): Promise<CopilotSettings> {
    // Resolution hierarchy (spec §47): defaults ← tenant-wide (branch NULL) ← branch-specific (this branch).
    const tenantRow = await this.readRow(ctx.tenantId, null);
    let effective = mergeCopilotSettings(tenantRow);
    if (ctx.branchId) {
      const branchRow = await this.readRow(ctx.tenantId, ctx.branchId);
      effective = overlayCopilotSettings(effective, branchRow);
    }
    return effective;
  }

  private async readRow(tenantId: string, branchId: string | null): Promise<Record<string, unknown> | null> {
    const res: any = branchId
      ? await sql`SELECT settings_json FROM tenant_settings WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} AND category = 'reception_copilot' LIMIT 1`.execute(this.db as any)
      : await sql`SELECT settings_json FROM tenant_settings WHERE tenant_id = ${tenantId} AND branch_id IS NULL AND category = 'reception_copilot' LIMIT 1`.execute(this.db as any);
    const raw = res.rows?.[0]?.settings_json;
    return typeof raw === 'string' ? safeParse(raw) : (raw ?? null);
  }

  async patch(ctx: CopilotSettingsCtx, patch: Partial<CopilotSettings>, level: 'tenant' | 'branch' = 'tenant'): Promise<CopilotSettings> {
    if (!hasPermission(ctx as any, 'ai.manage')) throw new ForbiddenSettings('Missing ai.manage');
    const targetBranch = level === 'branch' ? (ctx.branchId ?? null) : null;
    if (level === 'branch' && !targetBranch) throw new ForbiddenSettings('A branch is required for a branch-level override');
    if (this.db) {
      // Keep each level's row to only the keys explicitly set at that level (sparse), so a tenant-wide change still
      // propagates to branches that haven't overridden that key. Read the raw row at this level, overlay the patch.
      const existingRaw = (await this.readRow(ctx.tenantId, targetBranch)) ?? {};
      const next: Record<string, boolean> = {};
      for (const k of KEYS) if (typeof (existingRaw as any)[k] === 'boolean') next[k] = (existingRaw as any)[k];
      for (const k of KEYS) if (typeof patch[k] === 'boolean') next[k] = patch[k] as boolean;
      const row = await this.findRowId(ctx.tenantId, targetBranch);
      if (row) {
        await sql`UPDATE tenant_settings SET settings_json = ${JSON.stringify(next)}::jsonb, updated_by_user_id = ${ctx.userId}, updated_at = now() WHERE id = ${row}`.execute(this.db);
      } else if (targetBranch) {
        await sql`INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json, updated_by_user_id) VALUES (${ctx.tenantId}, ${targetBranch}, 'reception_copilot', ${JSON.stringify(next)}::jsonb, ${ctx.userId})`.execute(this.db);
      } else {
        await sql`INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json, updated_by_user_id) VALUES (${ctx.tenantId}, NULL, 'reception_copilot', ${JSON.stringify(next)}::jsonb, ${ctx.userId})`.execute(this.db);
      }
    }
    notifySettingsChanged(this.rt, ctx.tenantId, 'reception_copilot');   // after the write; a failed write threw above
    await this.invalidateTenant(ctx.tenantId);   // same-instance correctness: next get() reflects the write immediately
    const effective = await this.get(ctx);
    await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId }, {
      module: 'reception_copilot', action: 'settings.updated', resourceType: 'reception_copilot_settings', resourceId: null,
      summary: `Reception Copilot settings updated (${level})`, metadata: { source: 'RECEPTION_COPILOT', level, patch, effective },
    }).catch(() => undefined);
    return effective;
  }

  private async findRowId(tenantId: string, branchId: string | null): Promise<string | null> {
    if (!this.db) return null;
    const res: any = branchId
      ? await sql`SELECT id FROM tenant_settings WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} AND category = 'reception_copilot' LIMIT 1`.execute(this.db)
      : await sql`SELECT id FROM tenant_settings WHERE tenant_id = ${tenantId} AND branch_id IS NULL AND category = 'reception_copilot' LIMIT 1`.execute(this.db);
    return res.rows?.[0]?.id ?? null;
  }
}

export class ForbiddenSettings extends Error { constructor(m: string) { super(m); this.name = 'ForbiddenError'; } }
function safeParse(s: string): any { try { return JSON.parse(s); } catch { return null; } }
