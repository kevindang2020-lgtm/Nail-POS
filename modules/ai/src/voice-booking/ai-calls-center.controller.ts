// ai-calls-center.controller.ts — AI Calls guide (Oct 31 2026): `/pos/ai/calls-center/*` (AI Center → AI Calls).
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the body.
//   ai.use   kpis · calls · search · calls/:ref (audited view) · health (read-only check, recorded) · health/last ·
//            reconciliation · assistant
// The transcript stays a link for ai.manage holders only (audited); recordings are never linked. Nothing here places a
// call, changes routing, sends a message or books — the overlay opens Booking / Follow-Ups where a person acts.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { Controller, Get, Post, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ReceptionistCenterError, RC_CALL_STATUSES, RC_OUTCOMES, RC_DATE_BASES, RC_PERIODS, RC_SCOPES, type RcCtx } from './receptionist-center';
import { AiCallsCenter } from './ai-calls-center';
import { AI_CALLS_CENTER } from './ai-calls-tokens';

function ctxFrom(req: any): RcCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: RcCtx, perm: string) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof ReceptionistCenterError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const CALLS_LIST = {
  filters: { status: { type: 'enum', values: RC_CALL_STATUSES }, outcome: { type: 'enum', values: RC_OUTCOMES }, dateBasis: { type: 'enum', values: RC_DATE_BASES }, period: { type: 'enum', values: RC_PERIODS } },
  sorts: { newest: null, oldest: null, longest: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page'],
} as const;
const SEARCH_LIST = { filters: { scope: { type: 'enum', values: RC_SCOPES } }, sorts: {}, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;
const PAGED_LIST = { filters: {}, sorts: {}, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai/calls-center')
export class AiCallsCenterController {
  constructor(@Inject(AI_CALLS_CENTER) private readonly ac: AiCallsCenter | null) {}
  private c(): AiCallsCenter { if (!this.ac) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'AI Calls needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.ac; }

  /** the summary strip with a period (salon-local whole days) and published definitions */
  @Get('kpis') @RequirePermission('ai.use')
  kpis(@Req() q: any, @Query('period') period?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.c().kpis(c, { period, from, to }));
  }

  @Get('calls') @RequirePermission('ai.use') @ListQuery(CALLS_LIST)
  calls(@Req() q: any, @Query() p: any) {
    const c = ctxFrom(q); need(c, 'ai.use');
    return run(() => this.c().calls(c, { q: p?.q, status: p?.status, outcome: p?.outcome, dateBasis: p?.dateBasis, period: p?.period, from: p?.from, to: p?.to, sort: p?.sort, page: p?.page, pageSize: p?.pageSize }));
  }

  /** scoped search: calls | customers (masked, shared phones flagged) | AI appointments | AI activity */
  @Get('search') @RequirePermission('ai.use') @ListQuery(SEARCH_LIST)
  search(@Req() q: any, @Query() p: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.c().search(c, { scope: p?.scope, q: p?.q, page: p?.page, pageSize: p?.pageSize })); }

  /** the call overlay — opening it is audited */
  @Get('calls/:ref') @RequirePermission('ai.use')
  call(@Req() q: any, @Param('ref') ref: string) {
    const c = ctxFrom(q); need(c, 'ai.use');
    return run(() => this.c().detail(c, String(ref).slice(0, 128), hasPermission(c as Parameters<typeof hasPermission>[0], 'ai.manage')));
  }

  /** Check AI Calls System — read-only; places no call, changes no routing, sends nothing */
  @Post('health') @RequirePermission('ai.use')
  health(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.c().health(c)); }

  @Get('health/last') @RequirePermission('ai.use')
  lastHealth(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.c().lastHealth(c)); }

  @Get('reconciliation') @RequirePermission('ai.use')
  reconciliation(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.c().reconciliation(c)); }

  /** missed-call & unresolved assistant — urgent + oldest first; suggestions only */
  @Get('assistant') @RequirePermission('ai.use') @ListQuery(PAGED_LIST)
  assistant(@Req() q: any, @Query() p: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.c().assistant(c, { page: p?.page, pageSize: p?.pageSize })); }
}
