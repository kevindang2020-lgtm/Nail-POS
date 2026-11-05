// gift-cards.controller.ts — GET /pos/gift-cards/state. Guards: TenantAuthGuard (authenticated tenant
// user) + RolePermissionGuard (@RequirePermission). Tenant/branch are server-derived from req.ctx.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { GiftCardsService, ForbiddenError, GiftCardsValidationError } from './gift-cards.service';
import type { GiftCardsContext } from './gift-cards.dto';
import { ListQueries } from '@aipowersalon/database';
import { GiftCardsControllerListQueries } from './gift-cards.list-queries';

function ctxFrom(req: any): GiftCardsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN); if (e instanceof GiftCardsValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(GiftCardsControllerListQueries)
@Controller('pos/gift-cards')
export class GiftCardsController {
  constructor(private readonly svc: GiftCardsService) {}

  @Get('state') @RequirePermission('pos.checkout.view')
  state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  // Functional Decision 31 — branch gift-card liability and inter-branch clearing.
  @Get('liability') @RequirePermission('pos.reports.view')
  liability(@Req() r: any, @Query('from') from?: string, @Query('to') to?: string) { return run(() => this.svc.getLiability(ctxFrom(r), { from, to })); }
}
