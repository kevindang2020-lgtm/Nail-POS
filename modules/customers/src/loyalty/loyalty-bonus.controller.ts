// loyalty-bonus.controller.ts — Customer Profile & Global Loyalty Protection guide (Nov 4 2026) §07: the POS side of
// bonus points. The owner's decision is the approvals engine's existing Owner App route (owner/approvals/requests/:id/decide,
// approver key loyalty.bonus.approve — OWNER only). Tenant / branch / user come from the session, never the body.
//   POST /pos/loyalty/bonus-requests            pos.customers.loyalty.edit   ask for +points (pending; nothing moves)
//   GET  /pos/loyalty/bonus-requests/preview    pos.customers.view           server preview: current, after, token cost
//   GET  /pos/loyalty/bonus-requests            pos.customers.view           history (customer / status filter, numbered pages)
//   GET  /pos/loyalty/bonus-requests/health     pos.customers.loyalty.edit   "Check Customer & Loyalty System" (read-only)
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ListQuery } from '@aipowersalon/database';
import { Body, Controller, Get, HttpException, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { LoyaltyBonusService, LoyaltyBonusError, cleanBonusInput, type BonusActor } from './loyalty-bonus';
import { LOYALTY_BONUS_REQUEST_BODY } from '../request-schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function actorOf(req: any): BonusActor {
  const c = req?.ctx || {};
  return { tenantId: String(c.tenantId ?? ''), branchId: typeof c.branchId === 'string' && UUID.test(c.branchId) ? c.branchId : null, userId: String(c.userId ?? ''), role: String(c.role ?? ''), permissions: Array.isArray(c.permissions) ? c.permissions : [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof LoyaltyBonusError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    // the approvals engine's refusals (policy, permissions) — the same shape its own routes answer with
    if (e?.name === 'ApprovalError' && typeof e.status === 'number') throw new HttpException({ ok: false, code: e.apiCode ?? e.code, message: e.message, ...(e.extra || {}) }, e.status);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/loyalty/bonus-requests')
export class LoyaltyBonusController {
  constructor(@Inject(LoyaltyBonusService) private readonly svc: LoyaltyBonusService) {}

  @Post() @RequirePermission('pos.customers.loyalty.edit')
  create(@Req() r: any, @Body(ValidatedBody(LOYALTY_BONUS_REQUEST_BODY, { strict: true })) b: any) { return run(() => this.svc.request(actorOf(r), b)); }

  @Get('preview') @RequirePermission('pos.customers.view')
  preview(@Req() r: any, @Query() q: any) {
    return run(async () => { const c = cleanBonusInput({ customerId: q?.customerId, points: Number(q?.points), reason: 'preview' }); return this.svc.preview(actorOf(r), c.customerId, c.points); });
  }

  @Get('health') @RequirePermission('pos.customers.loyalty.edit')
  health(@Req() r: any) { return run(() => this.svc.health(actorOf(r))); }

  @Get() @RequirePermission('pos.customers.view') @ListQuery({ filters: { status: { type: 'enum', values: ['pending', 'approved', 'executed', 'execution_failed', 'rejected', 'expired', 'cancelled'] }, customerId: { type: 'uuid' } }, search: false, maxLimit: 100, defaultLimit: 25, params: ['page'] })
  list(@Req() r: any, @Query() q: any) {
    return run(() => this.svc.list(actorOf(r), { customerId: typeof q?.customerId === 'string' ? q.customerId : undefined, status: typeof q?.status === 'string' ? q.status : undefined, page: Number(q?.page), pageSize: Number(q?.pageSize) }));
  }
}
