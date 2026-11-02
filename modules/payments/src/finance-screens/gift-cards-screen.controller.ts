// gift-cards-screen.controller.ts — Gift Cards mandate (Oct 29 2026): the READ side of POS Customers → Gift Cards
// (/tenant/customers/gift-cards). Guards: TenantAuthGuard + RolePermissionGuard; tenant / location / role from the session.
//   reads   pos.checkout.view    list · summary · :cardId/detail · :cardId/ledger   (masked identifiers only)
//   export  pos.reports.export   export (CSV, masked, audited)
// The money-moving actions live with the gift-card writer (modules/checkout): Issue (payment-first ticket), Reload
// (payment-first ticket), Void (manager, reason, step-up), the protected balance check (rate limited) and redemption.
import { ListQuery } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Query, Req, Header, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { GiftCardsScreenRepository } from './gift-cards-screen.repository';
import { pageReq } from './finance-scope';
import { financeCtx, needPermission, runFinance } from './settlements-screen.controller';

export const GIFT_CARDS_SCREEN_REPOSITORY = 'GiftCardsScreenRepository';

const GC_LIST = {
  filters: {
    status: { type: 'enum', values: ['active', 'redeemed', 'void', 'pending', 'frozen', 'all'] },
    role: { type: 'enum', values: ['purchaser', 'recipient', 'all'] },
    dateField: { type: 'enum', values: ['issued', 'created', 'activity', 'redemption', 'expiration'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
    delivery: { type: 'enum', values: ['digital', 'physical', 'all'] },
    balanceMin: { type: 'text', maxLength: 12 }, balanceMax: { type: 'text', maxLength: 12 }, denomination: { type: 'text', maxLength: 12 }, branchId: { type: 'text', maxLength: 64 },
  },
  sorts: { issued_desc: null, issued_asc: null, activity_desc: null, balance_desc: null, balance_asc: null, name_asc: null, status: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const GC_LEDGER = { filters: { preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } }, maxLimit: 50, defaultLimit: 8, dateRange: { maxDays: 3700 }, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/gift-cards')
export class GiftCardsScreenController {
  constructor(@Inject(GIFT_CARDS_SCREEN_REPOSITORY) private readonly repo: GiftCardsScreenRepository | null) {}
  private r(): GiftCardsScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Gift cards need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('list') @RequirePermission('pos.checkout.view') @ListQuery(GC_LIST)
  list(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset: q.preset, from: q.from, to: q.to });
      const f = this.r().filters(period, q);
      return { ...(await this.r().list(c, f, pageReq({ page: q.page, pageSize: q.pageSize }))), period, dateBasis: f.basis, sort: f.sort };
    });
  }

  @Get('summary') @RequirePermission('pos.checkout.view') @ListQuery(GC_LIST)
  summary(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset: q.preset, from: q.from, to: q.to });
      const sum = await this.r().summary(c, this.r().filters(period, q));
      return { ...sum, permissions: { issue: can(c, 'pos.checkout.gift_card_issue'), balance: can(c, 'pos.checkout.gift_card_payment'), void: can(c, 'pos.checkout.void'), export: can(c, 'pos.reports.export') } };
    });
  }

  @AsyncExport({ kind: 'pos.gift-cards.export' }) @Get('export') @RequirePermission('pos.reports.export') @ListQuery(GC_LIST) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="gift-cards.csv"')
  exportCsv(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.export');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset: q.preset, from: q.from, to: q.to });
      return this.r().exportCsv(c, this.r().filters(period, q));
    });
  }

  @Get(':cardId/detail') @RequirePermission('pos.checkout.view')
  detail(@Req() req: any, @Param('cardId') id: string) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(() => this.r().detail(c, String(id))); }

  @Get(':cardId/ledger') @RequirePermission('pos.checkout.view') @ListQuery(GC_LEDGER)
  ledger(@Req() req: any, @Param('cardId') id: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => this.r().ledger(c, String(id), await this.r().period(c, { preset: preset ?? 'all', from, to }), pageReq({ page, pageSize })));
  }
}

const can = (c: ReturnType<typeof financeCtx>, p: string) => hasPermission(c as Parameters<typeof hasPermission>[0], p);
