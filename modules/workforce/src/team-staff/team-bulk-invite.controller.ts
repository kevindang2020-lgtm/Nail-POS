// team-bulk-invite.controller.ts — extras 200-Technician Large Salon 08 (round 11, Nov 13 2026): bulk INVITE, OFF by default.
//   GET  /pos/team-bulk-invite/settings   whether it is available here, and why not (salon switch off / platform paused)
//   PUT  /pos/team-bulk-invite/settings   settings.edit — the salon turns it on / off (audited, before / after)
//   POST /pos/team-bulk-invite/preview    roles.manage (re-checked) — who would get what by which channel, who is skipped and why; writes nothing
//   POST /pos/team-bulk-invite/run        roles.manage (re-checked) + step-up (like every staff invitation, §59) — refused while off;
//                                         at most 200 people; idempotent per run key; per-person outcome; audited
// Tenant / branch / actor from the session, never the body.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { TeamBulkInviteAvailabilityResponse, TeamBulkInvitePreviewResponse, TeamBulkInviteRunResponse } from '@aipowersalon/api-contracts/tenant';
import { teamCtx } from '../team-screens/technicians-screen.controller';
import { requestIdOf } from '../team-screens/audit-rows';
import { TeamBulkInviteRepository } from './team-bulk-invite.repository';
import { TS_BULK_INVITE_PREVIEW_BODY, TS_BULK_INVITE_RUN_BODY, TS_BULK_INVITE_SETTING_BODY } from './team-staff.schemas';

export const TEAM_BULK_INVITE = 'TeamBulkInviteRepository';
const unavailable = () => new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Team management needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/team-bulk-invite')
export class TeamBulkInviteController {
  constructor(@Inject(TEAM_BULK_INVITE) private readonly repo: TeamBulkInviteRepository | null) {}
  private r() { if (!this.repo) throw unavailable(); return this.repo; }

  @Get('settings') @RequirePermission('pos.technicians.view')
  settings(@Req() req: any): Promise<TeamBulkInviteAvailabilityResponse> { return this.r().availability(teamCtx(req)); }

  @Put('settings') @RequirePermission('settings.edit')
  saveSettings(@Req() req: any, @Body(ValidatedBody(TS_BULK_INVITE_SETTING_BODY, { strict: true })) b: any): Promise<TeamBulkInviteAvailabilityResponse> { return this.r().setEnabled(teamCtx(req), b ?? {}); }

  @Post('preview') @RequirePermission('pos.technicians.view')
  preview(@Req() req: any, @Body(ValidatedBody(TS_BULK_INVITE_PREVIEW_BODY, { strict: true })) b: any): Promise<TeamBulkInvitePreviewResponse> { return this.r().preview(teamCtx(req), b ?? {}); }

  @Post('run') @RequirePermission('pos.technicians.view') @RequireStepUp()
  run(@Req() req: any, @Body(ValidatedBody(TS_BULK_INVITE_RUN_BODY, { strict: true })) b: any): Promise<TeamBulkInviteRunResponse> { return this.r().run(teamCtx(req), b ?? {}, requestIdOf(req)); }
}
