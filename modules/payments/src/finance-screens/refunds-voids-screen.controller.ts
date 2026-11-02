// refunds-voids-screen.controller.ts — Refunds & Voids mandate (Oct 29 2026): the READ side of POS Payments & Money →
// Refunds & Voids (/tenant/payments/refunds-voids). Guards: TenantAuthGuard + RolePermissionGuard; tenant / location / role
// from the session. Reporting, investigation and the Find Original Payment lookup — it never moves money.
//   reads   pos.checkout.view    list · summary · facets · find · :kind/:id/detail
//   export  pos.reports.export   export (CSV, every matching reversal, masked contact, audited)
// A refund, a void and settling an unknown refund stay on the authorised Checkout routes (processor-backed, claim-first,
// idempotent, step-up): POST /pos/checkout/tickets/:id/refund · /payments/:id/refund · /payments/:id/void · /tickets/:id/refunds/:rid/settle.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Query, Req, Header, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { RefundsVoidsScreenRepository } from './refunds-voids-screen.repository';
import { pageReq, FinanceError, isUuid } from './finance-scope';
import { financeCtx, needPermission, runFinance } from './settlements-screen.controller';

export const REFUNDS_VOIDS_SCREEN_REPOSITORY = 'RefundsVoidsScreenRepository';

const RV_LIST = {
  filters: {
    type: { type: 'enum', values: ['refund', 'partial_refund', 'void'] },
    status: { type: 'enum', values: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'needs_review'] },
    method: { type: 'enum', values: ['cash', 'card', 'gift_card', 'other'] },
    dateField: { type: 'enum', values: ['requested', 'completed', 'original'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
    processor: { type: 'text', maxLength: 40 }, register: { type: 'text', maxLength: 64 }, minAmount: { type: 'text', maxLength: 12 }, maxAmount: { type: 'text', maxLength: 12 },
  },
  sorts: { created_desc: null, created_asc: null, completed_desc: null, amount_desc: null, amount_asc: null, type_asc: null, status_asc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const RV_FIND = {
  filters: { preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } },
  sorts: { created_desc: null }, search: { params: ['query'], maxLength: 100 }, maxLimit: 100, defaultLimit: 30, dateRange: { maxDays: 3700 }, params: [],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payments/refunds-voids')
export class RefundsVoidsScreenController {
  constructor(@Inject(REFUNDS_VOIDS_SCREEN_REPOSITORY) private readonly repo: RefundsVoidsScreenRepository | null) {}
  private r(): RefundsVoidsScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Refunds & voids need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('list') @RequirePermission('pos.checkout.view') @ListQuery(RV_LIST)
  list(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }); const f = this.r().filters(period, q);
      return { ...(await this.r().list(c, f, pageReq({ page: q.page, pageSize: q.pageSize }))), period, dateBasis: f.basis, sort: f.sort };
    });
  }

  @Get('summary') @RequirePermission('pos.checkout.view') @ListQuery(RV_LIST)
  summary(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => this.r().summary(c, this.r().filters(await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }), q)));
  }

  @Get('facets') @RequirePermission('pos.checkout.view')
  facets(@Req() req: any) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(() => this.r().facets(c)); }

  /** Find Original Payment: captured tenders matching the query, each with refunded / pending / refundable and why an action is off. */
  @Get('find') @RequirePermission('pos.checkout.view') @ListQuery(RV_FIND)
  find(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => this.r().find(c, String(q.query ?? ''), await this.r().period(c, { preset: q.preset || 'all', from: q.from, to: q.to })));
  }

  @AsyncExport({ kind: 'pos.refunds-voids.export' }) @Get('export') @RequirePermission('pos.reports.export') @ListQuery(RV_LIST) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="refunds-voids.csv"')
  exportCsv(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.export');
    return runFinance(async () => this.r().exportCsv(c, this.r().filters(await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }), q)));
  }

  @Get(':kind/:id/detail') @RequirePermission('pos.checkout.view')
  detail(@Req() req: any, @Param('kind') kind: string, @Param('id') id: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(() => {
      if (kind !== 'refund' && kind !== 'void' || !isUuid(id)) throw new FinanceError('That reversal could not be found.', 'REVERSAL_NOT_FOUND', 404);
      return this.r().detail(c, kind, id);
    });
  }
}
