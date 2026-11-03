// ai-usage-screen.controller.ts — AI Usage & Limits Complete Build Guide (Oct 30 2026): `/tenant/ai/usage-screen/*`.
// Tenant / role / permissions come from the session (req.ctx), never the body or the query.
//   reads     ai.use               summary · packages · packages/:code · history
//   export    ai.use + reports.export (checked inside; denied attempts audited) history/export — async export contract
//   actions   ai.manage            packages/:code/trial · packages/:code/cancel (confirm + idempotency key; audited fail-closed)
//   alerts    ai.use               alerts/:id/acknowledge
//   AI-02     ai.manage            PUT packages/:code/branches/:branchId (branch override; expectedVersion; audited fail-closed)
//   AI-01     subscription.manage  POST billing/reconcile (read-only provider re-read; never charges; audited)
// Costs and billing events are returned only to subscription.manage (owner); everyone else sees "restricted".
import { Body, Controller, Get, Header, HttpException, HttpStatus, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ListQuery } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { logException } from '@aipowersalon/observability';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody, AsyncExport } from '@aipowersalon/permissions/guards';
import { AiUsageScreenRepository, AiUsageScreenError, PACKAGE_STATUS_FILTERS, PACKAGE_CATEGORIES, HISTORY_STATUSES, HISTORY_BASES, type UsageCtx } from './ai-usage-screen.repository';
import { AI_USAGE_TRIAL_BODY, AI_USAGE_CANCEL_BODY, AI_BRANCH_SETTING_BODY, AI_INVOICE_RECONCILE_BODY } from '../request-schemas-ai';
import { S, type BodySchema } from '@aipowersalon/permissions';
export const AI_USAGE_CHECK_BODY: BodySchema = S.object({});

export const AI_USAGE_SCREEN_REPOSITORY = 'AiUsageScreenRepository';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ctxOf(req: any): UsageCtx {
  const c = req?.ctx || {};
  if (!c.tenantId) throw new HttpException({ code: 'AUTH_REQUIRED', message: 'Not authenticated' }, HttpStatus.UNAUTHORIZED);
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
const actor = (c: UsageCtx) => ({ tenantId: c.tenantId, branchId: null, userId: c.userId ?? null, role: c.role ?? null });
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof AiUsageScreenError) throw new HttpException({ code: e.code, message: e.message, details: e.details ?? {} }, e.status);
    throw e;
  }
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const PACKAGE_LIST = { filters: { status: { type: 'enum', values: PACKAGE_STATUS_FILTERS }, category: { type: 'enum', values: PACKAGE_CATEGORIES } },
  sorts: { catalog: null, name: null, newest: null, usage: null, cost: null }, search: { maxLength: 100 }, maxLimit: 24, defaultLimit: 8, params: ['page'] } as const;
const HISTORY = { filters: { preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom'] }, packageCode: { type: 'text' }, status: { type: 'enum', values: HISTORY_STATUSES },
  basis: { type: 'enum', values: HISTORY_BASES } }, search: false, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 1830 }, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tenant/ai/usage-screen')
export class AiUsageScreenController {
  constructor(@Inject(AI_USAGE_SCREEN_REPOSITORY) private readonly repo: AiUsageScreenRepository | null) {}
  private r(): AiUsageScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'AI Usage needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('summary') @RequirePermission('ai.use')
  summary(@Req() q: any) { return run(() => this.r().summary(ctxOf(q))); }

  @Get('packages') @RequirePermission('ai.use') @ListQuery(PACKAGE_LIST)
  packages(@Req() q: any, @Query() f: any) { return run(() => this.r().packages(ctxOf(q), { q: s(f?.q), status: s(f?.status), category: s(f?.category), sort: s(f?.sort), page: f?.page, pageSize: f?.pageSize })); }

  @Get('packages/:code') @RequirePermission('ai.use')
  detail(@Req() q: any, @Param('code') code: string) {
    return run(() => this.r().detail(ctxOf(q), code).then((d) => { if (!d) throw new AiUsageScreenError('Unknown AI package.', 'AI_PACKAGE_NOT_FOUND', 404); return d; }));
  }

  @Get('history') @RequirePermission('ai.use') @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) {
    return run(() => this.r().history(ctxOf(q), { preset: s(f?.preset), from: s(f?.from), to: s(f?.to), packageCode: s(f?.packageCode), status: s(f?.status), basis: s(f?.basis), page: f?.page, pageSize: f?.pageSize }));
  }

  /** Usage History CSV through the ONE async export contract. requested → succeeded | failed; denied (recorded). */
  @AsyncExport({ kind: 'pos.ai-usage.history-export' }) @Get('history/export') @RequirePermission('ai.use') @ListQuery({ ...HISTORY, maxLimit: 1000, defaultLimit: 1000 })
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Cache-Control', 'no-store')
  exportHistory(@Req() q: any, @Query() f: any) {
    const c = ctxOf(q); const db = this.r().db;
    const flt = { preset: s(f?.preset), from: s(f?.from), to: s(f?.to), packageCode: s(f?.packageCode), status: s(f?.status), basis: s(f?.basis) };
    const base = { module: 'ai', resourceType: 'ai_usage_export', resourceId: null, metadata: flt };
    return run(async () => {
      if (!(c.permissions ?? []).some((p) => p === 'reports.export' || p === 'subscription.manage')) {
        await recordAuditStrict(db, actor(c), { ...base, action: 'ai.usage.export.denied', status: 'denied', severity: 'warning', summary: 'AI usage export denied' })
          .catch((x) => logException(x, { where: 'ai-usage.export.denial_not_recorded', tenantId: c.tenantId }));
        throw new AiUsageScreenError('Your role cannot export AI usage.', 'PERMISSION_DENIED', 403);
      }
      await recordAuditStrict(db, actor(c), { ...base, action: 'ai.usage.export.requested', summary: 'AI usage export requested' });
      try {
        const out = await this.r().historyCsv(c, flt);
        await recordAuditStrict(db, actor(c), { ...base, action: 'ai.usage.export.succeeded', summary: `AI usage exported (${out.rows} rows)`, metadata: { ...flt, rows: out.rows } });
        q?.res?.setHeader?.('Content-Disposition', `attachment; filename="${out.filename}"`);
        return out.csv;
      } catch (e) {
        await recordAuditStrict(db, actor(c), { ...base, action: 'ai.usage.export.failed', status: 'failure', summary: 'AI usage export failed' })
          .catch((x) => logException(x, { where: 'ai-usage.export.failed_not_recorded', tenantId: c.tenantId }));
        throw e;
      }
    });
  }

  /** Check AI Usage & Subscriptions (AI Usage Limits guide, Nov 1 2026) — read-only: never starts, cancels, prices or charges */
  @Post('check') @RequirePermission('ai.use')
  check(@Req() q: any, @Body(ValidatedBody(AI_USAGE_CHECK_BODY, { strict: true })) _b: unknown) { return run(() => this.r().check(ctxOf(q))); }

  @Post('packages/:code/trial') @RequirePermission('ai.manage')
  trial(@Req() q: any, @Param('code') code: string, @Body(ValidatedBody(AI_USAGE_TRIAL_BODY, { strict: true })) b: any) {
    const c = ctxOf(q);
    return run(() => this.r().startTrial(c, code, b ?? {}, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'ai', action: 'ai.subscription.trial_started', resourceType: 'tenant_ai_subscription', resourceId: code, summary: `AI trial started: ${code}`, metadata: meta, after: { status: 'trialing' } })));
  }

  @Post('packages/:code/cancel') @RequirePermission('ai.manage')
  cancel(@Req() q: any, @Param('code') code: string, @Body(ValidatedBody(AI_USAGE_CANCEL_BODY, { strict: true })) b: any) {
    const c = ctxOf(q);
    return run(() => this.r().cancel(c, code, b ?? {}, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'ai', action: 'ai.subscription.cancelled', resourceType: 'tenant_ai_subscription', resourceId: code, summary: `AI package cancelled: ${code}`, metadata: meta, before: { status: meta.from }, after: { status: 'cancelled' } })));
  }

  /** AI-02: one branch's operational override of a tenant-wide package (Inherit / On / Off + validated settings). */
  @Put('packages/:code/branches/:branchId') @RequirePermission('ai.manage')
  setBranch(@Req() q: any, @Param('code') code: string, @Param('branchId') branchId: string, @Body(ValidatedBody(AI_BRANCH_SETTING_BODY, { strict: true })) b: any) {
    const c = ctxOf(q);
    return run(() => this.r().setBranchSetting(c, code, branchId, b ?? {}, (trx, meta) => recordAuditStrict(trx, { ...actor(c), branchId }, { module: 'ai', action: 'ai.branch_setting.changed',
      resourceType: 'tenant_ai_branch_setting', resourceId: `${code}:${branchId}`, summary: `AI branch setting changed: ${code}`, metadata: meta, before: { override: meta.from }, after: { override: meta.to, version: meta.version } })));
  }

  /** AI-01: re-read the billing provider's AI invoices (read-only client). Never charges, never edits live billing. */
  @Post('billing/reconcile') @RequirePermission('subscription.manage')
  reconcile(@Req() q: any, @Body(ValidatedBody(AI_INVOICE_RECONCILE_BODY, { strict: true })) b: any) {
    const c = ctxOf(q);
    return run(async () => {
      const r = await this.r().reconcileInvoices(c, b ?? {});
      if (!r.duplicate) await recordAuditStrict(this.r().db, actor(c), { module: 'ai', action: 'ai.invoices.reconciled', status: r.status === 'failed' ? 'failure' : 'success', resourceType: 'ai_billing_reconciliation_run',
        resourceId: r.runId, summary: `AI invoice reconciliation ${r.status}`, metadata: { ...r } });
      return r;
    });
  }

  @Post('alerts/:id/acknowledge') @RequirePermission('ai.use')
  acknowledge(@Req() q: any, @Param('id') id: string) { if (!UUID.test(id)) throw new HttpException({ code: 'AI_ALERT_NOT_FOUND', message: 'Alert not found.' }, 404); return run(() => this.r().acknowledgeAlert(ctxOf(q), id)); }
}
