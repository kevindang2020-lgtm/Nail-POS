// gift-card-stock.controller.ts — physical gift-card inventory HTTP surface (spec §21). GET /pos/gift-cards/stock (levels
// + recent items + low-stock signal), POST register (add a batch of pre-printed numbers), POST :id/void (retire an
// available card from the rack). Guards: TenantAuthGuard + RolePermissionGuard; tenant/branch are server-derived.
import { Idempotent } from '@aipowersalon/database/nest';   // Constitution 5 §61–66
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Param, Post, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { GiftCardStockService, GiftCardStockError } from './gift-card-stock.service';
import type { StockContext } from './gift-card-stock.repository';

import { STOCK_REGISTER_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxFrom(req: any): StockContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? undefined, userId: c.userId }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof GiftCardStockError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/gift-cards/stock')
export class GiftCardStockController {
  constructor(private readonly svc: GiftCardStockService) {}

  @Get() @RequirePermission('pos.checkout.gift_card_issue') state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }
  @Post('register') @RequirePermission('pos.checkout.gift_card_issue') register(@Req() r: any, @Body(ValidatedBody(STOCK_REGISTER_BODY)) b: any) { return run(() => this.svc.registerBatch(ctxFrom(r), b ?? {})); }
  @Idempotent() @Post(':id/void') @RequirePermission('pos.checkout.gift_card_issue') voidStock(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.voidCard(ctxFrom(r), id)); }
}
