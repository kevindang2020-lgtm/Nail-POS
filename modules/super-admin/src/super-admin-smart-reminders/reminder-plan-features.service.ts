// reminder-plan-features.service.ts — Enable Reminders by Subscription Plan (§41). The Super Admin sets a capability
// state per (plan, feature); the backend enforces it via evaluate(tenantId, featureKey), which resolves the tenant's
// plan and returns an allow/block decision. Allowed states: enabled/trial/grandfathered. Blocked: disabled/add_on/
// approval (until the condition is met). A missing row is "not restricted by plan" → allowed. Enforcement is
// server-side; hiding a frontend control is never sufficient.
import { BadRequestException } from '@nestjs/common';
import { REMINDER_TYPES } from './smart-reminders-core';
import { ReminderPlanFeaturesRepository } from './reminder-plan-features.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const ALLOWED_STATES = new Set(['enabled', 'trial', 'grandfathered']);
const STATES = ['enabled', 'disabled', 'trial', 'add_on', 'approval', 'grandfathered'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// The reminder capabilities that can be gated by plan.
export const PLAN_FEATURE_KEYS = new Set<string>([
  'smart_reminders', ...REMINDER_TYPES.map((t) => t.key),
  'sms', 'email', 'push', 'multi_step', 'fallback', 'tenant_customization', 'custom_timing', 'custom_templates', 'analytics',
]);

export class ReminderPlanFeaturesService {
  constructor(private readonly repo: ReminderPlanFeaturesRepository) {}

  async list(planCode?: string) {
    const rows = planCode ? await this.repo.listForPlan(planCode) : await this.repo.listAll();
    return { planCode: planCode ?? null, features: rows.map((r) => ({ planCode: r.plan_code, featureKey: r.feature_key, state: r.state, allowed: ALLOWED_STATES.has(r.state), updatedAt: r.updated_at })) };
  }

  async setFeature(ctx: AdminCtx, body: any) {
    const planCode = typeof body?.planCode === 'string' ? body.planCode.trim() : '';
    if (!planCode) throw new BadRequestException('planCode is required');
    const featureKey = String(body?.featureKey ?? '');
    if (!PLAN_FEATURE_KEYS.has(featureKey)) throw new BadRequestException('invalid featureKey');
    const state = String(body?.state ?? '');
    if (!STATES.includes(state)) throw new BadRequestException('invalid state');
    const before = await this.repo.get(planCode, featureKey);
    await this.repo.upsert(planCode, featureKey, state, ctx.userId && validUuid(ctx.userId) ? ctx.userId : null);
    const after = await this.repo.get(planCode, featureKey);
    await this.repo.writeAudit(ctx, planCode, `Reminder plan feature ${planCode}/${featureKey} → ${state}`, { before, after });
    return { ok: true, planCode, featureKey, state, allowed: ALLOWED_STATES.has(state), before: before ? { state: before.state } : null };
  }

  /** Backend enforcement decision consulted before creating/enabling a reminder capability for a tenant. */
  async evaluate(tenantId: string, featureKey: string) {
    if (!validUuid(tenantId)) throw new BadRequestException('invalid tenantId');
    if (!PLAN_FEATURE_KEYS.has(featureKey)) throw new BadRequestException('invalid featureKey');
    const planCode = await this.repo.tenantPlan(tenantId);
    if (!planCode) return { allowed: true, state: 'no_plan', planCode: null, reason: 'no subscription plan resolved — not restricted' };
    const row = await this.repo.get(planCode, featureKey);
    if (!row) return { allowed: true, state: 'default', planCode, reason: 'not restricted by plan' };
    const allowed = ALLOWED_STATES.has(row.state);
    return { allowed, state: row.state, planCode, reason: allowed ? `permitted (${row.state})` : `blocked by plan (${row.state})` };
  }
}
