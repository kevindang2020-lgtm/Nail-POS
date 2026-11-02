/**
 * end-of-day-followups.pos.controller.ts — Manager/POS surface (/pos/follow-ups/*). Guarded by TenantAuthGuard +
 * RolePermissionGuard and gated on a manager-level permission (customers.edit), matching the POS moderation pattern.
 * Branch-scoped (never tech-scoped): a manager sees the whole branch queue. Supports both specs' route spellings
 * (generate-daily / generate-now, '' / 'daily').
 */
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DailyFollowUpService } from './end-of-day-followups.service';
import { FollowUpError, type FollowUpContext, type FollowUpSettings, type FollowUpStatus } from './end-of-day-followups.dto';
import { ListQueries } from '@aipowersalon/database';
import { FollowUpPosControllerListQueries } from './end-of-day-followups.pos.list-queries';
import { FOLLOWUP_MESSAGE_BODY, FOLLOWUP_SETTINGS_BODY, FOLLOWUP_SKIP_BODY } from '../request-schemas';

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

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(FollowUpPosControllerListQueries)
@Controller('pos/follow-ups')
export class FollowUpPosController {
  constructor(private readonly svc: DailyFollowUpService) {}

  @Get('') @RequirePermission('customers.edit')
  list(@Req() r: any, @Query('date') date?: string, @Query('technicianId') technicianId?: string, @Query('status') status?: string) {
    return run(() => this.svc.managerList(ctxFrom(r), { date: date || undefined, technicianId: technicianId || undefined, status: (status as FollowUpStatus | 'all') || undefined }));
  }

  @Get('daily') @RequirePermission('customers.edit')
  daily(@Req() r: any, @Query('date') date?: string, @Query('technicianId') technicianId?: string, @Query('status') status?: string) {
    return run(() => this.svc.managerList(ctxFrom(r), { date: date || undefined, technicianId: technicianId || undefined, status: (status as FollowUpStatus | 'all') || undefined }));
  }

  @Get('technicians/:technicianId') @RequirePermission('customers.edit')
  byTech(@Req() r: any, @Param('technicianId') technicianId: string, @Query('date') date?: string, @Query('status') status?: string) {
    return run(() => this.svc.managerList(ctxFrom(r), { date: date || undefined, technicianId, status: (status as FollowUpStatus | 'all') || undefined }));
  }

  @Get('settings') @RequirePermission('customers.edit')
  getSettings(@Req() r: any) { return run(() => this.svc.getSettings(ctxFrom(r))); }

  @Patch('settings') @RequirePermission('customers.edit')
  saveSettings(@Req() r: any, @Body(ValidatedBody(FOLLOWUP_SETTINGS_BODY, { strict: true })) b: Partial<FollowUpSettings>) { return run(() => this.svc.saveSettings(ctxFrom(r), b || {})); }

  @Post('generate-daily') @RequirePermission('customers.edit')
  generateDaily(@Req() r: any) { return run(() => this.svc.managerGenerateNow(ctxFrom(r))); }

  @Post('generate-now') @RequirePermission('customers.edit')
  generateNow(@Req() r: any) { return run(() => this.svc.managerGenerateNow(ctxFrom(r))); }

  @Post(':id/send') @RequirePermission('customers.edit')
  send(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(FOLLOWUP_MESSAGE_BODY, { strict: true })) b: any) { return run(() => this.svc.managerSend(ctxFrom(r), id, b?.message)); }

  @Post(':id/approve') @RequirePermission('customers.edit')
  approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(FOLLOWUP_MESSAGE_BODY, { strict: true })) b: any) { return run(() => this.svc.managerApprove(ctxFrom(r), id, b?.message)); }

  @Post(':id/skip') @RequirePermission('customers.edit')
  skip(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(FOLLOWUP_SKIP_BODY, { strict: true })) b: any) { return run(() => this.svc.managerSkip(ctxFrom(r), id, b?.reason)); }
}
