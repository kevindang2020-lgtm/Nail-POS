// platform-advertising.controller.ts — Global Advertising + Tenant Control guide (Nov 5 2026, G7): Super Admin →
// Advertising & Customer Display. SuperAdminGuard only. The master switch needs a fresh step-up and a reason (§36);
// publishing a platform campaign never changes the switch and the switch never publishes (§35).
import { Body, Controller, Get, HttpException, Inject, Param, Post, Put, Query, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UPLOAD_POLICIES } from '@aipowersalon/media';
import { DISPLAY_AD_RULES } from '@aipowersalon/api-contracts';
import { SuperAdminGuard, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ListQuery } from '@aipowersalon/database';
import { DISPLAY_AD_ERROR_STATUS, DisplayAdError } from './display-ads-core';
import { PlatformAdvertisingService, type PlatformActor } from './platform-advertising';
import { PLATFORM_AD_POLICY_BODY, PLATFORM_AD_BODY, PLATFORM_AD_ACTION_BODY, DISPLAY_AD_MEDIA_BODY } from '../request-schemas';

export const PLATFORM_ADVERTISING = 'PlatformAdvertisingService';
const actor = (r: any): PlatformActor => ({ userId: r?.user?.id ?? r?.user?.userId ?? null, email: r?.user?.email ?? null });
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof DisplayAdError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, DISPLAY_AD_ERROR_STATUS[e.code]); throw e; }
}
const UPLOAD = FileFieldsInterceptor(
  [{ name: 'original', maxCount: 1 }, { name: 'large', maxCount: 1 }, { name: 'medium', maxCount: 1 }, { name: 'thumb', maxCount: 1 }],
  { storage: memoryStorage(), limits: { fileSize: Math.min(DISPLAY_AD_RULES.uploadHardMaxBytes, UPLOAD_POLICIES.displayAdImage.maxBytes), files: UPLOAD_POLICIES.displayAdImage.maxFiles, fields: 8, parts: 12 } },
);
const FLEET = { filters: { status: { type: 'enum', values: ['applied', 'pending', 'offline'] }, tenantId: { type: 'uuid' } }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const ADS = { filters: { status: { type: 'enum', values: ['draft', 'published', 'paused', 'archived'] } }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@Controller('super-admin/advertising')
@UseGuards(SuperAdminGuard)
export class PlatformAdvertisingController {
  constructor(@Inject(PLATFORM_ADVERTISING) private readonly svc: PlatformAdvertisingService | null) {}
  private s() { if (!this.svc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Advertising needs the database.' }, 503); return this.svc; }

  @Get('policy') policy() { return run(async () => ({ ...(await this.s().preview()), history: await this.s().history() })); }
  @Put('policy') @RequireStepUp()
  setPolicy(@Req() r: any, @Body(ValidatedBody(PLATFORM_AD_POLICY_BODY, { strict: true })) b: any) { return run(() => this.s().setPolicy(actor(r), b ?? {})); }

  @Get('fleet') @ListQuery(FLEET)
  fleet(@Query() q: any) { return run(() => this.s().fleet({ status: q?.status, tenantId: q?.tenantId, page: q?.page, pageSize: q?.pageSize })); }

  @Get('ads') @ListQuery(ADS)
  list(@Query() q: any) { return run(() => this.s().list({ status: q?.status, page: q?.page, pageSize: q?.pageSize })); }
  @Get('preview') previewPlaylist(@Query('tz') tz?: string) { return run(() => this.s().playlist(typeof tz === 'string' && /^[A-Za-z_]+\/[A-Za-z_\/]+$/.test(tz) ? tz : 'America/New_York')); }
  @Post('ads') create(@Req() r: any, @Body(ValidatedBody(PLATFORM_AD_BODY, { strict: true })) b: any) { return run(() => this.s().create(actor(r), b ?? {})); }
  @Put('ads/:id') update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PLATFORM_AD_BODY, { strict: true })) b: any) { return run(() => this.s().update(actor(r), id, b ?? {})); }
  @Post('ads/:id/:action') act(@Req() r: any, @Param('id') id: string, @Param('action') action: string, @Body(ValidatedBody(PLATFORM_AD_ACTION_BODY, { strict: true })) b: any) {
    if (!['publish', 'pause', 'archive', 'restore'].includes(action)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Unknown action.' }, 400);
    return run(() => this.s().act(actor(r), id, action as 'publish', b ?? {}));
  }
  @Post('media') @UseInterceptors(UPLOAD)
  upload(@Req() r: any, @UploadedFiles() files: any, @Body(ValidatedBody(DISPLAY_AD_MEDIA_BODY, { strict: true })) b: any) { return run(() => this.s().uploadMedia(actor(r), files, b ?? {})); }
}
