// plan-links.ts — Super Admin: salons whose subscription plan is not linked to a feature-catalogue plan, and the audited
// one-click link (batch 8 decision 3, Nov 9 2026). Linking writes tenant_subscriptions.plan_code ONLY — the plan text,
// price, status and period are untouched, so nobody is billed differently. Entitlements read a linked code first.
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { sql } from 'kysely';
import { AuditService, auditSinkFor, type AuditSink } from '@aipowersalon/audit';

const MANAGE_PERM = 'super_admin.subscriptions.manage';
export const PLAN_LINK_BODY: BodySchema = S.object({ planCode: S.text(60, { minLength: 1 }), reason: S.text(500, { minLength: 5 }) }, ['planCode', 'reason']);

import type { UnlinkedTenantsResponse, PlanLinkResult } from '@aipowersalon/api-contracts/platform';

export class PlanLinkError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export class PlanLinks {
  constructor(private readonly db: AppDatabase | null, private readonly audit: AuditSink | null = null) {}
  private need(): NonNullable<AppDatabase> { if (!this.db) throw withCode(new PlanLinkError(503, 'Plan links need the database.'), 'SERVICE_UNAVAILABLE'); return this.db; }

  /** each salon's latest non-cancelled subscription whose code AND text match no catalogue plan */
  async unlinked(): Promise<UnlinkedTenantsResponse> {
    const db = this.need();
    const r = await sql<{ tenant_id: string; display_name: string | null; tenant_code: string | null; plan: string; status: string; id: string }>`
      SELECT DISTINCT ON (s.tenant_id) s.tenant_id, t.display_name, t.tenant_code, s.plan, s.status, s.id
        FROM tenant_subscriptions s JOIN tenants t ON t.id = s.tenant_id
       WHERE lower(s.status) <> 'cancelled'
       ORDER BY s.tenant_id, s.created_at DESC`.execute(db);
    const plans = await sql<{ code: string; name: string; status: string }>`SELECT code, name, status FROM subscription_plans ORDER BY display_order NULLS LAST, name`.execute(db);
    const linked = await sql<{ id: string }>`SELECT s.id FROM tenant_subscriptions s WHERE EXISTS (SELECT 1 FROM subscription_plans p
        WHERE lower(p.code) = lower(coalesce(s.plan_code, '')) OR lower(p.code) = lower(s.plan) OR lower(p.name) = lower(s.plan))`.execute(db);
    const ok = new Set(linked.rows.map((x) => String(x.id)));
    return {
      tenants: r.rows.filter((x) => !ok.has(String(x.id))).map((x) => ({ tenantId: String(x.tenant_id), tenantName: x.display_name, tenantCode: x.tenant_code, planText: x.plan, status: x.status, subscriptionId: String(x.id) })),
      plans: plans.rows.map((p) => ({ code: p.code, name: p.name, status: p.status })),
    };
  }

  async link(actor: { userId?: string | null; permissions?: string[] }, tenantId: string, planCode: string, reason: string): Promise<PlanLinkResult> {
    if (!(actor.permissions ?? []).includes(MANAGE_PERM)) throw withCode(new PlanLinkError(403, `Missing permission: ${MANAGE_PERM}.`), 'PERMISSION_DENIED');
    const db = this.need();
    const plan = (await sql<{ code: string }>`SELECT code FROM subscription_plans WHERE lower(code) = lower(${planCode}) LIMIT 1`.execute(db)).rows[0];
    if (!plan) throw withCode(new PlanLinkError(404, 'No catalogue plan has that code.'), 'RESOURCE_NOT_FOUND');
    const out = await db.transaction().execute(async (trx) => {
      const sub = (await sql<{ id: string; plan: string; plan_code: string | null }>`SELECT id, plan, plan_code FROM tenant_subscriptions
          WHERE tenant_id = ${tenantId}::uuid AND lower(status) <> 'cancelled' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`.execute(trx)).rows[0];
      if (!sub) throw withCode(new PlanLinkError(404, 'This salon has no open subscription to link.'), 'RESOURCE_NOT_FOUND');
      await trx.updateTable('tenant_subscriptions').set({ plan_code: plan.code, updated_at: sql`now()`, updated_by: actor.userId ?? null })
        .where('id', '=', sub.id).execute();
      return { tenantId, planCode: plan.code, planText: sub.plan, subscriptionId: sub.id, fromPlanCode: sub.plan_code };
    });
    // the canonical audit, on the salon's own trail (it can see who linked its plan, and why)
    await this.audit?.record({ tenantId, userId: actor.userId ?? null, role: 'SUPER_ADMIN', module: 'subscription', action: 'super_admin_subscription_plan_linked',
      resourceType: 'tenant_subscription', resourceId: out.subscriptionId, summary: `${out.planText} → ${out.planCode}`,
      metadata: { planText: out.planText, fromPlanCode: out.fromPlanCode, toPlanCode: out.planCode, reason } });
    return { tenantId: out.tenantId, planCode: out.planCode, planText: out.planText };
  }
}

function run<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e: unknown) => { if (e instanceof PlanLinkError) throw new HttpException({ code: (e as PlanLinkError & { apiCode?: string }).apiCode, message: e.message }, e.status); throw e; });
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/plans')
export class PlanLinksController {
  constructor(@Optional() @Inject(DATABASE) private readonly db?: AppDatabase, @Optional() private readonly audit?: AuditService) {}
  private svc() { return new PlanLinks(this.db ?? null, this.audit ? auditSinkFor(this.audit) : null); }

  @Get('unlinked-tenants')
  unlinked(): Promise<UnlinkedTenantsResponse> { return run(() => this.svc().unlinked()); }

  @Post('tenants/:tenantId/link')
  link(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(PLAN_LINK_BODY, { strict: true })) b: { planCode: string; reason: string }): Promise<PlanLinkResult> {
    return run(() => this.svc().link({ userId: r?.ctx?.userId ?? null, permissions: r?.ctx?.permissions ?? [] }, tenantId, b.planCode, b.reason));
  }
}
