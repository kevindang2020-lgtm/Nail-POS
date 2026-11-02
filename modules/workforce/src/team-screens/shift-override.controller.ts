// shift-override.controller.ts — `/pos/shift-overrides/*` (F4, Finish the Five, 30 Oct 2026): Edit Shift for Selected
// Date on the Live Technician Schedule. Tenant / branch from the session; the repository re-checks permission, the date,
// the version (409), every conflict (409 until acknowledged) and writes the override + history + audit + outbox event in
// one transaction. The weekly template is never written here.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ShiftOverrideRepository } from './shift-override.repository';
import { teamCtx } from './technicians-screen.controller';
import { requestIdOf } from './audit-rows';
import { SHIFT_OVERRIDE_BODY } from '../request-schemas';

export const SHIFT_OVERRIDES = 'ShiftOverrideRepository';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/shift-overrides')
export class ShiftOverrideController {
  constructor(@Inject(SHIFT_OVERRIDES) private readonly repo: ShiftOverrideRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Date shifts need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('') @RequirePermission('pos.technicians.view')
  editor(@Req() req: any, @Query('technicianId') technicianId?: string, @Query('date') date?: string) { return this.r().editor(teamCtx(req), { technicianId, date }); }

  @Post('preview') @RequirePermission('pos.technicians.view')
  preview(@Req() req: any, @Body(ValidatedBody(SHIFT_OVERRIDE_BODY, { strict: true })) b: any) { return this.r().preview(teamCtx(req), b ?? {}); }

  @Put('') @RequirePermission('pos.technicians.schedule.edit')
  save(@Req() req: any, @Body(ValidatedBody(SHIFT_OVERRIDE_BODY, { strict: true })) b: any) { return this.r().save(teamCtx(req), b ?? {}, requestIdOf(req)); }
}
