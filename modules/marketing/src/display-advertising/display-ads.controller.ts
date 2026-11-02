// display-ads.controller.ts — POS → Marketing & Growth → Customer Display Advertising (23-inch dual-screen spec §48–§76,
// §109–§111). Guards: TenantAuthGuard + RolePermissionGuard; tenant, branch and user come from the session (req.ctx).
// §75 permissions: pos.customer_display_ads.view|create|update|publish|pause|archive (granular keys that resolve to the
// marketing capability — owners and managers; a branch manager is further limited to their branch in the service).
import { UPLOAD_POLICIES } from '@aipowersalon/media';
import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DISPLAY_AD_RULES } from '@aipowersalon/api-contracts';
import { RequirePermission, RolePermissionGuard, TenantAuthGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { DISPLAY_AD_ACTION_BODY, DISPLAY_AD_CREATE_BODY, DISPLAY_AD_MEDIA_BODY, DISPLAY_AD_UPDATE_BODY, DISPLAY_ADS_DEVICE_BODY, DISPLAY_ADS_SETTINGS_BODY } from '../request-schemas';
import { DISPLAY_AD_ERROR_STATUS, DisplayAdError } from './display-ads-core';
import { DisplayAdsService, type AdsCtx } from './display-ads.service';
import { ListQueries } from '@aipowersalon/database';
import { DisplayAdsControllerListQueries } from './display-ads.list-queries';

function ctxFrom(req: any): AdsCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId ?? '', role: c.role ?? '', permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof DisplayAdError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, DISPLAY_AD_ERROR_STATUS[e.code]);
    throw e;
  }
}
const UPLOAD = FileFieldsInterceptor(
  [{ name: 'original', maxCount: 1 }, { name: 'large', maxCount: 1 }, { name: 'medium', maxCount: 1 }, { name: 'thumb', maxCount: 1 }],
  { storage: memoryStorage(), limits: { fileSize: Math.min(DISPLAY_AD_RULES.uploadHardMaxBytes, UPLOAD_POLICIES.displayAdImage.maxBytes), files: UPLOAD_POLICIES.displayAdImage.maxFiles, fields: 8, parts: 12 } },   // Phase 12 (#34)
);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(DisplayAdsControllerListQueries)
@Controller('pos/marketing/display-ads')
export class DisplayAdsController {
  constructor(private readonly svc: DisplayAdsService) {}

  @Get('state') @RequirePermission('pos.customer_display_ads.view')
  state(@Req() r: any) { return run(() => this.svc.state(ctxFrom(r))); }

  // A branch is always a PATH parameter here: the API strips tenantId/branchId from every body and query string (the
  // session decides them); the service then authorizes the named branch for this user (owner: any; manager: their own).
  @Get('branches/:branchId/playlist') @RequirePermission('pos.customer_display_ads.view')
  playlist(@Req() r: any, @Param('branchId') branchId: string) { return run(() => this.svc.playlist(ctxFrom(r), branchId)); }

  @Get('analytics') @RequirePermission('pos.customer_display_ads.view')
  analytics(@Req() r: any, @Query('days') days?: string) { return run(() => this.svc.analytics(ctxFrom(r), days, undefined)); }

  @Get('branches/:branchId/analytics') @RequirePermission('pos.customer_display_ads.view')
  branchAnalytics(@Req() r: any, @Param('branchId') branchId: string, @Query('days') days?: string) { return run(() => this.svc.analytics(ctxFrom(r), days, branchId)); }

  @Post('media') @RequirePermission('pos.customer_display_ads.create') @UseInterceptors(UPLOAD)
  upload(@Req() r: any, @UploadedFiles() files: any, @Body(ValidatedBody(DISPLAY_AD_MEDIA_BODY, { strict: true })) b: any) { return run(() => this.svc.uploadMedia(ctxFrom(r), files, b)); }

  @Patch('settings') @RequirePermission('pos.customer_display_ads.update')
  settings(@Req() r: any, @Body(ValidatedBody(DISPLAY_ADS_SETTINGS_BODY, { strict: true })) b: any) { return run(() => this.svc.saveSettings(ctxFrom(r), null, b)); }

  @Patch('branches/:branchId/settings') @RequirePermission('pos.customer_display_ads.update')
  branchSettings(@Req() r: any, @Param('branchId') branchId: string, @Body(ValidatedBody(DISPLAY_ADS_SETTINGS_BODY, { strict: true })) b: any) { return run(() => this.svc.saveSettings(ctxFrom(r), branchId, b)); }

  @Patch('devices/:deviceId') @RequirePermission('pos.customer_display_ads.update')
  device(@Req() r: any, @Param('deviceId') deviceId: string, @Body(ValidatedBody(DISPLAY_ADS_DEVICE_BODY, { strict: true })) b: any) { return run(() => this.svc.setDevice(ctxFrom(r), deviceId, b)); }

  @Get(':id') @RequirePermission('pos.customer_display_ads.view')
  get(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.get(ctxFrom(r), id)); }

  @Post() @RequirePermission('pos.customer_display_ads.create')
  create(@Req() r: any, @Body(ValidatedBody(DISPLAY_AD_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.create(ctxFrom(r), b)); }

  @Patch(':id') @RequirePermission('pos.customer_display_ads.update')
  update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DISPLAY_AD_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.update(ctxFrom(r), id, b)); }

  @Post(':id/publish') @RequirePermission('pos.customer_display_ads.publish')
  publish(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DISPLAY_AD_ACTION_BODY, { strict: true })) b: any) { return run(() => this.svc.act(ctxFrom(r), id, 'publish', b)); }

  @Post(':id/pause') @RequirePermission('pos.customer_display_ads.pause')
  pause(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DISPLAY_AD_ACTION_BODY, { strict: true })) b: any) { return run(() => this.svc.act(ctxFrom(r), id, 'pause', b)); }

  @Post(':id/archive') @RequirePermission('pos.customer_display_ads.archive')
  archive(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DISPLAY_AD_ACTION_BODY, { strict: true })) b: any) { return run(() => this.svc.act(ctxFrom(r), id, 'archive', b)); }

  @Post(':id/restore') @RequirePermission('pos.customer_display_ads.update')
  restore(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DISPLAY_AD_ACTION_BODY, { strict: true })) b: any) { return run(() => this.svc.act(ctxFrom(r), id, 'restore', b)); }

  @Delete(':id') @RequirePermission('pos.customer_display_ads.archive')
  remove(@Req() r: any, @Param('id') id: string, @Query('version') version?: string) { return run(() => this.svc.remove(ctxFrom(r), id, version)); }
}
