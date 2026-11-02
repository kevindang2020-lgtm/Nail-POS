// team-members-screen.controller.ts — `/pos/team-members-screen/*`, the read model behind Team Management
// (/tenant/team/members, 30 Oct 2026). TenantAuthGuard + RolePermissionGuard; tenant / branch / user from the session (never
// the query). The repository re-checks the finer permissions (contact, pay, roles & access). Read only, plus the audited CSV.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Header, HttpException, HttpStatus, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { TeamMembersScreenRepository, TM_TABS, TM_ROLES, TM_DEPTS, TM_STATUSES, TM_SHIFTS, TM_ACCOUNTS, TM_BASES, TM_SORTS, TM_EXTRAS, type DirectoryFilters } from './team-members-screen.repository';
import { teamCtx, per, PRESET } from './technicians-screen.controller';
import { requestIdOf } from './audit-rows';

export const TEAM_MEMBERS_SCREEN = 'TeamMembersScreenRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const RANGE = { dateRange: { maxDays: 3700 } } as const;
const FILTERS = { preset: PRESET, tab: { type: 'enum', values: TM_TABS }, role: { type: 'enum', values: TM_ROLES }, department: { type: 'enum', values: TM_DEPTS }, status: { type: 'enum', values: TM_STATUSES },
  shift: { type: 'enum', values: TM_SHIFTS }, account: { type: 'enum', values: TM_ACCOUNTS }, basis: { type: 'enum', values: TM_BASES }, sort: { type: 'enum', values: TM_SORTS }, extra: { type: 'enum', values: TM_EXTRAS } } as const;
const DIRECTORY = { filters: FILTERS, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, ...RANGE, params: ['page'] } as const;
const EXPORT = { filters: { ...FILTERS, lang: { type: 'enum', values: ['en', 'vi'] }, requestId: { type: 'text', maxLength: 100 } }, search: { maxLength: 100 }, maxLimit: 1, defaultLimit: 1, ...RANGE } as const;
const ATTENDANCE = { filters: { preset: PRESET }, maxLimit: 50, defaultLimit: 8, ...RANGE, params: ['page'] } as const;
const WORK = { filters: { preset: PRESET, scope: { type: 'enum', values: ['upcoming', 'past', 'services'] } }, maxLimit: 50, defaultLimit: 8, ...RANGE, params: ['page'] } as const;
const HISTORY = { maxLimit: 50, defaultLimit: 8, params: ['page'] } as const;
const dir = (q: any): DirectoryFilters => ({ q: s(q?.q), tab: s(q?.tab), staffRole: s(q?.role), status: s(q?.status), shift: s(q?.shift), department: s(q?.department), account: s(q?.account), extra: s(q?.extra),
  basis: s(q?.basis), sort: s(q?.sort), ...per(q), page: q?.page, pageSize: q?.pageSize });

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/team-members-screen')
export class TeamMembersScreenController {
  constructor(@Inject(TEAM_MEMBERS_SCREEN) private readonly repo: TeamMembersScreenRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The team screen needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('dashboard') @RequirePermission('pos.technicians.view')
  dashboard(@Req() req: any, @Query() q: any) { return this.r().dashboard(teamCtx(req), per(q)); }

  @Get('directory') @RequirePermission('pos.technicians.view') @ListQuery(DIRECTORY)
  directory(@Req() req: any, @Query() q: any) { return this.r().directory(teamCtx(req), dir(q)); }

  /** the audited directory CSV (requested → succeeded | failed; denied without the export permission) */
  @AsyncExport({ kind: 'pos.team-members-screen.export' }) @Get('export') @RequirePermission('pos.technicians.view') @ListQuery(EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Cache-Control', 'no-store')
  exportCsv(@Req() req: any, @Query() q: any) {
    return this.r().exportCsv(teamCtx(req), { ...dir(q), lang: s(q?.lang) }, requestIdOf(req, q?.requestId)).then((out) => {
      req?.res?.setHeader?.('Content-Disposition', `attachment; filename="${out.filename}"`); req?.res?.setHeader?.('X-Export-Request-Id', out.requestId);
      return out.csv;
    });
  }

  @Get('live') @RequirePermission('pos.technicians.view')
  live(@Req() req: any) { return this.r().live(teamCtx(req)); }

  @Get('members/:memberId') @RequirePermission('pos.technicians.view')
  profile(@Req() req: any, @Param('memberId') id: string) { return this.r().profile(teamCtx(req), id); }

  @Get('members/:memberId/access') @RequirePermission('pos.technicians.view')
  access(@Req() req: any, @Param('memberId') id: string) { return this.r().accessTab(teamCtx(req), id); }

  @Get('members/:memberId/schedule') @RequirePermission('pos.technicians.view')
  schedule(@Req() req: any, @Param('memberId') id: string) { return this.r().schedule(teamCtx(req), id); }

  @Get('members/:memberId/attendance') @RequirePermission('pos.technicians.view') @ListQuery(ATTENDANCE)
  attendance(@Req() req: any, @Param('memberId') id: string, @Query() q: any) { return this.r().attendance(teamCtx(req), id, { ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('members/:memberId/skills') @RequirePermission('pos.technicians.view')
  skills(@Req() req: any, @Param('memberId') id: string) { return this.r().skills(teamCtx(req), id); }

  @Get('members/:memberId/work') @RequirePermission('pos.technicians.view') @ListQuery(WORK)
  work(@Req() req: any, @Param('memberId') id: string, @Query() q: any) { return this.r().work(teamCtx(req), id, { scope: s(q?.scope), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('members/:memberId/performance') @RequirePermission('pos.technicians.view')
  performance(@Req() req: any, @Param('memberId') id: string, @Query() q: any) { return this.r().performance(teamCtx(req), id, per(q)); }

  @Get('members/:memberId/earnings') @RequirePermission('pos.technicians.view')
  earnings(@Req() req: any, @Param('memberId') id: string, @Query() q: any) { return this.r().earnings(teamCtx(req), id, per(q)); }

  @Get('members/:memberId/training') @RequirePermission('pos.technicians.view')
  training(@Req() req: any, @Param('memberId') id: string) { return this.r().training(teamCtx(req), id); }

  @Get('members/:memberId/history') @RequirePermission('pos.technicians.view') @ListQuery(HISTORY)
  history(@Req() req: any, @Param('memberId') id: string, @Query() q: any) { return this.r().history(teamCtx(req), id, { page: q?.page, pageSize: q?.pageSize }); }
}
