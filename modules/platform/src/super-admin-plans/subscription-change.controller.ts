// subscription-change.controller.ts — Super Admin tenant plan-change surface (under SuperAdminGuard). Preview is a
// read-only computation; commit is permission-gated in the service and audited.
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SubscriptionChangeService, ChangeForbiddenError, ChangeNotFoundError, ChangeValidationError, type ChangeActor } from './subscription-change.service';
import type { Strategy } from './proration-core';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { SUBSCRIPTION_CHANGE_BODY, SUBSCRIPTION_PREVIEW_BODY } from '../request-schemas';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/plans/tenants/:tenantId/subscription')
export class SubscriptionChangeController {
  constructor(private readonly svc: SubscriptionChangeService) {}

  private wrap(e: any): never {
    if (e instanceof ChangeForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ChangeNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    if (e instanceof ChangeValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Change failed', HttpStatus.BAD_REQUEST);
  }

  @Get()
  async current(@Param('tenantId') tenantId: string) {
    try { return await this.svc.getSubscription(tenantId); } catch (e) { this.wrap(e); }
  }

  @Post('preview')
  async preview(@Param('tenantId') tenantId: string, @Body(ValidatedBody(SUBSCRIPTION_PREVIEW_BODY)) body: any) {
    try { return await this.svc.preview(tenantId, String(body?.toPlanCode || ''), (body?.strategy || 'immediate') as Strategy); }
    catch (e) { this.wrap(e); }
  }

  @Post('change')
  async change(@Param('tenantId') tenantId: string, @Body(ValidatedBody(SUBSCRIPTION_CHANGE_BODY)) body: any, @Req() req: any) {
    const actor: ChangeActor = { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] };
    try { return await this.svc.commit(actor, tenantId, String(body?.toPlanCode || ''), (body?.strategy || 'immediate') as Strategy, body?.reason ?? null); }
    catch (e) { this.wrap(e); }
  }

  @Get('changes')
  async changes(@Param('tenantId') tenantId: string) {
    try { return await this.svc.listChanges(tenantId); } catch (e) { this.wrap(e); }
  }
}
