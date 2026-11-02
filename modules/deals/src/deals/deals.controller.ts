// deals.controller.ts — manager/owner Deals Marketplace administration. Route: pos/deals. Guards: TenantAuthGuard +
// RolePermissionGuard; tenant/branch/user server-derived from req.ctx (never the client). Thin — all logic in the
// service. Reuses the catalogued marketing permissions (view/manage) that managers already hold.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { COUPON_GENERATE_BODY, DEAL_DUPLICATE_BODY, DEAL_CREATE_BODY, DEAL_PREVIEW_BODY, DEAL_SETTINGS_BODY, DEAL_UPDATE_BODY, REASON_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { utcDate } from '@aipowersalon/date-time';
import { DealsService, DealForbiddenError, DealValidationError, DealConflictError } from './deals.service';
import type { DealContext } from './deals.dto';
import { ListQueries } from '@aipowersalon/database';
import { DealsControllerListQueries } from './deals.list-queries';

function ctxFrom(req: any): DealContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], technicianId: c.technicianId ?? null };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof DealForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof DealValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof DealConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(DealsControllerListQueries)
@Controller('pos/deals')
export class DealsController {
  constructor(private readonly svc: DealsService) {}

  @Get('settings') @RequirePermission('pos.marketing.view')
  getSettings(@Req() r: any) { return run(() => this.svc.getSettings(ctxFrom(r))); }

  @Patch('settings') @RequirePermission('pos.marketing.manage')
  updateSettings(@Req() r: any, @Body(ValidatedBody(DEAL_SETTINGS_BODY, { strict: true })) b: any) { return run(() => this.svc.updateSettings(ctxFrom(r), b || {})); }

  @Get() @RequirePermission('pos.marketing.view')
  list(@Req() r: any, @Query('status') status?: string, @Query('ownerType') ownerType?: string, @Query('kind') kind?: string) {
    return run(() => this.svc.listDeals(ctxFrom(r), { status: status as any, ownerType, kind: kind || undefined }));
  }

  @Get('analytics') @RequirePermission('pos.marketing.view')
  analytics(@Req() r: any) { return run(() => this.svc.getAnalytics(ctxFrom(r))); }

  // BUILD_PLAN Phase 5 — the dashboard (daily stats), the simulator (preview), versions, editing, coupons
  @Get('dashboard') @RequirePermission('pos.marketing.view')
  dashboard(@Req() r: any, @Query('days') days?: string) { return run(() => this.svc.dashboard(ctxFrom(r), Number(days) || 30)); }

  // reports/exports: same JSON envelope as the other POS exports ({ format, filename, csv }) — the app saves the file
  @AsyncExport({ kind: 'pos.deals.export' }) @Get('export') @RequirePermission('pos.marketing.view')
  async exportCsv(@Req() r: any, @Query('days') days?: string) {
    const csv = await run(() => this.svc.exportCsv(ctxFrom(r), Number(days) || 30));
    return { format: 'csv', filename: `deal-redemptions-${utcDate()}.csv`, csv };
  }

  @Post('preview') @RequirePermission('pos.marketing.view')
  preview(@Req() r: any, @Body(ValidatedBody(DEAL_PREVIEW_BODY, { strict: true })) b: any) { return run(() => this.svc.preview(ctxFrom(r), b?.deal || {}, b?.sample || {})); }

  @Get(':id') @RequirePermission('pos.marketing.view')
  get(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.getDeal(ctxFrom(r), id)); }

  @Post() @RequirePermission('pos.marketing.manage')
  create(@Req() r: any, @Body(ValidatedBody(DEAL_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createDeal(ctxFrom(r), { ...b, ownerType: 'salon' })); }

  @Post(':id/submit') @RequirePermission('pos.marketing.manage')
  submit(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.submit(ctxFrom(r), id)); }

  @Post(':id/approve') @RequirePermission('pos.marketing.manage')
  approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.approve(ctxFrom(r), id, b?.reason)); }

  @Post(':id/reject') @RequirePermission('pos.marketing.manage')
  reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.reject(ctxFrom(r), id, b?.reason)); }

  // Deals & Offers guide §9: send a technician proposal back as a draft with a note (never by its own proposer)
  @Post(':id/request-changes') @RequirePermission('pos.marketing.manage')
  requestChanges(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.requestChanges(ctxFrom(r), id, b?.reason)); }

  @Post(':id/pause') @RequirePermission('pos.marketing.manage')
  pause(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.pause(ctxFrom(r), id)); }

  @Post(':id/resume') @RequirePermission('pos.marketing.manage')
  resume(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.resume(ctxFrom(r), id)); }

  @Post(':id/publish') @RequirePermission('pos.marketing.manage')
  publish(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.publish(ctxFrom(r), id)); }

  @Patch(':id') @RequirePermission('pos.marketing.manage')
  update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DEAL_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.updateDeal(ctxFrom(r), id, b || {})); }

  @Get(':id/versions') @RequirePermission('pos.marketing.view')
  versions(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.versions(ctxFrom(r), id)); }

  @Post(':id/cancel') @RequirePermission('pos.marketing.manage')
  cancel(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.cancel(ctxFrom(r), id)); }

  @Post(':id/archive') @RequirePermission('pos.marketing.manage')
  archive(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.archive(ctxFrom(r), id)); }

  /** Coupons & Promotions guide §10: a NEW draft with the same terms (no codes, counters or ledger copied) */
  @Post(':id/duplicate') @RequirePermission('pos.marketing.manage')
  duplicate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DEAL_DUPLICATE_BODY, { strict: true })) b: any) { return run(() => this.svc.duplicateDeal(ctxFrom(r), id, { title: b?.title ?? null, code: b?.code ?? null })); }

  @Get(':id/coupons') @RequirePermission('pos.marketing.view')
  coupons(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.listCodes(ctxFrom(r), id)); }

  // The codes come back ONCE, here; afterwards only their last four characters exist anywhere.
  @Post(':id/coupons/generate') @RequirePermission('pos.marketing.manage')
  generate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COUPON_GENERATE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.generateCodes(ctxFrom(r), id, { quantity: b?.quantity, prefix: b?.prefix ?? null, singleUse: b?.singleUse, maxUses: b?.maxUses ?? null, expiresAt: b?.expiresAt ?? null,
      customerIds: Array.isArray(b?.customerIds) ? b.customerIds.map(String).slice(0, 10000) : undefined, purpose: b?.purpose, campaignId: b?.campaignId ?? null }));
  }

  @Post(':id/coupons/:codeId/revoke') @RequirePermission('pos.marketing.manage')
  revoke(@Req() r: any, @Param('id') id: string, @Param('codeId') codeId: string, @Body(ValidatedBody(REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.revokeCode(ctxFrom(r), id, codeId, b?.reason)); }
}
