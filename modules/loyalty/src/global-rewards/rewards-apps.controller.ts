// rewards-apps.controller.ts — Customer App "My Rewards" (English, /customer/global-rewards; the salon's own program keeps /customer/rewards) and Owner App "Rewards" (English,
// /owner/loyalty/rewards). Tenant, user and role come from the session (req.ctx) only.
//   GET  customer/global-rewards       the signed-in customer's own account, history and the current program terms
//   POST customer/global-rewards/opt-in  explicit opt-in to the CURRENT terms version (affirmative tick required)
//   POST customer/global-rewards/withdraw  leave (points kept, no forfeiture); refused while a checkout holds points
//   GET  owner/loyalty/rewards         owner.dashboard.view — this salon only
import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import type { Kysely } from 'kysely';
import { runGr } from './global-rewards.controller';
import { customerRewards, customerOptIn, customerWithdraw, ownerRewards, type AppCtx } from './rewards-apps';
import { GR_OPT_IN_BODY, GR_WITHDRAW_BODY } from '../request-schemas';

const ctxOf = (r: any): AppCtx => { const c = r?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role ?? null }; };

@Controller('customer/global-rewards')
export class CustomerRewardsController {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  @Get('') mine(@Req() r: any) { return runGr(() => customerRewards(this.db as Kysely<any>, ctxOf(r))); }
  @Post('opt-in') optIn(@Req() r: any, @Body(ValidatedBody(GR_OPT_IN_BODY, { strict: true })) b: any) { return runGr(() => customerOptIn(this.db as Kysely<any>, ctxOf(r), { termsVersion: String(b?.termsVersion ?? ''), accept: b?.accept === true })); }
  @Post('withdraw') withdraw(@Req() r: any, @Body(ValidatedBody(GR_WITHDRAW_BODY, { strict: true })) b: any) { return runGr(() => customerWithdraw(this.db as Kysely<any>, ctxOf(r), { reason: b?.reason ?? null })); }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('owner/loyalty')
export class OwnerRewardsController {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  @Get('rewards') @RequirePermission('owner.dashboard.view') rewards(@Req() r: any) { return runGr(() => ownerRewards(this.db as Kysely<any>, ctxOf(r))); }
}
