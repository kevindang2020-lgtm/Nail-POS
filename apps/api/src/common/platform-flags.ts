// platform-flags.ts — a tiny, cached reader for a single platform_settings boolean, safe to call from a hot path (e.g.
// the per-request rate-limit guard). It reads the stored override for a key (falling back to the caller's default),
// caches per key for a short TTL so it doesn't hit the DB on every request, and fails OPEN to the default on any error.
// This lets Super Admin settings toggle runtime behaviour without a redeploy.
//
// BUILD_PLAN Phase 11 (Constitution 4 §76): a flag may also carry a ROLLOUT policy (platform_flag_rollouts, migration
// 551) — percentage, selected-tenant allow / deny lists and a per-flag kill. `isEnabledFor(key, tenantId, def)` is the
// boolean AND the rollout decision for that tenant (rolloutDecision in @aipowersalon/config, the one copy the feature
// registry uses too). The Super Admin API for policies lives here, under the feature registry's path
// (/super-admin/features/…/rollout): step-up + a reason + an audit record on every change.
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Inject, Module, Optional, Param, Put, Req, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { rolloutDecision, normaliseRollout, RolloutInputError, type FlagRollout, type RolloutDecision } from '@aipowersalon/config';
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AuditService } from '@aipowersalon/audit';
import { FLAG_ROLLOUT_BODY } from './request-schemas';

const TTL_MS = 30_000;

@Injectable()
export class PlatformFlagService {
  private cache = new Map<string, { v: boolean; exp: number }>();
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  async isEnabled(key: string, def: boolean): Promise<boolean> {
    const hit = this.cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.v;
    let v = def;
    if (this.db) {
      try {
        const res: any = await sql`SELECT value FROM platform_settings WHERE setting_key = ${key} LIMIT 1`.execute(this.db);
        const raw = res.rows?.[0]?.value;
        if (raw !== undefined && raw !== null) v = raw === true || raw === 'true' || raw === 1;
      } catch { v = def; }   // fail open to the default — a settings read must never break request handling
    }
    this.cache.set(key, { v, exp: Date.now() + TTL_MS });
    return v;
  }

  private rollouts = new Map<string, { v: FlagRollout | null; exp: number }>();

  /** The rollout policy for a flag (null = none). Cached like the boolean; a read error fails open to "no policy". */
  async rolloutFor(key: string): Promise<FlagRollout | null> {
    const hit = this.rollouts.get(key);
    if (hit && hit.exp > Date.now()) return hit.v;
    let v: FlagRollout | null = null;
    if (this.db) {
      try {
        const r: any = (await sql`SELECT rollout_percent, allow_tenant_ids, deny_tenant_ids, killed FROM platform_flag_rollouts WHERE flag_key = ${key}`.execute(this.db)).rows[0];
        if (r) v = rowToRollout(r);
      } catch { v = null; }
    }
    this.rollouts.set(key, { v, exp: Date.now() + TTL_MS });
    return v;
  }

  /** The flag's boolean value AND its rollout decision for this tenant (§76). */
  async isEnabledFor(key: string, tenantId: string | null, def: boolean): Promise<boolean> {
    if (!(await this.isEnabled(key, def))) return false;
    return rolloutDecision(await this.rolloutFor(key), key, tenantId).on;
  }

  /** Test/ops hook to drop the cache (e.g. right after a settings save if you want it instant). */
  clear(): void { this.cache.clear(); this.rollouts.clear(); }
}

const toIds = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/^\{|\}$/g, '').split(',').filter(Boolean) : []).map((x) => String(x).toLowerCase());
export function rowToRollout(r: any): FlagRollout {
  return { rolloutPercent: Number(r.rollout_percent), allowTenantIds: toIds(r.allow_tenant_ids), denyTenantIds: toIds(r.deny_tenant_ids), killed: r.killed === true };
}

export interface RolloutView extends FlagRollout { flagKey: string; reason: string | null; version: number; updatedAt: string | null; updatedBy: string | null }
const KEY = /^[a-z][a-z0-9_.]{1,99}$/;
export const MIN_ROLLOUT_REASON = 10;

/** Super Admin read / write of rollout policies. Every write: reason ≥ 10 chars, optimistic version, audit record. */
@Injectable()
export class FlagRolloutService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null, private readonly flags: PlatformFlagService, @Optional() private readonly audit?: AuditService) {}

  private view(r: any): RolloutView {
    return { flagKey: r.flag_key, ...rowToRollout(r), reason: r.reason ?? null, version: Number(r.version),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null, updatedBy: r.updated_by ?? null };
  }

  async list(): Promise<RolloutView[]> {
    if (!this.db) return [];
    return (await sql<any>`SELECT * FROM platform_flag_rollouts ORDER BY flag_key`.execute(this.db)).rows.map((r) => this.view(r));
  }

  async get(key: string): Promise<RolloutView | null> {
    if (!this.db) return null;
    const r = (await sql<any>`SELECT * FROM platform_flag_rollouts WHERE flag_key = ${key}`.execute(this.db)).rows[0];
    return r ? this.view(r) : null;
  }

  /** What a given tenant would get — for the screen's "check a salon" box. */
  async evaluate(key: string, tenantId: string | null): Promise<RolloutDecision & { policy: RolloutView | null }> {
    const policy = await this.get(key);
    return { ...rolloutDecision(policy, key, tenantId), policy };
  }

  async set(key: string, input: any, actor: { userId: string | null }): Promise<RolloutView> {
    if (!this.db) throw new ConflictException('Flag rollouts need the database.');
    if (!KEY.test(key)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A flag key is a dotted lower-case name.' });
    const reason = String(input?.reason ?? '').trim();
    if (reason.length < MIN_ROLLOUT_REASON) throw new BadRequestException({ code: 'reason_required', message: `A reason of at least ${MIN_ROLLOUT_REASON} characters is required.` });
    let next: FlagRollout;
    try { next = normaliseRollout(input ?? {}); } catch (e) { if (e instanceof RolloutInputError) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: e.message }); throw e; }
    const expected = input?.expectedVersion == null ? null : Number(input.expectedVersion);
    const before = await this.get(key);
    if (expected !== null && (before?.version ?? 0) !== expected) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Someone else changed this rollout — reload and try again.' });
    const arr = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
    const r: any = (await sql`
      INSERT INTO platform_flag_rollouts (flag_key, rollout_percent, allow_tenant_ids, deny_tenant_ids, killed, reason, version, updated_by)
      VALUES (${key}, ${next.rolloutPercent}, ${arr(next.allowTenantIds)}, ${arr(next.denyTenantIds)}, ${next.killed}, ${reason}, 1, ${actor.userId})
      ON CONFLICT (flag_key) DO UPDATE SET rollout_percent = EXCLUDED.rollout_percent, allow_tenant_ids = EXCLUDED.allow_tenant_ids,
        deny_tenant_ids = EXCLUDED.deny_tenant_ids, killed = EXCLUDED.killed, reason = EXCLUDED.reason,
        version = platform_flag_rollouts.version + 1, updated_at = now(), updated_by = EXCLUDED.updated_by
      WHERE ${expected === null} OR platform_flag_rollouts.version = ${expected ?? 0}
      RETURNING *`.execute(this.db)).rows[0];
    if (!r) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Someone else changed this rollout — reload and try again.' });
    const after = this.view(r);
    await this.audit?.recordPlatform({ userId: actor.userId, role: 'SUPER_ADMIN', module: 'feature_flags',
      action: next.killed && !before?.killed ? 'flag_killed' : !next.killed && before?.killed ? 'flag_kill_released' : 'flag_rollout_changed',
      resourceType: 'feature_flag', resourceId: key, summary: `${key}: ${next.killed ? 'KILLED' : `${next.rolloutPercent}%`}, allow ${next.allowTenantIds.length}, deny ${next.denyTenantIds.length}`,
      metadata: { reason, before: before ? { rolloutPercent: before.rolloutPercent, allow: before.allowTenantIds.length, deny: before.denyTenantIds.length, killed: before.killed } : null,
        after: { rolloutPercent: next.rolloutPercent, allow: next.allowTenantIds.length, deny: next.denyTenantIds.length, killed: next.killed } }, reason });
    this.flags.clear();   // this process sees the change now; other processes within the 30 s cache TTL
    return after;
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/features')
export class FlagRolloutController {
  constructor(private readonly svc: FlagRolloutService) {}
  @Get('rollouts') @RequirePermission('super_admin.plans.view')
  list() { return this.svc.list(); }
  @Get(':key/rollout') @RequirePermission('super_admin.plans.view')
  async get(@Param('key') key: string, @Req() req: any) {
    const tenantId = typeof req?.query?.tenantId === 'string' && req.query.tenantId ? String(req.query.tenantId) : null;
    return this.svc.evaluate(String(key), tenantId);
  }
  @RequireStepUp()
  @Put(':key/rollout') @RequirePermission('super_admin.plans.manage')
  set(@Param('key') key: string, @Body(ValidatedBody(FLAG_ROLLOUT_BODY, { strict: true })) b: any, @Req() req: any) { return this.svc.set(String(key), b, { userId: req?.ctx?.userId ?? null }); }
}

@Module({ controllers: [FlagRolloutController], providers: [PlatformFlagService, FlagRolloutService], exports: [PlatformFlagService] })
export class PlatformFlagsModule {}
