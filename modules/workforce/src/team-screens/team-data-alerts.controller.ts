// team-data-alerts.controller.ts — `/pos/team-data-alerts/*` (Team Management Data Accuracy Alerts, 30 Oct 2026). Tenant
// and branch come from the session (never the body); the repository re-checks the review permission (403, audited), the
// state machine (422), expectedVersion (409) and the tenant (404). Workflow only — no route here changes a shift, a status,
// a mapping, a link, payroll or a commission.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TeamDataAlertsRepository, ALERT_STATUSES, ALERT_TYPES, type AlertAction } from './team-data-alerts.repository';
import { teamCtx } from './technicians-screen.controller';
import { requestIdOf } from './audit-rows';
import { TDA_ASSIGN_BODY, TDA_INVESTIGATE_BODY, TDA_NOTE_BODY, TDA_REASON_BODY, TDA_RESOLVE_BODY, TDA_RUN_BODY } from '../request-schemas';

export const TEAM_DATA_ALERTS = 'TeamDataAlertsRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const LIST = { filters: { status: { type: 'enum', values: [...ALERT_STATUSES, 'open_all', 'all'] }, type: { type: 'enum', values: ALERT_TYPES }, severity: { type: 'enum', values: ['low', 'medium', 'high'] },
  memberId: { type: 'uuid' } }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 6, params: ['page'] } as const;
const DETAIL = { maxLimit: 50, defaultLimit: 6, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/team-data-alerts')
export class TeamDataAlertsController {
  constructor(@Inject(TEAM_DATA_ALERTS) private readonly repo: TeamDataAlertsRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Team data alerts need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('') @RequirePermission('pos.technicians.view') @ListQuery(LIST)
  list(@Req() req: any, @Query() q: any) { return this.r().list(teamCtx(req), { status: s(q?.status), type: s(q?.type), severity: s(q?.severity), memberId: s(q?.memberId), q: s(q?.q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('assignees') @RequirePermission('pos.technicians.view')
  assignees(@Req() req: any, @Query('q') q?: string) { return this.r().assignees(teamCtx(req), s(q)); }

  @Post('run-check') @RequirePermission('pos.technicians.view')
  run(@Req() req: any, @Body(ValidatedBody(TDA_RUN_BODY, { strict: true })) _b: any) { return this.r().runCheck(teamCtx(req), requestIdOf(req)); }

  @Get(':id') @RequirePermission('pos.technicians.view') @ListQuery(DETAIL)
  detail(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().detail(teamCtx(req), id, { page: q?.page, pageSize: q?.pageSize }); }

  @Post(':id/assign') @RequirePermission('pos.technicians.view')
  assign(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TDA_ASSIGN_BODY, { strict: true })) b: any) { return this.act(req, id, 'assign', b); }
  @Post(':id/investigate') @RequirePermission('pos.technicians.view')
  investigate(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TDA_INVESTIGATE_BODY, { strict: true })) b: any) { return this.act(req, id, 'investigate', b); }
  @Post(':id/notes') @RequirePermission('pos.technicians.view')
  note(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TDA_NOTE_BODY, { strict: true })) b: any) { return this.act(req, id, 'note', b); }
  @Post(':id/resolve') @RequirePermission('pos.technicians.view')
  resolve(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TDA_RESOLVE_BODY, { strict: true })) b: any) { return this.act(req, id, 'resolve', b); }
  @Post(':id/dismiss') @RequirePermission('pos.technicians.view')
  dismiss(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TDA_REASON_BODY, { strict: true })) b: any) { return this.act(req, id, 'dismiss', b); }
  @Post(':id/reopen') @RequirePermission('pos.technicians.view')
  reopen(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TDA_REASON_BODY, { strict: true })) b: any) { return this.act(req, id, 'reopen', b); }

  private act(req: any, id: string, a: AlertAction, b: any) { return this.r().act(teamCtx(req), id, a, b ?? {}, requestIdOf(req)); }
}
