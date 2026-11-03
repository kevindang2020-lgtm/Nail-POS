// scheduling-center.controller.ts — AI Scheduling Optimizer guide (Nov 2 2026): `/pos/ai-scheduling-optimizer/center/*`, the
// optimizer page's read side. Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from the session (req.ctx).
//   ai_scheduling.view   summary · recommendations · history · check
// Not behind the AI package gate on purpose: when the subscription lapses the page must SAY "subscription restricted" (and
// keep the history readable) instead of answering 403 and showing zeros. Every write stays on the engine routes.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { SchedulingCenter, SchedulingCenterError, SC_GROUPS, SC_DATE_FIELDS, SC_PRESETS, SC_EVENT_KINDS, type ScCtx } from './scheduling-center';

export const SCHEDULING_CENTER = 'SchedulingCenter';
export const SC_EMPTY_BODY: BodySchema = S.object({});
function ctxFrom(req: any): ScCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: ScCtx) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], 'ai_scheduling.view')) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof SchedulingCenterError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
}
const RECS = { filters: { preset: { type: 'enum', values: SC_PRESETS }, group: { type: 'enum', values: SC_GROUPS }, dateField: { type: 'enum', values: SC_DATE_FIELDS } },
  search: { maxLength: 80 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const HISTORY = { filters: { preset: { type: 'enum', values: SC_PRESETS }, kind: { type: 'enum', values: SC_EVENT_KINDS } },
  search: { maxLength: 80 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai-scheduling-optimizer/center')
export class SchedulingCenterController {
  constructor(@Inject(SCHEDULING_CENTER) private readonly sc: SchedulingCenter | null) {}
  private c(): SchedulingCenter { if (!this.sc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The scheduling optimizer needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.sc; }

  /** the four counters (one definition each), the module's parts, the last evaluation and data freshness */
  @Get('summary') @RequirePermission('ai_scheduling.view')
  summary(@Req() q: any) { const c = ctxFrom(q); need(c); return run(() => this.c().summary(c)); }

  /** the recommendation queue: search · status group · which date · presets / range · numbered pages (newest first) */
  @Get('recommendations') @RequirePermission('ai_scheduling.view') @ListQuery(RECS)
  recommendations(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c); return run(() => this.c().recommendations(c, f ?? {})); }

  /** History: the append-only event trail (generated · staff · customer · apply), newest first */
  @Get('history') @RequirePermission('ai_scheduling.view') @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c); return run(() => this.c().history(c, f ?? {})); }

  /** Check Scheduling System — read-only */
  @Post('check') @RequirePermission('ai_scheduling.view')
  check(@Req() q: any, @Body(ValidatedBody(SC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c); return run(() => this.c().check(c)); }
}
