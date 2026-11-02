// ai-admin.controller.ts — SuperAdminGuard routes under super-admin/ai (no collision with super-admin/platform/ai-packages*).
import { Body, Controller, Delete, Get, NotFoundException, BadRequestException, ConflictException, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AiAdminService, AiAdminError, type AdminCtx } from './ai-admin.service';
import { isAiPackageCode } from '@aipowersalon/ai';
import { AI_SUB_ASSIGN_BODY, AI_SUB_UPDATE_BODY, AI_PACKAGE_AVAILABILITY_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId ?? req?.user?.id, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof AiAdminError) { if (e.code === 'not_found') throw new NotFoundException(e.message); if (e.message === 'version_conflict') throw new ConflictException(e.message); throw new BadRequestException(e.message); }
    throw e;
  }
}

@Controller('super-admin/ai')
@UseGuards(SuperAdminGuard)
export class AiAdminController {
  constructor(private readonly svc: AiAdminService) {}

  @Get('packages') packages() { return run(() => this.svc.catalog()); }
  @Get('packages/:code/tenants') tenants(@Param('code') code: string) {
    if (!isAiPackageCode(code)) throw new NotFoundException('unknown_ai_package');
    return run(() => this.svc.packageTenants(code));
  }
  @Get('usage/summary') usage() { return run(() => this.svc.usageSummary()); }
  /** AI Usage & Limits guide: the global per-package availability switch (every salon at once; audited) */
  @Get('package-availability') availability() { return run(() => this.svc.packageAvailability()); }
  @Put('packages/:code/availability') setAvailability(@Req() r: any, @Param('code') code: string, @Body(ValidatedBody(AI_PACKAGE_AVAILABILITY_BODY, { strict: true })) b: any) {
    if (!isAiPackageCode(code)) throw new NotFoundException('unknown_ai_package');
    return run(() => this.svc.setPackageAvailability(ctxFrom(r), code, b || {}));
  }
  @Get('usage/stats') usageStats() { return run(() => this.svc.usageStats()); }

  @Post('tenants/:tenantId/subscriptions') assign(@Req() r: any, @Param('tenantId') tid: string, @Body(ValidatedBody(AI_SUB_ASSIGN_BODY, { strict: true })) b: any) {
    return run(() => this.svc.assign(ctxFrom(r), tid, b || {}));
  }
  @Patch('tenants/:tenantId/subscriptions/:code') update(@Req() r: any, @Param('tenantId') tid: string, @Param('code') code: string, @Body(ValidatedBody(AI_SUB_UPDATE_BODY, { strict: true })) b: any) {
    if (!isAiPackageCode(code)) throw new NotFoundException('unknown_ai_package');
    return run(() => this.svc.update(ctxFrom(r), tid, code, b || {}));
  }
  @Delete('tenants/:tenantId/subscriptions/:code') cancel(@Req() r: any, @Param('tenantId') tid: string, @Param('code') code: string) {
    if (!isAiPackageCode(code)) throw new NotFoundException('unknown_ai_package');
    return run(() => this.svc.cancel(ctxFrom(r), tid, code));
  }
}
