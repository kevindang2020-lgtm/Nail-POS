// feature-registry.ts — Constitution 7 §30–§33: the platform feature registry and the effective-feature resolver.
//
// resolve(tenantId, featureKey) walks §32's layers in order and stops at the first that says no, returning a STRUCTURED
// reason (never a bare false):
//   1. the feature exists in the registry          → FEATURE_UNKNOWN
//   2. its platform status (§33)                     → FEATURE_DISABLED / FEATURE_DEPRECATED / EMERGENCY_DISABLED
//   3. its platform kill switch (§34), if it names one → KILL_SWITCH_ACTIVE
//   3b. its rollout policy (platform_flag_rollouts, Phase 11 / Constitution 4 §76): per-flag kill → FLAG_KILLED;
//      deny list / outside the percentage → NOT_IN_ROLLOUT (allow list wins over the percentage; rolloutDecision in
//      @aipowersalon/config is the one copy of the rule)
//   4. plan entitlement + tenant override (EntitlementsService — unchanged, the existing source of truth) → NOT_ENTITLED
// Branch overrides, tenant settings, user permissions and client compatibility stay with the modules that own them.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Injectable, NotFoundException, Optional, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard, RequirePermission, RequireStepUp } from '@aipowersalon/permissions/guards';
import { EntitlementsService } from './entitlements.service';
import { rolloutDecision, type FlagRollout } from '@aipowersalon/config';
import { FeatureRegistryControllerListQueries } from './feature-registry.list-queries';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { FEATURE_STATUS_BODY } from '../request-schemas';
import { transitionStatus } from '@aipowersalon/database';
import { PLATFORM_FEATURE } from '../platform-lifecycles';

export const FEATURE_STATUSES = ['AVAILABLE', 'BETA', 'DISABLED', 'DEPRECATED', 'EMERGENCY_DISABLED'] as const;
export type FeatureStatus = typeof FEATURE_STATUSES[number];
export type FeatureResolution =
  | { active: true; featureKey: string; status: FeatureStatus; source: string }
  | { active: false; featureKey: string; reason: 'FEATURE_UNKNOWN' | 'FEATURE_DISABLED' | 'FEATURE_DEPRECATED' | 'EMERGENCY_DISABLED' | 'KILL_SWITCH_ACTIVE' | 'FLAG_KILLED' | 'NOT_IN_ROLLOUT' | 'NOT_ENTITLED'; detail: string };

/** Pure: the platform layers (1–3). Returns null when they allow the feature (entitlement decides next). */
export function platformLayers(f: { feature_key: string; status: string; kill_switch_key: string | null } | null, killSwitchOn: boolean, key: string): FeatureResolution | null {
  if (!f) return { active: false, featureKey: key, reason: 'FEATURE_UNKNOWN', detail: 'Not in the platform feature registry.' };
  if (f.status === 'DISABLED') return { active: false, featureKey: key, reason: 'FEATURE_DISABLED', detail: 'Disabled platform-wide.' };
  if (f.status === 'DEPRECATED') return { active: false, featureKey: key, reason: 'FEATURE_DEPRECATED', detail: 'Deprecated; no longer offered.' };
  if (f.status === 'EMERGENCY_DISABLED') return { active: false, featureKey: key, reason: 'EMERGENCY_DISABLED', detail: 'Emergency-disabled by the platform.' };
  if (f.kill_switch_key && killSwitchOn) return { active: false, featureKey: key, reason: 'KILL_SWITCH_ACTIVE', detail: `Stopped by the ${f.kill_switch_key} kill switch.` };
  return null;
}
/** Pure: layer 3b — the rollout policy. Null when it lets this tenant through. */
export function rolloutLayer(r: FlagRollout | null, key: string, tenantId: string): FeatureResolution | null {
  const d = rolloutDecision(r, key, tenantId);
  if (d.on) return null;
  if (d.reason === 'KILLED') return { active: false, featureKey: key, reason: 'FLAG_KILLED', detail: 'Stopped by this flag\'s kill.' };
  return { active: false, featureKey: key, reason: 'NOT_IN_ROLLOUT', detail: d.reason === 'DENIED' ? 'This salon is on the flag\'s deny list.' : `Outside the ${r?.rolloutPercent ?? 0}% rollout (bucket ${d.bucket}).` };
}
// the switches a registered feature can name (payment-integration switches cover processors, not features)
const KILL_SETTING: Readonly<Record<string, string>> = { 'ai.auto_actions': 'ai.auto_actions_disabled', 'deals.engine': 'deals.engine_disabled', 'sms.emergency_send': 'sms.emergency_send_disabled' };

@Injectable()
export class FeatureRegistry {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any, @Optional() private readonly ent?: EntitlementsService) {}

  async list() {
    if (!this.db) return [];
    return (await sql<any>`select * from platform_features order by category, feature_key`.execute(this.db)).rows;
  }

  private async killSwitchOn(key: string | null): Promise<boolean> {
    if (!key || !this.db) return false;
    if (key === 'booking.verification') {
      const r: any = await sql`select emergency_disabled from booking_verification_platform_policy where tenant_id is null limit 1`.execute(this.db).catch(() => ({ rows: [] }));
      return !!r.rows[0]?.emergency_disabled;
    }
    const setting = KILL_SETTING[key]; if (!setting) return false;
    const r: any = await sql`select value from platform_settings where setting_key = ${setting} limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    const v = r.rows[0]?.value; return v === true || v === 'true';
  }

  private async rolloutFor(key: string): Promise<FlagRollout | null> {
    if (!this.db) return null;
    const r: any = (await sql`select rollout_percent, allow_tenant_ids, deny_tenant_ids, killed from platform_flag_rollouts where flag_key = ${key}`.execute(this.db).catch(() => ({ rows: [] }))).rows[0];
    if (!r) return null;
    const ids = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/^\{|\}$/g, '').split(',').filter(Boolean) : []).map(String);
    return { rolloutPercent: Number(r.rollout_percent), allowTenantIds: ids(r.allow_tenant_ids), denyTenantIds: ids(r.deny_tenant_ids), killed: r.killed === true };
  }

  /** BUILD_PLAN Phase 12 (#13): layers 1–3b only, for the plan-feature guard. A key the registry does not list is NOT
   *  stopped here (plan_features keys such as 'memberships' are not registry rows) — the plan layer decides it. */
  async platformStop(tenantId: string, featureKey: string): Promise<{ reason: 'FEATURE_DISABLED' | 'FEATURE_DEPRECATED' | 'EMERGENCY_DISABLED' | 'KILL_SWITCH_ACTIVE' | 'FLAG_KILLED' | 'NOT_IN_ROLLOUT'; detail: string } | null> {
    if (!this.db) return null;
    const f: any = (await sql`select feature_key, status, kill_switch_key from platform_features where feature_key = ${featureKey}`.execute(this.db)).rows[0] ?? null;
    if (f) {
      const p = platformLayers(f, await this.killSwitchOn(f.kill_switch_key ?? null), featureKey);
      if (p && !p.active) return { reason: p.reason as any, detail: p.detail };
    }
    const r = rolloutLayer(await this.rolloutFor(featureKey), featureKey, tenantId);
    return r && !r.active ? { reason: r.reason as any, detail: r.detail } : null;
  }

  async resolve(tenantId: string, featureKey: string): Promise<FeatureResolution> {
    const f: any = this.db ? (await sql`select feature_key, status, kill_switch_key from platform_features where feature_key = ${featureKey}`.execute(this.db)).rows[0] ?? null : null;
    const platform = platformLayers(f, await this.killSwitchOn(f?.kill_switch_key ?? null), featureKey);
    if (platform) return platform;
    const rollout = rolloutLayer(await this.rolloutFor(featureKey), featureKey, tenantId);
    if (rollout) return rollout;
    if (this.ent) {
      const e: any = await this.ent.getEntitlements(tenantId);
      const hit = (e?.features ?? []).find((x: any) => x.featureKey === featureKey);
      if (!hit || !hit.enabled) return { active: false, featureKey, reason: 'NOT_ENTITLED', detail: hit ? `Plan state ${hit.planState ?? 'none'}${hit.override ? `, override ${hit.override}` : ''}.` : 'Not in this salon\'s plan.' };
      return { active: true, featureKey, status: f.status, source: String(hit.source ?? 'plan') };
    }
    return { active: true, featureKey, status: f.status, source: 'platform' };
  }

  /** §33 status change — step-up (route), reason, audited; EMERGENCY_DISABLED is the kill-switch centre's job, not this. */
  async setStatus(featureKey: string, status: string, reason: string, actor: { userId: string | null; permissions: readonly string[] }) {
    if (!this.db) throw new BadRequestException('The feature registry needs the database.');
    if (!(FEATURE_STATUSES as readonly string[]).includes(status) || status === 'EMERGENCY_DISABLED') throw new BadRequestException({ code: 'invalid_status', message: 'Use AVAILABLE, BETA, DISABLED or DEPRECATED (emergency stops go through the kill-switch centre).' });
    if ((reason ?? '').trim().length < 10) throw new BadRequestException({ code: 'reason_required', message: 'A reason of at least 10 characters is required.' });
    if (!actor.permissions.includes('super_admin.plans.manage')) throw new ForbiddenException('Changing a feature\'s platform status requires super_admin.plans.manage.');
    return this.db.transaction().execute(async (trx: any) => {
      const prev: any = (await sql`select status from platform_features where feature_key = ${featureKey} for update`.execute(trx)).rows[0];
      if (!prev) throw new NotFoundException('Unknown feature.');
      // Phase 12 (#27): through PLATFORM_FEATURE (a no-op self-move and anything touching EMERGENCY_DISABLED → 409)
      await transitionStatus(trx, PLATFORM_FEATURE, { where: { feature_key: featureKey }, from: prev.status, to: status, set: { updated_at: sql`now()` } });
      await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${actor.userId}, 'SUPER_ADMIN', 'platform_feature_status_changed', 'platform_feature', ${featureKey}, ${JSON.stringify({ from: prev.status, to: status, reason: reason.trim() })}::jsonb)`.execute(trx);
      return { featureKey, from: prev.status, to: status };
    });
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(FeatureRegistryControllerListQueries)
@Controller('super-admin/features')
export class FeatureRegistryController {
  constructor(private readonly reg: FeatureRegistry) {}
  @Get() @RequirePermission('super_admin.plans.view')
  list() { return this.reg.list(); }
  @Get(':key/resolve') @RequirePermission('super_admin.plans.view')
  resolve(@Param('key') key: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId is required');
    return this.reg.resolve(String(tenantId), String(key));
  }
  @RequireStepUp()
  @Patch(':key') @RequirePermission('super_admin.plans.manage')
  setStatus(@Param('key') key: string, @Body(ValidatedBody(FEATURE_STATUS_BODY, { strict: true })) b: { status?: string; reason?: string }, @Req() req: any) {
    return this.reg.setStatus(String(key), String(b?.status ?? ''), String(b?.reason ?? ''), { userId: req?.ctx?.userId ?? null, permissions: req?.ctx?.permissions ?? [] });
  }
}
