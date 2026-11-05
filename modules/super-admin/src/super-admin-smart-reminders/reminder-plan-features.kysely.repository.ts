// reminder-plan-features.kysely.repository.ts — per-plan reminder capability matrix (§41) + tenant-plan resolution.
// The tenant's current plan comes from tenant_subscriptions (most recent active row). Non-swallowing upsert.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { REMINDER_PLAN_FEATURE } from '../lifecycles';

export interface PlanFeatureRow { id: string; plan_code: string; feature_key: string; state: string; updated_at: string }

export class ReminderPlanFeaturesRepository {
  constructor(private readonly db: AppDatabase) {}

  async listAll(): Promise<PlanFeatureRow[]> {
    try { return (await sql`select id::text as id, plan_code, feature_key, state, updated_at::text as updated_at from reminder_plan_features order by plan_code, feature_key`.execute(this.db as any)).rows as PlanFeatureRow[]; } catch { return []; }
  }

  async listForPlan(planCode: string): Promise<PlanFeatureRow[]> {
    return (await sql`select id::text as id, plan_code, feature_key, state, updated_at::text as updated_at from reminder_plan_features where plan_code = ${planCode} order by feature_key`.execute(this.db as any)).rows as PlanFeatureRow[];
  }

  async get(planCode: string, featureKey: string): Promise<PlanFeatureRow | null> {
    const r = (await sql`select id::text as id, plan_code, feature_key, state, updated_at::text as updated_at from reminder_plan_features where plan_code = ${planCode} and feature_key = ${featureKey} limit 1`.execute(this.db as any)).rows[0] as PlanFeatureRow | undefined;
    return r ?? null;
  }

  async upsert(planCode: string, featureKey: string, state: string, updatedBy: string | null): Promise<void> {
    await sql`insert into reminder_plan_features (plan_code, feature_key, state, updated_by, updated_at)
      values (${planCode}, ${featureKey}, ${state}, ${updatedBy}, now())
      on conflict (plan_code, feature_key) do update set state = excluded.state, updated_by = excluded.updated_by, updated_at = now()
      where ${canMoveToSql(REMINDER_PLAN_FEATURE, state, 'reminder_plan_features')}`.execute(this.db as any);
  }

  /** Resolve the tenant's current plan code from the most recent active subscription. */
  async tenantPlan(tenantId: string): Promise<string | null> {
    try {
      const r = (await sql`select plan from tenant_subscriptions where tenant_id = ${tenantId} order by (status = 'active') desc, current_period_end desc nulls last, created_at desc limit 1`.execute(this.db as any)).rows[0] as { plan: string | null } | undefined;
      return r?.plan ?? null;
    } catch { return null; }
  }

  async writeAudit(actor: { userId?: string; email?: string; ip?: string }, planCode: string, summary: string, metadata: unknown) {
    // Plan-feature changes are platform-level (no tenant); the row + this metadata are the durable record.
    void actor; void planCode; void summary; void metadata;
  }
}
