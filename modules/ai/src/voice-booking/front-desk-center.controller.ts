// front-desk-center.controller.ts — AI Front Desk guide (Oct 31 2026): `/pos/ai/front-desk/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the body.
//   ai.use     summary · agents (search / filters / dates / pages) · agents/:id (profile overlay) · agents/:id/wizard
//              · agents/:id/calls · events · monitor · agents/:id/activation/preview · health (read-only, recorded)
//   ai.manage  create draft · save draft (version-checked) · duplicate · pause · resume (non-live) · archive · restore
//   OWNER      activate · resume of a previously-live agent · rollback — checked in the service (FrontDeskCenter.owner)
// Nothing here calls Twilio or Retell, places a call or buys anything.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { FrontDeskCenter, FrontDeskError, FRONT_DESK_CENTER, FD_FILTERS, FD_DATE_BASES, FD_SORTS, FD_EVENT_ACTIONS, FD_BOOKING_MODES, type FdCtx } from './front-desk-center';
import { ReceptionistCenterError, RC_PERIODS } from './receptionist-center';

export { FRONT_DESK_CENTER } from './front-desk-center';

export const FD_CREATE_BODY: BodySchema = S.object({ name: S.text(80), description: S.nullable(S.text(500)), branchId: S.nullable(S.text(40)), idempotencyKey: S.text(120) }, ['name', 'idempotencyKey']);
export const FD_SAVE_BODY: BodySchema = S.object({
  expectedVersion: S.integer(), step: S.integer(), markDone: S.boolean(), name: S.text(80), description: S.nullable(S.text(500)), branchId: S.nullable(S.text(40)),
  greeting: S.text(600), behavior: S.text(4000), useCase: S.text(200), callType: S.enumOf(['inbound', 'outbound', 'both']), bookingMode: S.enumOf([...FD_BOOKING_MODES]),
  handoffDestination: S.nullable(S.text(40)), afterHoursMessage: S.nullable(S.text(500)),
}, ['expectedVersion', 'step']);
export const FD_KEY_BODY: BodySchema = S.object({ idempotencyKey: S.text(120) }, ['idempotencyKey']);
export const FD_ACTION_BODY: BodySchema = S.object({ expectedVersion: S.integer(), reason: S.nullable(S.text(500)), idempotencyKey: S.text(120), confirm: S.boolean() }, ['expectedVersion', 'idempotencyKey']);

function ctxFrom(req: any): FdCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: FdCtx, perm: string) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: unknown) {
    if (e instanceof FrontDeskError || e instanceof ReceptionistCenterError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const AGENTS_LIST = {
  filters: { status: { type: 'enum', values: FD_FILTERS }, dateBasis: { type: 'enum', values: FD_DATE_BASES }, period: { type: 'enum', values: RC_PERIODS }, branchId: { type: 'text' } },
  sorts: { newest: null, oldest: null, name_az: null, name_za: null, updated: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page'],
} as const;
const CALLS_LIST = { filters: { period: { type: 'enum', values: RC_PERIODS } }, sorts: {}, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;
const EVENTS_LIST = { filters: { action: { type: 'enum', values: FD_EVENT_ACTIONS }, period: { type: 'enum', values: RC_PERIODS }, agentId: { type: 'text' } }, sorts: {}, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai/front-desk')
export class FrontDeskCenterController {
  constructor(@Inject(FRONT_DESK_CENTER) private readonly fd: FrontDeskCenter | null) {}
  private f(): FrontDeskCenter { if (!this.fd) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'AI Front Desk needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.fd; }

  @Get('summary') @RequirePermission('ai.use')
  summary(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.f().summary(c)); }

  @Get('agents') @RequirePermission('ai.use') @ListQuery(AGENTS_LIST)
  agents(@Req() q: any, @Query() p: any) {
    const c = ctxFrom(q); need(c, 'ai.use');
    return run(() => this.f().list(c, { status: p?.status, q: p?.q, branchId: p?.branchId, dateBasis: p?.dateBasis, period: p?.period, from: p?.from, to: p?.to, sort: p?.sort, page: p?.page, pageSize: p?.pageSize }));
  }

  @Post('agents') @RequirePermission('ai.manage')
  create(@Req() q: any, @Body(ValidatedBody(FD_CREATE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.f().create(c, b)); }

  @Get('agents/:id') @RequirePermission('ai.use')
  detail(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.f().detail(c, id)); }

  @Get('agents/:id/wizard') @RequirePermission('ai.use')
  wizard(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.f().wizard(c, id)); }

  @Patch('agents/:id') @RequirePermission('ai.manage')
  save(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FD_SAVE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.f().save(c, id, b)); }

  @Post('agents/:id/duplicate') @RequirePermission('ai.manage')
  duplicate(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FD_KEY_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.f().duplicate(c, id, b)); }

  @Get('agents/:id/calls') @RequirePermission('ai.use') @ListQuery(CALLS_LIST)
  calls(@Req() q: any, @Param('id') id: string, @Query() p: any) {
    const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.f().calls(c, id, { q: p?.q, period: p?.period, from: p?.from, to: p?.to, page: p?.page, pageSize: p?.pageSize }));
  }

  @Get('agents/:id/activation/preview') @RequirePermission('ai.use')
  preview(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.f().activationPreview(c, id)); }

  /** owner-approved activation — preflight re-checked server-side, per-route lock, one transaction */
  @Post('agents/:id/activate') @RequirePermission('ai.manage')
  activate(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FD_ACTION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.f().activate(c, id, b)); }

  @Post('agents/:id/pause') @RequirePermission('ai.manage')
  pause(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FD_ACTION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.f().pause(c, id, b)); }

  @Post('agents/:id/resume') @RequirePermission('ai.manage')
  resume(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FD_ACTION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.f().resume(c, id, b)); }

  @Post('agents/:id/archive') @RequirePermission('ai.manage')
  archive(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FD_ACTION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.f().archive(c, id, b)); }

  @Post('agents/:id/restore') @RequirePermission('ai.manage')
  restore(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FD_ACTION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.f().restore(c, id, b)); }

  @Post('agents/:id/rollback') @RequirePermission('ai.manage')
  rollback(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FD_ACTION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.f().rollback(c, id, b)); }

  /** per-agent Check Health — read-only, recorded, rate-limited */
  @Post('agents/:id/health') @RequirePermission('ai.use')
  agentHealth(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.f().agentHealth(c, id)); }

  /** Check AI Front Desk System — read-only, recorded, rate-limited */
  @Post('health') @RequirePermission('ai.use')
  health(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.f().systemHealth(c)); }

  @Get('monitor') @RequirePermission('ai.use')
  monitor(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.f().monitor(c)); }

  @Get('events') @RequirePermission('ai.use') @ListQuery(EVENTS_LIST)
  events(@Req() q: any, @Query() p: any) {
    const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.f().events(c, { agentId: p?.agentId, action: p?.action, period: p?.period, from: p?.from, to: p?.to, page: p?.page, pageSize: p?.pageSize }));
  }
}
