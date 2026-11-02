// ai-inventory.controller.ts — AI Inventory Assistant HTTP surface (slice 1: read-only inventory position/context).
// TenantAuthGuard + RolePermissionGuard; tenant/branch/role/permissions come ONLY from req.ctx (server-derived), never
// from body/query/header. Feature access is the dedicated pos.ai_inventory.view; data-bearing reads additionally require
// the authoritative inventory.view (enforced in the service). No mutation endpoints exist in this slice.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AI_INVENTORY_RECIPE_BODY } from '../request-schemas';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException } from '@nestjs/common';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { AiInventoryPositionService } from './ai-inventory-position.service';
import { AiInventoryReorderService } from './ai-inventory-reorder.service';
import { AiInventorySlowMovingService } from './ai-inventory-slowmoving.service';
import { AiInventoryRecipeService } from './ai-inventory-recipe.service';
import { AiInventoryError, type AiInventoryContext } from './ai-inventory.dto';
import { ListQueries } from '@aipowersalon/database';
import { AiInventoryControllerListQueries } from './ai-inventory.list-queries';

function ctxFrom(req: any): AiInventoryContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof AiInventoryError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.status);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
// Gated on the tenant's AI subscription. Ships in OBSERVE mode: the call still runs, but a tenant who is
// unsubscribed / expired / over-limit is RECORDED as a would-be denial in ai_usage_logs. Nobody's access
// changes until AI_ENTITLEMENT_ENFORCEMENT=enforce is set deliberately - see ai-entitlement.guard.ts.
@RequiresAiPackage('ai_inventory_assistant')
@ListQueries(AiInventoryControllerListQueries)
@Controller('pos/ai-inventory')
export class AiInventoryController {
  constructor(
    private readonly position: AiInventoryPositionService,
    private readonly reorder: AiInventoryReorderService,
    private readonly slowMoving: AiInventorySlowMovingService,
    private readonly recipes: AiInventoryRecipeService,
  ) {}

  @Get('slow-moving')
  @RequirePermission('pos.ai_inventory.view')
  getSlowMoving(@Req() r: any, @Query('includeNew') includeNew?: string) {
    return run(() => this.slowMoving.getSlowMoving(ctxFrom(r), { includeNew: includeNew === 'true' }));
  }

  // ---- service-consumption recipes (§11): reads gated by view; writes require manage_recipes ----
  @Get('recipes')
  @RequirePermission('pos.ai_inventory.view')
  listRecipes(@Req() r: any, @Query('serviceId') serviceId?: string, @Query('status') status?: string) {
    return run(() => this.recipes.list(ctxFrom(r), { serviceId: serviceId || null, status: (status as any) || null }));
  }

  @Get('recipes/:id')
  @RequirePermission('pos.ai_inventory.view')
  getRecipe(@Req() r: any, @Param('id') id: string) {
    return run(() => this.recipes.get(ctxFrom(r), id));
  }

  @Post('recipes')
  @RequirePermission('ai_inventory.manage_recipes')
  createRecipe(@Req() r: any, @Body(ValidatedBody(AI_INVENTORY_RECIPE_BODY, { strict: true })) body: any) {
    return run(() => this.recipes.createDraft(ctxFrom(r), body));
  }

  @Post('recipes/:id/approve')
  @RequirePermission('ai_inventory.manage_recipes')
  approveRecipe(@Req() r: any, @Param('id') id: string) {
    return run(() => this.recipes.approve(ctxFrom(r), id));
  }

  @Post('recipes/:id/archive')
  @RequirePermission('ai_inventory.manage_recipes')
  archiveRecipe(@Req() r: any, @Param('id') id: string) {
    return run(() => this.recipes.archive(ctxFrom(r), id));
  }

  @Get('low-stock')
  @RequirePermission('pos.ai_inventory.view')
  getLowStock(@Req() r: any) {
    return run(() => this.reorder.getLowStock(ctxFrom(r)));
  }

  @Get('reorder-recommendations')
  @RequirePermission('pos.ai_inventory.view')
  getReorder(@Req() r: any) {
    return run(() => this.reorder.getReorderRecommendations(ctxFrom(r)));
  }

  @Get('context')
  @RequirePermission('pos.ai_inventory.view')
  getContext(@Req() r: any) {
    return run(() => this.position.getContext(ctxFrom(r)));
  }

  @Get('positions')
  @RequirePermission('pos.ai_inventory.view')
  getPositions(@Req() r: any, @Query('categoryId') categoryId?: string, @Query('limit') limit?: string) {
    const lim = limit ? Math.max(1, Math.min(500, parseInt(limit, 10) || 200)) : undefined;
    return run(() => this.position.getPositions(ctxFrom(r), { categoryId: categoryId || null, limit: lim }));
  }

  @Get('positions/:productId')
  @RequirePermission('pos.ai_inventory.view')
  getProductPosition(@Req() r: any, @Param('productId') productId: string) {
    return run(() => this.position.getProductPosition(ctxFrom(r), productId));
  }
}
