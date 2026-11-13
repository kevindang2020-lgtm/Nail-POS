// tips-screen.controller.ts — Tips & Gratuity mandate (Oct 29 2026): the READ side of POS Payments → Tips
// (/tenant/payments/tips). Guards: TenantAuthGuard + RolePermissionGuard; tenant / location / role from the session.
//   reads   pos.reports.view     summary · transactions · distribution · technicians · adjustments · :ticketId/detail
//   export  pos.reports.export   export (CSV, masked contact, audited)
// The ONE write — a reasoned per-technician re-allocation / correction of a paid ticket's tip — stays on its existing
// audited route: POST /pos/tickets/:id/tip-allocation (tips.adjust, modules/workforce). Nothing here moves money.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Query, Req, Header, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { TipsScreenRepository, DIST_SORTS, tipsPageReq } from './tips-screen.repository';
import { pageReq, oneOf } from './finance-scope';
import { financeCtx, needPermission, runFinance } from './settlements-screen.controller';
import type { TipsTechnicianEarningsResponse, TipsAccuracyResponse } from '@aipowersalon/api-contracts/tenant';

export const TIPS_SCREEN_REPOSITORY = 'TipsScreenRepository';

const TIP_LIST = {
  filters: {
    status: { type: 'enum', values: ['tipped', 'no_tip', 'unallocated', 'partial', 'mismatch', 'reversed', 'paid_out', 'pending_payout'] },
    method: { type: 'enum', values: ['card', 'cash', 'split'] },
    dateField: { type: 'enum', values: ['collected', 'checkout', 'allocation', 'adjustment', 'payout'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
    technicianId: { type: 'text', maxLength: 64 }, minAmount: { type: 'text', maxLength: 12 }, maxAmount: { type: 'text', maxLength: 12 },
  },
  sorts: { collected_desc: null, collected_asc: null, amount_desc: null, amount_asc: null, ticket_desc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 100, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const DIST_LIST = { filters: { dateField: { type: 'enum', values: ['collected', 'checkout', 'allocation', 'adjustment', 'payout'] }, preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } },
  sorts: { allocated_desc: null, allocated_asc: null, name_asc: null, tickets_desc: null }, maxLimit: 100, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const EARN_LIST = { filters: { dateField: { type: 'enum', values: ['collected', 'checkout', 'allocation', 'adjustment', 'payout'] }, preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } },
  maxLimit: 100, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
/** Team Tips (Nov 13 2026): the read-only Tip Accuracy check — the KPI scope (period + basis), no paging */
const ACC_LIST = { filters: { dateField: { type: 'enum', values: ['collected', 'checkout', 'allocation', 'adjustment', 'payout'] }, preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } },
  maxLimit: 1, defaultLimit: 1, dateRange: { maxDays: 3700 } } as const;
const ADJ_LIST = { filters: { kind: { type: 'enum', values: ['correction', 'reversal', 'all'] }, preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payments/tips')
export class TipsScreenController {
  constructor(@Inject(TIPS_SCREEN_REPOSITORY) private readonly repo: TipsScreenRepository | null) {}
  private r(): TipsScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Tips need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('summary') @RequirePermission('pos.reports.view') @ListQuery(TIP_LIST)
  summary(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => this.r().summary(c, this.r().filters(await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }), q)));
  }

  @Get('transactions') @RequirePermission('pos.reports.view') @ListQuery(TIP_LIST)
  transactions(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }); const f = this.r().filters(period, q);
      return { ...(await this.r().transactions(c, f, tipsPageReq({ page: q.page, pageSize: q.pageSize }))), period, dateBasis: f.basis, sort: f.sort };
    });
  }

  @Get('distribution') @RequirePermission('pos.reports.view') @ListQuery(DIST_LIST)
  distribution(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }); const f = this.r().filters(period, { dateField: q.dateField });
      return { ...(await this.r().distribution(c, f, tipsPageReq({ page: q.page, pageSize: q.pageSize }), oneOf(q.sort, DIST_SORTS, 'sort') ?? 'allocated_desc')), period, dateBasis: f.basis };
    });
  }

  /** extras TIPS 01 — Technician Earnings Overlay (read-only; same period / basis as Distribution). */
  @Get('technicians/:technicianId/earnings') @RequirePermission('pos.reports.view') @ListQuery(EARN_LIST)
  technicianEarnings(@Req() req: any, @Param('technicianId') technicianId: string, @Query() q: Record<string, string>): Promise<TipsTechnicianEarningsResponse> {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }); const f = this.r().filters(period, { dateField: q.dateField });
      return { ...(await this.r().technicianEarnings(c, f, String(technicianId), tipsPageReq({ page: q.page, pageSize: q.pageSize }))), period, dateBasis: f.basis };
    });
  }

  /** Team Tips (Nov 13 2026) — One-Click Tip Accuracy check: READ-ONLY (no write, no money moves); same scope as the KPIs. */
  @Get('accuracy') @RequirePermission('pos.reports.view') @ListQuery(ACC_LIST)
  accuracy(@Req() req: any, @Query() q: Record<string, string>): Promise<TipsAccuracyResponse> {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }); const f = this.r().filters(period, { dateField: q.dateField });
      return { ...(await this.r().accuracy(c, f)), period, dateBasis: f.basis };
    });
  }

  @Get('technicians') @RequirePermission('pos.reports.view')
  technicians(@Req() req: any) { const c = financeCtx(req); needPermission(c, 'pos.reports.view'); return runFinance(() => this.r().technicians(c)); }

  @Get('adjustments') @RequirePermission('pos.reports.view') @ListQuery(ADJ_LIST)
  adjustments(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => this.r().adjustments(c, await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }), { kind: q.kind, search: q.search }, pageReq({ page: q.page, pageSize: q.pageSize })));
  }

  @AsyncExport({ kind: 'pos.tips.export' }) @Get('export') @RequirePermission('pos.reports.export') @ListQuery(TIP_LIST) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="tips.csv"')
  exportCsv(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.export');
    return runFinance(async () => this.r().exportCsv(c, this.r().filters(await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }), q)));
  }

  @Get(':ticketId/detail') @RequirePermission('pos.reports.view')
  detail(@Req() req: any, @Param('ticketId') id: string) { const c = financeCtx(req); needPermission(c, 'pos.reports.view'); return runFinance(() => this.r().detail(c, String(id))); }
}
