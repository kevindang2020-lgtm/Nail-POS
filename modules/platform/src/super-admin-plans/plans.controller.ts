// plans.controller.ts — Super Admin → Plans & Feature Limits HTTP surface. Behind SuperAdminGuard (role gate); each
// mutation additionally requires super_admin.subscriptions.manage, enforced in the service. Errors map to precise codes.
import { Controller, Get, Post, Patch, Put, Param, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminPlansService, PlanNotFoundError, PlanConflictError, PlanForbiddenError, type PlansActor } from './plans.service';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CREATE_PLAN_BODY, PLAN_LIMITS_BODY, PLAN_PRICING_BODY, UPDATE_PLAN_BODY } from '../request-schemas';

function actorFrom(req: any): PlansActor {
  return { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] };
}
function mapError(e: any): never {
  if (e instanceof PlanForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
  if (e instanceof PlanNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
  if (e instanceof PlanConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
  throw new HttpException(e?.message || 'Invalid request', HttpStatus.BAD_REQUEST);
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/plans')
export class SuperAdminPlansController {
  constructor(private readonly svc: SuperAdminPlansService) {}

  @Get('overview')
  overview() { return this.svc.getOverview(); }

  @Post()
  async create(@Body(ValidatedBody(CREATE_PLAN_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.createPlan(body ?? {}, actorFrom(req)); } catch (e) { return mapError(e); }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body(ValidatedBody(UPDATE_PLAN_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.updatePlanDetails(id, body ?? {}, actorFrom(req)); } catch (e) { return mapError(e); }
  }

  @Post(':id/pricing')
  async changePricing(@Param('id') id: string, @Body(ValidatedBody(PLAN_PRICING_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.changePricing(id, body ?? {}, actorFrom(req)); } catch (e) { return mapError(e); }
  }

  @Put(':id/limits')
  async updateLimits(@Param('id') id: string, @Body(ValidatedBody(PLAN_LIMITS_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.updatePlanLimits(id, body ?? {}, actorFrom(req)); } catch (e) { return mapError(e); }
  }

  @Get(':id/versions')
  async versions(@Param('id') id: string) {
    try { return await this.svc.listVersions(id); } catch (e) { return mapError(e); }
  }
}
