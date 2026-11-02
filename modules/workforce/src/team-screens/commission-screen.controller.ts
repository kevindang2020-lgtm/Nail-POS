// commission-screen.controller.ts — `/pos/commission-screen/*`, the read model behind the rebuilt Commission Report (Oct 30
// 2026): the five KPIs, Payout by Technician (paged / sorted / searched), a technician's service lines, tips, adjustments,
// recorded payouts, and (F3) the audited CSV export + its history. The Discrepancy Review moved to the persisted
// /pos/commission-discrepancies/* (F1, commission-review.controller.ts). Read only; pay data needs a pay / reports permission.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Header, HttpException, HttpStatus, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { requestIdOf } from './audit-rows';
import { CommissionScreenRepository, COMM_SORTS } from './commission-screen.repository';
import { teamCtx, per, PRESET } from './technicians-screen.controller';

export const COMMISSION_SCREEN = 'CommissionScreenRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const RANGE = { dateRange: { maxDays: 3700 } } as const;
const TECHS = { filters: { preset: PRESET, sort: { type: 'enum', values: COMM_SORTS } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, ...RANGE, params: ['page'] } as const;
const DETAIL = { filters: { preset: PRESET }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, ...RANGE, params: ['page'] } as const;
const PAYOUTS = { filters: { preset: PRESET, technicianId: { type: 'uuid' } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 8, ...RANGE, params: ['page'] } as const;
const EXPORT = { filters: { preset: PRESET, sort: { type: 'enum', values: COMM_SORTS }, lang: { type: 'enum', values: ['en', 'vi'] }, requestId: { type: 'text', maxLength: 100 } }, search: { maxLength: 100 }, maxLimit: 1, defaultLimit: 1, ...RANGE } as const;
const HISTORY = { filters: { type: { type: 'enum', values: ['COMMISSION', 'TEAM_PERFORMANCE'] } }, maxLimit: 50, defaultLimit: 8, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/commission-screen')
export class CommissionScreenController {
  constructor(@Inject(COMMISSION_SCREEN) private readonly repo: CommissionScreenRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The commission report needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('summary') @RequirePermission('pos.reports.view')
  summary(@Req() req: any, @Query() q: any) { return this.r().summary(teamCtx(req), per(q)); }

  @Get('technicians') @RequirePermission('pos.reports.view') @ListQuery(TECHS)
  technicians(@Req() req: any, @Query() q: any) { return this.r().technicians(teamCtx(req), { q: s(q?.q), sort: s(q?.sort), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('technicians/:id/lines') @RequirePermission('pos.reports.view') @ListQuery(DETAIL)
  lines(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().lines(teamCtx(req), id, { q: s(q?.q), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('technicians/:id/tips') @RequirePermission('pos.reports.view') @ListQuery(DETAIL)
  tips(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().tips(teamCtx(req), id, { ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('technicians/:id/adjustments') @RequirePermission('pos.reports.view') @ListQuery(DETAIL)
  adjustments(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().adjustments(teamCtx(req), id, { ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('payouts') @RequirePermission('pos.reports.view') @ListQuery(PAYOUTS)
  payouts(@Req() req: any, @Query() q: any) { return this.r().payouts(teamCtx(req), { technicianId: s(q?.technicianId), q: s(q?.q), ...per(q), page: q?.page, pageSize: q?.pageSize }); }


  /** F3: the audited CSV. requested → (rows) → succeeded | failed; denied without the export permission; 503 when the
   *  audit row cannot be written (fail closed). The body is the CSV; the file name is in Content-Disposition. */
  @AsyncExport({ kind: 'pos.commission-screen.export' }) @Get('export') @RequirePermission('pos.reports.view') @ListQuery(EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Cache-Control', 'no-store')
  exportCsv(@Req() req: any, @Query() q: any) {
    return this.r().exportCsv(teamCtx(req), { q: s(q?.q), sort: s(q?.sort), lang: s(q?.lang), ...per(q) }, requestIdOf(req, q?.requestId)).then((out) => {
      req?.res?.setHeader?.('Content-Disposition', `attachment; filename="${out.filename}"`); req?.res?.setHeader?.('X-Export-Request-Id', out.requestId);
      return out.csv;
    });
  }


  /** F3: report-export history (owners / managers: the salon's; anyone else: their own attempts only) */
  @Get('export-history') @RequirePermission('pos.reports.view') @ListQuery(HISTORY)
  exportHistory(@Req() req: any, @Query() q: any) { return this.r().exportHistory(teamCtx(req), { type: s(q?.type), page: q?.page, pageSize: q?.pageSize }); }
}
