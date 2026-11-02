// pos-social.controller.ts — tenant social content planner. Route: pos/social-posts.
// Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch server-derived from req.ctx.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SocialService, SocialForbiddenError, SocialValidationError } from './pos-social.service';
import type { SocialContext } from './pos-social.dto';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { SOCIAL_POST_BODY, SOCIAL_POST_STATUS_BODY } from '../request-schemas';

function ctxFrom(req: any): SocialContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof SocialForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof SocialValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/social-posts')
export class SocialController {
  constructor(private readonly svc: SocialService) {}

  @Get('state') @RequirePermission('pos.marketing.view')
  state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  @Post() @RequirePermission('pos.marketing.manage')
  create(@Req() r: any, @Body(ValidatedBody(SOCIAL_POST_BODY, { strict: true })) b: any) { return run(() => this.svc.create(ctxFrom(r), { platform: b?.platform, caption: b?.caption, scheduledAt: b?.scheduledAt ?? null })); }

  @Post(':id/status') @RequirePermission('pos.marketing.manage')
  setStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SOCIAL_POST_STATUS_BODY, { strict: true })) b: any) { return run(() => this.svc.setStatus(ctxFrom(r), id, b?.status)); }
}
