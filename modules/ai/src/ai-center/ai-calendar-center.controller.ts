// ai-calendar-center.controller.ts — /pos/ai/calendar-center/* (AI Calendar Complete Build Guide). Read-only routes over
// the canonical Booking engine: tenant and branch come from the session only, every route needs pos.booking.view and the
// AI receptionist package (global entitlement guard, honouring AI_ENTITLEMENT_ENFORCEMENT). There is deliberately NO
// write route here: consequential changes go through the Reception Copilot's prepare → confirm → verify path.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { Controller, Get, Post, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { AiCalendarCenter, AiCalendarError, AI_CALENDAR_CENTER, AIC_PACKAGE, AIC_PERIODS, AIC_BASES, AIC_SORTS, AIC_SOURCES, AIC_STATUSES, type AicCtx } from './ai-calendar-center';

function ctxFrom(req: any): AicCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: AicCtx) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.booking.view')) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot view the calendar.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof AiCalendarError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    throw e;
  }
}
const APPOINTMENT_LIST = {
  filters: {
    status: { type: 'enum', values: AIC_STATUSES }, source: { type: 'enum', values: AIC_SOURCES }, period: { type: 'enum', values: AIC_PERIODS },
    basis: { type: 'enum', values: AIC_BASES }, aiOnly: { type: 'boolean' }, technicianId: { type: 'uuid' },
  },
  sorts: { created: null, scheduled: null, updated: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page', 'sort'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequiresAiPackage(AIC_PACKAGE)
@Controller('pos/ai/calendar-center')
export class AiCalendarCenterController {
  private readonly cal: AiCalendarCenter | null;
  constructor(@Inject(AI_CALENDAR_CENTER) cal: AiCalendarCenter | null) { this.cal = cal; }
  private c(): AiCalendarCenter { if (!this.cal) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The AI Calendar needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.cal; }

  /** the four KPI cards with their definitions and the reconciliation lines */
  @Get('summary') @RequirePermission('pos.booking.view')
  summary(@Req() r: any, @Query() q: any) { const x = ctxFrom(r); need(x); return run(() => this.c().summary(x, q?.date)); }

  /** Day view: 12 technician columns per page + appointments and live holds in service-time order */
  @Get('day') @RequirePermission('pos.booking.view')
  day(@Req() r: any, @Query() q: any) { const x = ctxFrom(r); need(x); return run(() => this.c().dayView(x, { date: q?.date, techPage: q?.techPage })); }

  /** Week / Month: per-day totals in salon-local dates */
  @Get('range') @RequirePermission('pos.booking.view')
  range(@Req() r: any, @Query() q: any) { const x = ctxFrom(r); need(x); return run(() => this.c().rangeView(x, { view: q?.view, date: q?.date })); }

  /** List view: server-side search, filters, date basis, pages of 10/20/50, newest created first by default */
  @Get('appointments') @RequirePermission('pos.booking.view') @ListQuery(APPOINTMENT_LIST)
  list(@Req() r: any, @Query() q: any) {
    const x = ctxFrom(r); need(x);
    return run(() => this.c().list(x, { q: q?.q, status: q?.status, source: q?.source, aiOnly: q?.aiOnly, technicianId: q?.technicianId, basis: q?.basis, period: q?.period, from: q?.from, to: q?.to, sort: q?.sort, page: q?.page, pageSize: q?.pageSize }));
  }

  /** Appointment & Customer History overlay — the view itself is audited */
  @Get('appointments/:id') @RequirePermission('pos.booking.view')
  detail(@Req() r: any, @Param('id') id: string) { const x = ctxFrom(r); need(x); return run(() => this.c().detail(x, id)); }

  /** Check Calendar System — observational; records its run; never changes a booking or sends anything */
  @Post('health') @RequirePermission('pos.booking.view')
  health(@Req() r: any, @Query() q: any) { const x = ctxFrom(r); need(x); return run(() => this.c().health(x, q?.date)); }

  /** Smart Scheduling & Availability Assistant — evidence-backed suggestions only */
  @Get('assistant') @RequirePermission('pos.booking.view')
  assistant(@Req() r: any, @Query() q: any) { const x = ctxFrom(r); need(x); return run(() => this.c().assistant(x, q?.date)); }
}
