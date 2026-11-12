// inventory-center.controller.ts — AI Inventory Assistant guides (Nov 3 2026): `/pos/ai-inventory/center/*`.
// Guards: TenantAuthGuard + RolePermissionGuard, the same AI package gate as the assistant; tenant / branch from req.ctx.
//   pos.ai_inventory.view (+ inventory.view, re-checked)   summary · products · activity · check
// Read-only: no order, count, transfer, adjustment or disposal happens here.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { InventoryCenter, InventoryCenterError, IC_STATUSES, IC_MOVE_TYPES, IC_PRESETS, type IcCtx } from './inventory-center';

export const INVENTORY_CENTER = 'InventoryCenter';
export const IC_EMPTY_BODY: BodySchema = S.object({});
function ctxFrom(req: any): IcCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function authed(ctx: IcCtx) { if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof InventoryCenterError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
}
const PRODUCTS = { filters: { status: { type: 'enum', values: IC_STATUSES } }, search: { maxLength: 80 }, sorts: { attention: null, name: null, on_hand: null, updated: null }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const ACTIVITY = { filters: { type: { type: 'enum', values: IC_MOVE_TYPES }, preset: { type: 'enum', values: IC_PRESETS } }, search: { maxLength: 80 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page', 'productId'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequiresAiPackage('ai_inventory_assistant')
@Controller('pos/ai-inventory/center')
export class InventoryCenterController {
  constructor(@Inject(INVENTORY_CENTER) private readonly ic: InventoryCenter | null) {}
  private c(): InventoryCenter { if (!this.ic) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Inventory needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.ic; }

  /** the six cards with their definitions and the reasons (why critical, no thresholds, ledger differences) */
  @Get('summary') @RequirePermission('pos.ai_inventory.view')
  summary(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().summary(c)); }

  /** products: search name / SKU / vendor / category · status · sort · numbered pages */
  @Get('products') @RequirePermission('pos.ai_inventory.view') @ListQuery(PRODUCTS)
  products(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().productsList(c, f ?? {})); }

  /** stock movements, newest first: search · type · presets + From/To · numbered pages */
  @Get('activity') @RequirePermission('pos.ai_inventory.view') @ListQuery(ACTIVITY)
  activity(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().activity(c, f ?? {})); }

  /** Check Inventory System — read-only */
  @Post('check') @RequirePermission('pos.ai_inventory.view')
  check(@Req() q: any, @Body(ValidatedBody(IC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().check(c)); }
}
