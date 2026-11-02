// team-birthdays.controller.ts — TM-08 optional birthdays (Four-Module Completion Guide §10.3, 30 Oct 2026).
//   GET /pos/team-birthdays/upcoming?days=30          what this viewer may see (private ones: managers / the member only)
//   GET /pos/team-birthdays/members/:memberId         month/day or hidden
//   PUT /pos/team-birthdays/members/:memberId         staff-profile manager, or the member themself (self.profile.edit)
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { teamCtx } from '../team-screens/technicians-screen.controller';
import { requestIdOf } from '../team-screens/audit-rows';
import { TeamBirthdaysRepository } from './team-birthdays.repository';
import { TS_BIRTHDAY_BODY } from './team-staff.schemas';

export const TEAM_BIRTHDAYS = 'TeamBirthdaysRepository';
const UPCOMING = { filters: { days: { type: 'enum', values: ['7', '14', '30', '60', '90'] } }, maxLimit: 20, defaultLimit: 20 } as const;
const unavailable = () => new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Team management needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/team-birthdays')
export class TeamBirthdaysController {
  constructor(@Inject(TEAM_BIRTHDAYS) private readonly repo: TeamBirthdaysRepository | null) {}
  private r() { if (!this.repo) throw unavailable(); return this.repo; }
  @Get('upcoming') @RequirePermission('pos.technicians.view') @ListQuery(UPCOMING)
  upcoming(@Req() req: any, @Query() q: any) { return this.r().upcoming(teamCtx(req), { days: q?.days }); }
  @Get('members/:memberId') @RequirePermission('pos.technicians.view')
  get(@Req() req: any, @Param('memberId') id: string) { return this.r().get(teamCtx(req), id); }
  @Put('members/:memberId') @RequirePermission('pos.technicians.view')
  set(@Req() req: any, @Param('memberId') id: string, @Body(ValidatedBody(TS_BIRTHDAY_BODY, { strict: true })) b: any) { return this.r().set(teamCtx(req), id, b ?? {}, requestIdOf(req)); }
}
