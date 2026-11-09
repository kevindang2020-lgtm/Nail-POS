// appointment-history-center.controller.ts — Appointment History SUNMI guide (Nov 9 2026): `/pos/appointment-history/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the query.
//   pos.customers.view  summary · appointments · options · check (read-only diagnostics). Nothing here writes Booking data.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import type { AhSummaryResponse, AhListResponse, AhOptionsResponse, AhCheckResponse } from '@aipowersalon/api-contracts/tenant';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { RetentionContext } from '../retention/retention.repository';
import { AppointmentHistoryCenter, AppointmentHistoryError, AH_STATUSES, AH_DATE_FIELDS, AH_PRESETS } from './appointment-history-center';

export const APPOINTMENT_HISTORY_CENTER = 'AppointmentHistoryCenter';
/** POST check — no body */
export const AH_CHECK_BODY: BodySchema = S.object({});

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, perm: string) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof AppointmentHistoryError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status); throw e; }
}
const FILTERS = { status: { type: 'enum', values: AH_STATUSES }, dateField: { type: 'enum', values: AH_DATE_FIELDS }, preset: { type: 'enum', values: AH_PRESETS }, technician: { type: 'uuid' } } as const;
const LIST = { filters: FILTERS, sorts: { newest: null, scheduled: null, upcoming: null, updated: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/appointment-history')
export class AppointmentHistoryCenterController {
  constructor(@Inject(APPOINTMENT_HISTORY_CENTER) private readonly ah: AppointmentHistoryCenter | null) {}
  private r(): AppointmentHistoryCenter { if (!this.ah) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Appointment History needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.ah; }

  /** the six cards over the same filters as the table */
  @Get('summary') @RequirePermission('pos.customers.view')
  @ListQuery({ filters: FILTERS, search: { maxLength: 100 }, dateRange: { maxDays: 3660 } } as const)
  summary(@Req() q: any, @Query() f: any): Promise<AhSummaryResponse> { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().summary(c, f ?? {})); }

  /** the table: q (customer · phone · appointment / customer id · technician · service) · status · technician · which date + range · sort · pages */
  @Get('appointments') @RequirePermission('pos.customers.view')
  @ListQuery(LIST)
  list(@Req() q: any, @Query() f: any): Promise<AhListResponse> { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().list(c, f ?? {})); }

  @Get('options') @RequirePermission('pos.customers.view')
  options(@Req() q: any): Promise<AhOptionsResponse> { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().options(c)); }

  /** Check Appointment History System — read-only */
  @Post('check') @RequirePermission('pos.customers.view')
  check(@Req() q: any, @Body(ValidatedBody(AH_CHECK_BODY, { strict: true })) _b: unknown): Promise<AhCheckResponse> { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().check(c)); }
}
