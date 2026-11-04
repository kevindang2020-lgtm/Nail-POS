// loyalty-program.controller.ts — Loyalty & Rewards mandate (Oct 29 2026): `/pos/loyalty/*` reads and writes the POS
// Loyalty & Rewards screen needs, beside modules/loyalty's existing `state` + rewards catalogue routes (same prefix,
// different paths). Guards: TenantAuthGuard + RolePermissionGuard; the plan feature gate is the same as the catalogue's.
// Tenant / branch / role come from the session (req.ctx), never the body or the query.
//   reads   pos.customers.view          overview · rewards · members · redemptions · redemptions/:id · ledger
//   writes  pos.customers.loyalty.edit  enroll · adjust · redeem   (the existing loyalty-edit capability; unchanged policy)
//           pos.settings.edit           tiers · tiers/:id · members/:id/tier  (owners / managers — Manage Tiers, Nov 4 2026)
//           pos.checkout.void           redemptions/:id/void       (owners / managers: the void / override capability — checkout.manage_overrides; front desk cannot)
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { LoyaltyProgramRepository, LoyaltyProgramError, type LoyaltyProgramContext } from './loyalty-program.repository';
import { LOYALTY_ENROLL_BODY, LOYALTY_PROGRAM_ADJUST_BODY, LOYALTY_REDEEM_BODY, LOYALTY_VOID_BODY, LOYALTY_TIER_BODY, LOYALTY_MEMBER_TIER_BODY } from '../request-schemas';

export const LOYALTY_PROGRAM_REPOSITORY = 'LoyaltyProgramRepository';

function ctxFrom(req: any): LoyaltyProgramContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: LoyaltyProgramContext, perm: string) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof LoyaltyProgramError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    throw e;
  }
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('loyalty')
@Controller('pos/loyalty')
export class LoyaltyProgramController {
  constructor(@Inject(LOYALTY_PROGRAM_REPOSITORY) private readonly repo: LoyaltyProgramRepository | null) {}
  private db(): LoyaltyProgramRepository {
    if (!this.repo) throw withCode(new HttpException('The loyalty program needs the database.', HttpStatus.SERVICE_UNAVAILABLE), 'SERVICE_UNAVAILABLE');
    return this.repo;
  }

  @Get('overview') @RequirePermission('pos.customers.view')
  overview(@Req() r: any) { const c = ctxFrom(r); need(c, 'pos.customers.view'); return run(() => this.db().overview(c)); }

  @Get('rewards') @RequirePermission('pos.customers.view') @ListQuery({ filters: { status: { type: 'enum', values: ['active', 'inactive'] } }, search: false, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  rewards(@Req() r: any, @Query() q: any) { const c = ctxFrom(r); need(c, 'pos.customers.view'); return run(() => this.db().rewards(c, { page: q?.page, pageSize: q?.pageSize, status: s(q?.status) })); }

  @Get('members') @RequirePermission('pos.customers.view') @ListQuery({ filters: { tier: { type: 'text', maxLength: 80 }, status: { type: 'enum', values: ['active', 'inactive'] }, sort: { type: 'enum', values: ['newest', 'balance', 'activity'] } }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  members(@Req() r: any, @Query() q: any) { const c = ctxFrom(r); need(c, 'pos.customers.view'); return run(() => this.db().members(c, { page: q?.page, pageSize: q?.pageSize, tier: s(q?.tier), q: s(q?.q), status: s(q?.status), sort: s(q?.sort) })); }

  @Get('tiers') @RequirePermission('pos.customers.view')
  tiers(@Req() r: any) { const c = ctxFrom(r); need(c, 'pos.customers.view'); return run(() => this.db().tierList(c)); }

  @Post('tiers') @RequirePermission('pos.settings.edit')
  createTier(@Req() r: any, @Body(ValidatedBody(LOYALTY_TIER_BODY, { strict: true })) b: any) {
    const c = ctxFrom(r); need(c, 'pos.settings.edit');
    return run(() => this.db().saveTier(c, { name: String(b?.name ?? ''), rank: b?.rank ?? null, minPoints: b?.minPoints ?? null, benefits: b?.benefits ?? null, active: b?.active ?? null }));
  }

  @Post('tiers/:tierId') @RequirePermission('pos.settings.edit')
  updateTier(@Req() r: any, @Param('tierId') id: string, @Body(ValidatedBody(LOYALTY_TIER_BODY, { strict: true })) b: any) {
    const c = ctxFrom(r); need(c, 'pos.settings.edit');
    return run(() => this.db().saveTier(c, { id, name: String(b?.name ?? ''), rank: b?.rank ?? null, minPoints: b?.minPoints ?? null, benefits: b?.benefits ?? null, active: b?.active ?? null }));
  }

  @Post('members/:customerId/tier') @RequirePermission('pos.settings.edit')
  memberTier(@Req() r: any, @Param('customerId') id: string, @Body(ValidatedBody(LOYALTY_MEMBER_TIER_BODY, { strict: true })) b: any) {
    const c = ctxFrom(r); need(c, 'pos.settings.edit');
    return run(() => this.db().setMemberTier(c, { customerId: id, tier: String(b?.tier ?? ''), reason: String(b?.reason ?? '') }));
  }

  @Get('redemptions') @RequirePermission('pos.customers.view') @ListQuery({ filters: { status: { type: 'enum', values: ['pending', 'issued', 'applied', 'used', 'void'] }, rewardId: { type: 'uuid' }, customerId: { type: 'uuid' } }, search: false, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  redemptions(@Req() r: any, @Query() q: any) { const c = ctxFrom(r); need(c, 'pos.customers.view'); return run(() => this.db().redemptions(c, { page: q?.page, pageSize: q?.pageSize, status: s(q?.status), rewardId: s(q?.rewardId), customerId: s(q?.customerId) })); }

  @Get('redemptions/:redemptionId') @RequirePermission('pos.customers.view')
  redemption(@Req() r: any, @Param('redemptionId') id: string) {
    const c = ctxFrom(r); need(c, 'pos.customers.view');
    return run(async () => { const d = await this.db().redemptionDetail(c, id); if (!d) throw new LoyaltyProgramError('Redemption not found.', 'REDEMPTION_NOT_FOUND', 404); return d; });
  }

  @Get('ledger') @RequirePermission('pos.customers.view') @ListQuery({ filters: { entryType: { type: 'enum', values: ['earn', 'redeem', 'adjust', 'reverse', 'merge'] }, customerId: { type: 'uuid' } }, search: false, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  ledger(@Req() r: any, @Query() q: any) { const c = ctxFrom(r); need(c, 'pos.customers.view'); return run(() => this.db().ledger(c, { page: q?.page, pageSize: q?.pageSize, entryType: s(q?.entryType), customerId: s(q?.customerId) })); }

  @Post('enroll') @RequirePermission('pos.customers.loyalty.edit')
  enroll(@Req() r: any, @Body(ValidatedBody(LOYALTY_ENROLL_BODY, { strict: true })) b: any) { const c = ctxFrom(r); need(c, 'pos.customers.loyalty.edit'); return run(() => this.db().enroll(c, String(b?.customerId ?? ''))); }

  @Post('adjust') @RequirePermission('pos.customers.loyalty.edit')
  adjust(@Req() r: any, @Body(ValidatedBody(LOYALTY_PROGRAM_ADJUST_BODY, { strict: true })) b: any) {
    const c = ctxFrom(r); need(c, 'pos.customers.loyalty.edit');
    return run(() => this.db().adjust(c, { customerId: String(b?.customerId ?? ''), delta: Number(b?.delta), reason: String(b?.reason ?? ''), idempotencyKey: String(b?.idempotencyKey ?? '') }));
  }

  @Post('redeem') @RequirePermission('pos.customers.loyalty.edit')
  redeem(@Req() r: any, @Body(ValidatedBody(LOYALTY_REDEEM_BODY, { strict: true })) b: any) {
    const c = ctxFrom(r); need(c, 'pos.customers.loyalty.edit');
    return run(() => this.db().redeem(c, { customerId: String(b?.customerId ?? ''), rewardId: String(b?.rewardId ?? ''), idempotencyKey: String(b?.idempotencyKey ?? '') }));
  }

  @Post('redemptions/:redemptionId/void') @RequirePermission('pos.checkout.void')
  void(@Req() r: any, @Param('redemptionId') id: string, @Body(ValidatedBody(LOYALTY_VOID_BODY, { strict: true })) b: any) {
    const c = ctxFrom(r); need(c, 'pos.checkout.void');
    return run(() => this.db().voidRedemption(c, id, String(b?.reason ?? '')));
  }
}
