// business-center.controller.ts — AI Business Reports + AI Business Alerts guides (Nov 3 2026): `/pos/ai-business/center/*`.
// Guards: TenantAuthGuard + RolePermissionGuard, pos.ai_business.view (the same gate as the AI Business pages); the money figures
// additionally need the Sales Report's own financial permission, checked by ReportsService. Tenant / branch from req.ctx.
// Nothing here edits a sale, an appointment, a customer, a price or a schedule, and nothing sends a message.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { BusinessCenter, BusinessCenterError, BC_TYPES, BC_STATUSES, BC_PRESETS, BC_EVENT_STATES, BC_RULE_STATUSES } from './business-center';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

export const BUSINESS_CENTER = 'BusinessCenter';
const str = (max: number): BodySchema => S.nullable(S.string({ maxLength: max }));
export const BC_EMPTY_BODY: BodySchema = S.object({});
export const BC_GENERATE_BODY: BodySchema = S.object({ reportType: str(40), preset: str(20) });
export const BC_ACK_BODY: BodySchema = S.object({ note: str(500) });
function ctxFrom(req: any): AiBusinessContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function authed(ctx: AiBusinessContext) { if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof BusinessCenterError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    if (e instanceof AiBusinessError) {
      const st = e.code === AiBusinessErrorCode.INSUFFICIENT_PERMISSION || e.code === AiBusinessErrorCode.BRANCH_NOT_AUTHORIZED ? HttpStatus.FORBIDDEN
        : e.code === AiBusinessErrorCode.METRIC_NOT_FOUND ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException({ code: e.code, message: e.message }, st);
    }
    throw e;
  }
}
const REPORTS = { filters: { type: { type: 'enum', values: BC_TYPES }, status: { type: 'enum', values: BC_STATUSES }, preset: { type: 'enum', values: BC_PRESETS } },
  search: { maxLength: 80 }, sorts: { newest: null, oldest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const RULES = { filters: { status: { type: 'enum', values: BC_RULE_STATUSES } }, search: { maxLength: 80 }, maxLimit: 100, defaultLimit: 25, params: ['page', 'metric'] } as const;
const HISTORY = { filters: { state: { type: 'enum', values: BC_EVENT_STATES }, preset: { type: 'enum', values: BC_PRESETS }, alertId: { type: 'uuid' } },
  search: { maxLength: 80 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai-business/center')
export class BusinessCenterController {
  constructor(@Inject(BUSINESS_CENTER) private readonly bc: BusinessCenter | null) {}
  private c(): BusinessCenter { if (!this.bc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'AI Business needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.bc; }

  // ── reports ──
  @Get('reports/summary') @RequirePermission('pos.ai_business.view')
  reportSummary(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportSummary(c)); }
  @Get('reports') @RequirePermission('pos.ai_business.view') @ListQuery(REPORTS)
  reports(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportList(c, f ?? {})); }
  @Get('reports/:id') @RequirePermission('pos.ai_business.view')
  report(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportDetail(c, id)); }
  @Post('reports/generate') @RequirePermission('pos.ai_business.view')
  generate(@Req() q: any, @Body(ValidatedBody(BC_GENERATE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportGenerate(c, b ?? {})); }
  @Post('reports/:id/regenerate') @RequirePermission('pos.ai_business.view')
  regenerate(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportRegenerate(c, id)); }
  @Post('reports/:id/verify') @RequirePermission('pos.ai_business.view')
  verify(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportVerify(c, id)); }
  @Post('reports/check') @RequirePermission('pos.ai_business.view')
  reportCheck(@Req() q: any, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().check(c, 'reports')); }

  // ── alerts ──
  @Get('alerts/summary') @RequirePermission('pos.ai_business.view')
  alertSummary(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertSummary(c)); }
  @Get('alerts/rules') @RequirePermission('pos.ai_business.view') @ListQuery(RULES)
  rules(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertRules(c, f ?? {})); }
  @Get('alerts/history') @RequirePermission('pos.ai_business.view') @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertHistory(c, f ?? {})); }
  @Post('alerts/:id/evaluate') @RequirePermission('pos.ai_business.view')
  evaluate(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertEvaluate(c, id)); }
  @Post('alerts/events/:id/acknowledge') @RequirePermission('pos.ai_business.view')
  acknowledge(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_ACK_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertAcknowledge(c, id, b ?? {})); }
  @Get('alerts/events/:id/explain') @RequirePermission('pos.ai_business.view')
  explain(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertExplain(c, id)); }
  @Get('alerts/anomaly') @RequirePermission('pos.ai_business.view')
  anomaly(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertAnomaly(c)); }
  @Post('alerts/check') @RequirePermission('pos.ai_business.view')
  alertCheck(@Req() q: any, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().check(c, 'alerts')); }
}
