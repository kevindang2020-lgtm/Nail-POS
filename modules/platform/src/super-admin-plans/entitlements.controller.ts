// entitlements.controller.ts — Super Admin tenant entitlement surface (under SuperAdminGuard). Reads effective limits/
// features; writes audited, permission-gated overrides; exposes the enforcement decision for a metric.
import { Controller, Get, Put, Post, Param, Body, Req, UseGuards, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { PlatformApprovals } from '../platform-approvals/platform-approvals';
import { EntitlementsService, TenantNotFoundError, EntitlementForbiddenError, type EntActor } from './entitlements.service';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { TENANT_FEATURE_BODY, TENANT_LIMIT_BODY, TENANT_USAGE_BODY } from '../request-schemas';

function actorFrom(req: any): EntActor {
  return { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] };
}
function mapError(e: any): never {
  if (e instanceof EntitlementForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
  if (e instanceof TenantNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
  throw new HttpException(e?.message || 'Invalid request', HttpStatus.BAD_REQUEST);
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/plans/tenants')
export class EntitlementsController {
  constructor(private readonly svc: EntitlementsService, @Optional() private readonly approvals?: PlatformApprovals) {}

  @Get(':tenantId/entitlements')
  async entitlements(@Param('tenantId') tenantId: string) {
    try { return await this.svc.getEntitlements(tenantId); } catch (e) { return mapError(e); }
  }

  /** Constitution 7 §119: a plan-limit override runs now, or — when the approval policy is on — waits for a second person. */
  @Put(':tenantId/limits')
  async setLimit(@Param('tenantId') tenantId: string, @Body(ValidatedBody(TENANT_LIMIT_BODY)) body: any, @Req() req: any) {
    try {
      const actor = actorFrom(req);
      if (!this.approvals) return await this.svc.setLimitOverride(tenantId, body ?? {}, actor);
      const r = await this.approvals.runOrRequest('plan.limit_override', { tenantId, input: body ?? {} }, String(body?.approvalReason ?? body?.reason ?? ''),
        { userId: actor.userId ?? null, permissions: actor.permissions ?? [] }, tenantId);
      return r.executed ? r.result : { ok: true, pendingApproval: { id: r.approvalId, expiresAt: r.expiresAt } };
    } catch (e) { return mapError(e); }
  }

  @Put(':tenantId/features')
  async setFeature(@Param('tenantId') tenantId: string, @Body(ValidatedBody(TENANT_FEATURE_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.setFeatureOverride(tenantId, body ?? {}, actorFrom(req)); } catch (e) { return mapError(e); }
  }

  @Post(':tenantId/usage')
  async recordUsage(@Param('tenantId') tenantId: string, @Body(ValidatedBody(TENANT_USAGE_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.recordUsage(tenantId, body ?? {}, actorFrom(req)); } catch (e) { return mapError(e); }
  }

  @Get(':tenantId/check/:metric')
  async check(@Param('tenantId') tenantId: string, @Param('metric') metric: string) {
    try { return await this.svc.checkLimit(tenantId, metric); } catch (e) { return mapError(e); }
  }
}
