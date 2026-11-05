// team-performance-screen.controller.ts — `/pos/team-performance-screen/*`, the read model behind the rebuilt Team
// Performance page (Oct 30 2026): the three KPIs with their scale and sample, the distribution (with Unrated), the ranked
// top performers, the searchable directory, and one technician's details, services and verified reviews. Read only.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Header, Post, HttpException, HttpStatus, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { requestIdOf } from './audit-rows';
import { SCORE_SNAPSHOT_BODY } from '../request-schemas';
import { TeamPerformanceScreenRepository, PERF_SORTS, PERF_TIERS } from './team-performance-screen.repository';
import { teamCtx, per, PRESET } from './technicians-screen.controller';
import { canAny } from './screen-kit';

export const TEAM_PERFORMANCE_SCREEN = 'TeamPerformanceScreenRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const RANGE = { dateRange: { maxDays: 3700 } } as const;
const DIR = { filters: { preset: PRESET, tier: { type: 'enum', values: PERF_TIERS }, sort: { type: 'enum', values: PERF_SORTS } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, ...RANGE, params: ['page'] } as const;
const EXPORT = { filters: { preset: PRESET, tier: { type: 'enum', values: PERF_TIERS }, sort: { type: 'enum', values: PERF_SORTS }, lang: { type: 'enum', values: ['en', 'vi'] }, requestId: { type: 'text', maxLength: 100 } }, search: { maxLength: 100 }, maxLimit: 1, defaultLimit: 1, ...RANGE } as const;
const SVC = { filters: { preset: PRESET, basis: { type: 'enum', values: ['paid', 'completed'] }, role: { type: 'enum', values: ['own', 'helped'] } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 8, ...RANGE, params: ['page'] } as const;
const SUB = { filters: { preset: PRESET }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 8, ...RANGE, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/team-performance-screen')
export class TeamPerformanceScreenController {
  constructor(@Inject(TEAM_PERFORMANCE_SCREEN) private readonly repo: TeamPerformanceScreenRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The team performance screen needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('dashboard') @RequirePermission('pos.technicians.view')
  dashboard(@Req() req: any, @Query() q: any) { return this.r().dashboard(teamCtx(req), per(q)); }

  @Get('directory') @RequirePermission('pos.technicians.view') @ListQuery(DIR)
  directory(@Req() req: any, @Query() q: any) { return this.r().directory(teamCtx(req), { q: s(q?.q), tier: s(q?.tier), sort: s(q?.sort), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('technicians/:id') @RequirePermission('pos.technicians.view')
  technician(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().technician(teamCtx(req), id, per(q)); }

  @Get('technicians/:id/services') @RequirePermission('pos.technicians.view') @ListQuery(SVC)
  services(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().services(teamCtx(req), id, { q: s(q?.q), basis: s(q?.basis), role: s(q?.role), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('technicians/:id/reviews') @RequirePermission('pos.technicians.view') @ListQuery(SUB)
  reviews(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().reviews(teamCtx(req), id, { ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  /** F3: the audited directory CSV (see commission-screen.controller exportCsv) */
  @AsyncExport({ kind: 'pos.team-performance-screen.export' }) @Get('export') @RequirePermission('pos.technicians.view') @ListQuery(EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Cache-Control', 'no-store')
  exportCsv(@Req() req: any, @Query() q: any) {
    // D1 gaps (Nov 5 2026): the export is role-checked — viewing the screen is not enough, it needs reports.export
    if (!canAny(teamCtx(req), 'reports.export')) throw new HttpException({ code: 'EXPORT_NOT_ALLOWED', message: 'You do not have permission to export this report.' }, HttpStatus.FORBIDDEN);
    return this.r().exportCsv(teamCtx(req), { q: s(q?.q), tier: s(q?.tier), sort: s(q?.sort), lang: s(q?.lang), ...per(q) }, requestIdOf(req, q?.requestId)).then((out) => {
      req?.res?.setHeader?.('Content-Disposition', `attachment; filename="${out.filename}"`); req?.res?.setHeader?.('X-Export-Request-Id', out.requestId);
      return out.csv;
    });
  }


  /** F5: one technician's versioned 0–100 composite (separate from the 0–5 rating), components, samples, model, snapshots */
  @Get('technicians/:id/composite') @RequirePermission('pos.technicians.view')
  composite(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().composite(teamCtx(req), id, per(q)); }

  /** F5 comparison mode: the rating ranking beside the composite (nothing is re-ranked) */
  @Get('composite/comparison') @RequirePermission('pos.technicians.view') @ListQuery(SUB)
  comparison(@Req() req: any, @Query() q: any) { return this.r().compositeComparison(teamCtx(req), { ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  /** F5: save the current composite as an append-only snapshot */
  @Post('composite/snapshots') @RequirePermission('pos.technicians.view')
  snapshot(@Req() req: any, @Body(ValidatedBody(SCORE_SNAPSHOT_BODY, { strict: true })) b: any) { return this.r().saveScoreSnapshot(teamCtx(req), b ?? {}); }
}
