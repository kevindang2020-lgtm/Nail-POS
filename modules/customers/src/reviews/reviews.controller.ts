// reviews.controller.ts — GET /pos/reviews/state (view) + POST /pos/reviews/:id/visibility (manage).
// Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch server-derived from req.ctx.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { REVIEW_VISIBILITY_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ReviewsService, ReviewsForbiddenError, ReviewsValidationError } from './reviews.service';
import type { ReviewsContext } from './reviews.dto';

function ctxFrom(req: any): ReviewsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ReviewsForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ReviewsValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/reviews')
export class ReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Get('state') @RequirePermission('pos.marketing.view')
  state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  @Post(':id/visibility') @RequirePermission('pos.marketing.manage')
  visibility(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_VISIBILITY_BODY)) b: any) {
    return run(() => this.svc.setVisibility(ctxFrom(r), id, !!b?.hidden, b?.reason ?? null));
  }
}
