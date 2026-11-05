// deployments.controller.ts — tenant Deployment & Update Control HTTP surface (`/pos/deployments/*`).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { DeploymentsService, ForbiddenError, ValidationError, NotFoundError } from './deployments.service';
import type { DeploymentsContext, CreateDeploymentRequest, AdvanceRequest } from './deployments.dto';
import { DEPLOYMENT_ADVANCE_BODY, DEPLOYMENT_CREATE_BODY } from './request-schemas';

function ctxFrom(req: any): DeploymentsContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof NotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/deployments')
export class DeploymentsController {
  constructor(private readonly svc: DeploymentsService) {}
  @Get('') @RequirePermission('pos.deployments.view') state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }
  @Post('') @RequirePermission('pos.deployments.manage') create(@Req() r: any, @Body(ValidatedBody(DEPLOYMENT_CREATE_BODY)) b: CreateDeploymentRequest) { return run(() => this.svc.create(ctxFrom(r), b || {})); }
  @Post(':id/advance') @RequirePermission('pos.deployments.manage') advance(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DEPLOYMENT_ADVANCE_BODY)) b: AdvanceRequest) { return run(() => this.svc.advance(ctxFrom(r), id, (b?.action || '').trim())); }
}
