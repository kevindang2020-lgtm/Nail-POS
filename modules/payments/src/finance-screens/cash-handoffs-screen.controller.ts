// cash-handoffs-screen.controller.ts — End-of-Day Cash mandate (Oct 29 2026): the READ side of POS Payments & Money →
// Daily Closeout / End-of-Day Cash (/cash-handoffs). Guards: TenantAuthGuard + RolePermissionGuard; tenant / location / role
// from the session. A reporting and investigation module: it reflects the custody ledger and never moves cash.
//   reads   pos.checkout.view    list · summary · technicians · :technicianId/:businessDate/detail
//   export  pos.reports.export   export (CSV, every matching unit, audited)
// Counting, partial hand-offs, resolution and drawer transfers stay on the workforce routes (/pos/cash-handoffs/:technicianId/*).
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Query, Req, Header, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { CashHandoffsScreenRepository } from './cash-handoffs-screen.repository';
import { pageReq } from './finance-scope';
import { financeCtx, needPermission, runFinance } from './settlements-screen.controller';

export const CASH_HANDOFFS_SCREEN_REPOSITORY = 'CashHandoffsScreenRepository';

const CH_LIST = {
  filters: {
    status: { type: 'enum', values: ['awaiting', 'open', 'submitted', 'reconciled', 'balanced', 'resolved', 'discrepancy', 'short', 'over', 'cancelled'] },
    dateField: { type: 'enum', values: ['business', 'counted', 'submitted', 'created'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
    technician: { type: 'text', maxLength: 64 }, date: { type: 'text', maxLength: 10 },
  },
  sorts: { created_desc: null, created_asc: null, date_desc: null, expected_desc: null, variance_asc: null, variance_desc: null, technician_asc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payments/cash-handoffs')
export class CashHandoffsScreenController {
  constructor(@Inject(CASH_HANDOFFS_SCREEN_REPOSITORY) private readonly repo: CashHandoffsScreenRepository | null) {}
  private r(): CashHandoffsScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'End-of-day cash needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }
  private period(c: ReturnType<typeof financeCtx>, q: Record<string, string>) { return this.r().period(c, { preset: q.preset, from: q.from, to: q.to, date: q.date }); }

  @Get('list') @RequirePermission('pos.checkout.view') @ListQuery(CH_LIST)
  list(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const period = await this.period(c, q); const f = this.r().filters(period, q);
      return { ...(await this.r().list(c, f, pageReq({ page: q.page, pageSize: q.pageSize }))), period, dateBasis: f.basis, sort: f.sort };
    });
  }

  @Get('summary') @RequirePermission('pos.checkout.view') @ListQuery(CH_LIST)
  summary(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => this.r().summary(c, this.r().filters(await this.period(c, q), q)));
  }

  @Get('technicians') @RequirePermission('pos.checkout.view')
  technicians(@Req() req: any) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(() => this.r().technicians(c)); }

  @AsyncExport({ kind: 'pos.cash-handoffs.export' }) @Get('export') @RequirePermission('pos.reports.export') @ListQuery(CH_LIST) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="end-of-day-cash.csv"')
  exportCsv(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.export');
    return runFinance(async () => this.r().exportCsv(c, this.r().filters(await this.period(c, q), q)));
  }

  @Get(':technicianId/:businessDate/detail') @RequirePermission('pos.checkout.view')
  detail(@Req() req: any, @Param('technicianId') technicianId: string, @Param('businessDate') businessDate: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(() => this.r().detail(c, String(technicianId), String(businessDate)));
  }
}
