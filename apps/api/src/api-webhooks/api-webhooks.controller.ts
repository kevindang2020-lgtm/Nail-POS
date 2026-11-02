// api-webhooks.controller.ts — HTTP surface for tenant API keys (`/pos/api-keys/*`) and webhooks (`/pos/webhooks/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/role from req.ctx (session) — never the body. Secret-minting
// routes additionally require OWNER (enforced in the service). Raw secrets appear only in create/rotate responses.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ApiWebhooksService, ForbiddenError, ValidationError, NotFoundError } from './api-webhooks.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import type { ApiWebhooksContext, CreateApiKeyRequest, CreateWebhookRequest } from './api-webhooks.dto';
import { API_KEY_CREATE_BODY, WEBHOOK_CREATE_BODY } from './request-schemas';

function ctxFrom(req: any): ApiWebhooksContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof NotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/api-keys')
export class ApiKeysController {
  constructor(private readonly svc: ApiWebhooksService) {}
  @Get('') @RequirePermission('pos.api_keys.view') list(@Req() r: any) { return run(() => this.svc.listKeys(ctxFrom(r))); }
  // Security Deep Scan C7: server-enforced step-up
  @RequireStepUp() @Post('') @RequirePermission('pos.api_keys.manage') create(@Req() r: any, @Body(ValidatedBody(API_KEY_CREATE_BODY, { strict: true })) b: CreateApiKeyRequest) { return run(() => this.svc.createKey(ctxFrom(r), b || {})); }
  @RequireStepUp() @Post(':id/rotate') @RequirePermission('pos.api_keys.manage') rotate(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.rotateKey(ctxFrom(r), id)); }
  @Post(':id/revoke') @RequirePermission('pos.api_keys.manage') revoke(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.revokeKey(ctxFrom(r), id)); }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/webhooks')
export class WebhooksController {
  constructor(private readonly svc: ApiWebhooksService, private readonly dispatch: WebhookDispatchService) {}
  @Get('') @RequirePermission('pos.webhooks.view') list(@Req() r: any) { return run(() => this.svc.listWebhooks(ctxFrom(r))); }
  @Get(':id/deliveries') @RequirePermission('pos.webhooks.view') deliveries(@Req() r: any, @Param('id') id: string) { return run(() => this.dispatch.listDeliveries(ctxFrom(r), id)); }
  @Post('process') @RequirePermission('pos.webhooks.manage') process(@Req() r: any) { return run(() => this.dispatch.processDue(ctxFrom(r))); }
  // Security Deep Scan C7: server-enforced step-up
  @RequireStepUp() @Post('') @RequirePermission('pos.webhooks.manage') create(@Req() r: any, @Body(ValidatedBody(WEBHOOK_CREATE_BODY, { strict: true })) b: CreateWebhookRequest) { return run(() => this.svc.createWebhook(ctxFrom(r), b || {})); }
  @Post(':id/pause') @RequirePermission('pos.webhooks.manage') pause(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.pauseWebhook(ctxFrom(r), id)); }
  @Post(':id/resume') @RequirePermission('pos.webhooks.manage') resume(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.resumeWebhook(ctxFrom(r), id)); }
  @Post(':id/disable') @RequirePermission('pos.webhooks.manage') disable(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.disableWebhook(ctxFrom(r), id)); }
  @RequireStepUp() @Post(':id/rotate-secret') @RequirePermission('pos.webhooks.manage') rotateSecret(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.rotateWebhookSecret(ctxFrom(r), id)); }
  @Post(':id/test') @RequirePermission('pos.webhooks.manage') test(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.testWebhook(ctxFrom(r), id)); }
}
