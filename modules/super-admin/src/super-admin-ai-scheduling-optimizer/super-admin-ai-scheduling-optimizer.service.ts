// super-admin-ai-scheduling-optimizer.service.ts — BUILD_PLAN Phase 7 (agent B): Super Admin oversight of the AI
// Scheduling Optimizer.
//   overview / tenants          platform counts (applied split manual vs automated from recommendations.automated)
//   tenant detail               ONLY with an ACTIVE canonical support session (support_access_sessions) for that salon and
//                               this admin — no session, no detail (403 SUPPORT_SESSION_REQUIRED)
//   retry / rollback            a salon's recommendation, through the ENGINE (the same booking path, idempotency and
//                               version checks staff get) — needs an active support session, a reason, step-up; audited
//   disable                     the salon's kill switch through the engine (setTenantKillSwitch) — reason, step-up; audited
//   platform switch             platform_settings 'ai.scheduling_optimizer_disabled' + change history + audit
// The engine is reached through a narrow port (SaSchedEngine) bound to AiSchedulingService; the Super Admin acts on the
// salon with a system context (systemContext(), actor 'super_admin', only the permission that action needs) — a
// SUPER_ADMIN session holds no tenant permission, by design.
import { systemContext } from '@aipowersalon/tenant-context';
import type { SaSchedOverview, SaSchedTenantDetail, SaSchedTenantRow } from '@aipowersalon/api-contracts/platform';
import { actionReason, activeSupportSession, buildOverview, MIN_ACTION_REASON } from './super-admin-ai-scheduling-optimizer-core';
import type { SaSchedRead } from './super-admin-ai-scheduling-optimizer.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The slice of AiSchedulingService (modules/ai, agent A) the Super Admin actions use. */
export interface SaSchedEngine {
  retry(ctx: any, id: string, req: { expectedVersion: number }): Promise<unknown>;
  rollback(ctx: any, id: string, req: { expectedVersion: number }): Promise<unknown>;
  setTenantKillSwitch(ctx: any, killed: boolean, reason: string): Promise<unknown>;
}
export const SA_SCHED_ENGINE = 'SaSchedEngine';

export class SaSchedError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 503, readonly code: string, message: string) { super(message); this.name = 'SaSchedError'; }
}
export interface SaActor { userId: string | null }

/** A Super Admin acting on one salon: a system context, never the admin's own session (which holds no tenant permission). */
export function saSchedCtx(tenantId: string, permissions: string[]) {
  const s = systemContext({ tenantId, branchId: null, actor: 'super_admin', permissions });
  return { tenantId: s.tenantId, branchId: null, userId: s.userId, role: s.role, permissions: [...s.permissions], actor: 'system' as const };
}

export class SuperAdminAiSchedulingOptimizerService {
  constructor(private readonly read: SaSchedRead | null, private readonly engine: SaSchedEngine | null, private readonly now: () => number = Date.now) {}

  private db(): SaSchedRead { if (!this.read) throw new SaSchedError(503, 'UNAVAILABLE', 'Oversight needs the database.'); return this.read; }

  async overview(): Promise<SaSchedOverview> { return buildOverview({ ...(await this.db().overview()), now: new Date(this.now()) }); }

  async tenants(q: { search?: string; limit?: string | number }): Promise<SaSchedTenantRow[]> {
    return this.db().tenants({ search: q.search ? String(q.search) : undefined, limit: Math.max(1, Math.min(200, Number(q.limit) || 50)) });
  }

  private async session(actor: SaActor, tenantId: string): Promise<string> {
    if (!UUID.test(tenantId)) throw new SaSchedError(404, 'NOT_FOUND', 'Salon not found.');
    const s = activeSupportSession(await this.db().supportSessions(tenantId, String(actor.userId ?? '')), actor.userId, tenantId, this.now());
    if (!s) throw new SaSchedError(403, 'SUPPORT_SESSION_REQUIRED', 'Open a support session for this salon first (Support Mode) — the detail is only shown inside an active session.');
    return String(s.id);
  }

  async tenantDetail(actor: SaActor, tenantId: string): Promise<SaSchedTenantDetail> {
    const supportSessionId = await this.session(actor, tenantId);
    const d = await this.db().detail(tenantId);
    if (!d.exists) throw new SaSchedError(404, 'NOT_FOUND', 'Salon not found.');
    const platformKilled = await this.db().platformKilled();
    await this.db().audit({ tenantId, userId: actor.userId, action: 'super_admin_ai_scheduling_detail_viewed', entityType: 'support_access_session', entityId: supportSessionId, metadata: { supportSessionId } });
    return {
      tenantId, supportSessionId,
      settings: { enabled: d.settings.enabled, killed: d.settings.killed, automationAllowed: d.settings.enabled && !d.settings.killed && !platformKilled && d.settings.automationEnabled && d.settings.allowedAutoActions > 0, version: d.settings.version },
      runs: d.runs, failedApplications: d.failedApplications, recommendationsByStatus: d.recommendationsByStatus,
    };
  }

  private reason(raw: unknown): string {
    const r = actionReason(raw);
    if (!r) throw new SaSchedError(400, 'REASON_REQUIRED', `A reason of at least ${MIN_ACTION_REASON} characters is required.`);
    return r;
  }
  private need(): SaSchedEngine { if (!this.engine) throw new SaSchedError(503, 'UNAVAILABLE', 'The AI Scheduling Optimizer is not available in this process.'); return this.engine; }

  async recommendationAction(actor: SaActor, tenantId: string, recommendationId: string, action: 'retry' | 'rollback', rawReason: unknown) {
    const why = this.reason(rawReason);
    const supportSessionId = await this.session(actor, tenantId);
    if (!UUID.test(recommendationId)) throw new SaSchedError(404, 'NOT_FOUND', 'Recommendation not found.');
    const rec = await this.db().recommendation(tenantId, recommendationId);
    if (!rec) throw new SaSchedError(404, 'NOT_FOUND', 'Recommendation not found.');
    const ctx = saSchedCtx(tenantId, ['ai_scheduling.view', 'ai_scheduling.apply']);
    const result = action === 'retry'
      ? await this.need().retry(ctx, recommendationId, { expectedVersion: rec.version })
      : await this.need().rollback(ctx, recommendationId, { expectedVersion: rec.version });
    await this.db().audit({ tenantId, userId: actor.userId, action: `super_admin_ai_scheduling_${action}`, entityType: 'schedule_optimization_recommendation', entityId: recommendationId,
      metadata: { reason: why, supportSessionId, fromStatus: rec.status, version: rec.version } });
    return { ok: true as const, action, tenantId, recommendationId, result };
  }

  async disable(actor: SaActor, tenantId: string, rawReason: unknown) {
    const why = this.reason(rawReason);
    if (!UUID.test(tenantId)) throw new SaSchedError(404, 'NOT_FOUND', 'Salon not found.');
    const d = await this.db().detail(tenantId);
    if (!d.exists) throw new SaSchedError(404, 'NOT_FOUND', 'Salon not found.');
    const result = await this.need().setTenantKillSwitch(saSchedCtx(tenantId, ['ai_scheduling.view', 'ai_scheduling.configure']), true, `Super Admin: ${why}`);
    await this.db().audit({ tenantId, userId: actor.userId, action: 'super_admin_ai_scheduling_tenant_disabled', entityType: 'tenant_scheduling_ai_settings', entityId: tenantId, metadata: { reason: why } });
    return { ok: true as const, tenantId, killed: true, result };
  }

  async platformSwitch(actor: SaActor, killed: unknown, rawReason: unknown) {
    if (typeof killed !== 'boolean') throw new SaSchedError(400, 'VALIDATION', 'Say whether to switch the optimizer off for every salon (killed: true) or back on (killed: false).');
    const why = this.reason(rawReason);
    await this.db().setPlatformKilled(actor.userId, killed, why);
    return { ok: true as const, killed: await this.db().platformKilled() };
  }
}
