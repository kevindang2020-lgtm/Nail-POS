import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
/**
 * end-of-day-followups.tech.controller.ts — Technician surface (/tech/follow-ups/*). Thin: derives ctx from the session
 * (req.ctx; the global guard populates tenant/branch/user/role), calls DailyFollowUpService, and maps FollowUpError →
 * HTTP. technicianId is resolved server-side from the session inside the service; the frontend never sends it. Static
 * routes ('today', 'templates') are declared before ':id' so they don't get captured as ids.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { DailyFollowUpService } from './end-of-day-followups.service';
import { FollowUpError, type FollowUpContext, type FollowUpStatus } from './end-of-day-followups.dto';
import { ListQueries } from '@aipowersalon/database';
import { FollowUpTechControllerListQueries } from './end-of-day-followups.tech.list-queries';
import { FOLLOWUP_MESSAGE_BODY, FOLLOWUP_PREVIEW_BODY, FOLLOWUP_SKIP_BODY } from '../request-schemas';

function ctxFrom(req: any): FollowUpContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof FollowUpError) {
      if (e.code === 'forbidden' || e.code === 'not_technician') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@ListQueries(FollowUpTechControllerListQueries)
@Controller('tech/follow-ups')
export class FollowUpTechController {
  constructor(private readonly svc: DailyFollowUpService) {}

  @RequirePermission('tech.dashboard.view') @Get('')
  list(@Req() r: any, @Query('date') date?: string, @Query('status') status?: string) {
    return run(() => this.svc.techList(ctxFrom(r), { date: date || undefined, status: (status as FollowUpStatus | 'all') || undefined }));
  }

  @RequirePermission('tech.dashboard.view') @Get('today')
  today(@Req() r: any, @Query('status') status?: string) {
    return run(() => this.svc.techList(ctxFrom(r), { status: (status as FollowUpStatus | 'all') || undefined }));
  }

  @RequirePermission('tech.dashboard.view') @Get('templates')
  templates() { return this.svc.templates(); }

  @RequirePermission('tech.dashboard.view') @Get(':id')
  get(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.techGet(ctxFrom(r), id)); }

  @RequirePermission('tech.followups.manage') @Post(':id/custom-message-preview')
  preview(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(FOLLOWUP_PREVIEW_BODY)) b: any) {
    return run(() => this.svc.previewMessage(ctxFrom(r), id, b?.templateKey ?? null));
  }

  @RequirePermission('tech.followups.manage') @Post(':id/send')
  send(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(FOLLOWUP_MESSAGE_BODY)) b: any) { return run(() => this.svc.techSend(ctxFrom(r), id, b?.message)); }

  @RequirePermission('tech.followups.manage') @Post(':id/skip')
  skip(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(FOLLOWUP_SKIP_BODY)) b: any) { return run(() => this.svc.techSkip(ctxFrom(r), id, b?.reason)); }

  @RequirePermission('tech.followups.manage') @Post(':id/dismiss')
  dismiss(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.techDismiss(ctxFrom(r), id)); }

  @RequirePermission('tech.followups.manage') @Patch(':id/message')
  editMessage(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(FOLLOWUP_MESSAGE_BODY)) b: any) { return run(() => this.svc.techEditMessage(ctxFrom(r), id, b?.message ?? '')); }
}
