// terminals-screen.controller.ts — Payment Terminals mandate (Oct 29 2026): `/pos/devices/payment-terminals*`, the READ side
// of POS Devices → Payment Terminals. Guards: TenantAuthGuard + RolePermissionGuard; tenant / location / role come from the
// session (req.ctx), never the query. Read-only: pairing, register assignment, test, disable / enable, unpair stay on the
// audited step-up settings routes (pos/settings/payments-checkout/terminals*); Tap to Pay approve / suspend / revoke on the
// mobile-checkout device routes (owner trust decisions, step-up); routing on PATCH pos/settings/payments-checkout (audited).
//   reads  pos.checkout.view   summary · physical · physical/:id · tap-to-pay · tap-to-pay/:deviceId · activity · routing
// Staff phones and customer contact are masked for a role without the matching permission (pos.devices.manage /
// pos.customers.view).
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { TerminalsScreenRepository, TERMINAL_LIST_SORTS, PHYSICAL_GROUPS, PHONE_STATUSES, ACTIVITY_STATUSES, ACTIVITY_DEVICE_KINDS } from './terminals-screen.repository';
import { oneOf, pageReq, searchText } from './finance-scope';
import { financeCtx, needPermission, runFinance } from './settlements-screen.controller';

export const TERMINALS_SCREEN_REPOSITORY = 'TerminalsScreenRepository';

const PHYSICAL_LIST = {
  filters: { status: { type: 'enum', values: ['online', 'attention', 'disabled', 'in_use', 'all'] }, register: { type: 'text', maxLength: 64 } },
  sorts: { created_desc: null, created_asc: null, name_asc: null, status: null, last_seen_desc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, params: ['page'],
} as const;
const PHONE_LIST = {
  filters: { status: { type: 'enum', values: ['active', 'pending', 'disabled', 'revoked', 'compromised', 'all'] } },
  sorts: { created_desc: null, created_asc: null, name_asc: null, status: null, last_seen_desc: null, last_payment_desc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, params: ['page'],
} as const;
const ACTIVITY_LIST = {
  filters: { status: { type: 'enum', values: ['approved', 'declined', 'failed', 'pending', 'refunded', 'voided', 'all'] }, device: { type: 'enum', values: ['terminal', 'iphone', 'unlinked', 'all'] }, deviceId: { type: 'text', maxLength: 128 },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom'] }, dateField: { type: 'enum', values: ['transaction'] } },
  sorts: { time_desc: null, time_asc: null, amount_desc: null, amount_asc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/devices/payment-terminals')
export class TerminalsScreenController {
  constructor(@Inject(TERMINALS_SCREEN_REPOSITORY) private readonly repo: TerminalsScreenRepository | null) {}
  private r(): TerminalsScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Payment terminals need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('summary') @RequirePermission('pos.checkout.view')
  summary(@Req() req: any) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(() => this.r().summary(c)); }

  @Get('physical') @RequirePermission('pos.checkout.view') @ListQuery(PHYSICAL_LIST)
  physical(@Req() req: any, @Query('search') search?: string, @Query('status') status?: string, @Query('register') register?: string, @Query('sort') sort?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => this.r().physicalList(c, { q: searchText(search), group: oneOf(status, PHYSICAL_GROUPS, 'status'), stationId: register ? String(register).slice(0, 64) : undefined,
      sort: oneOf(sort, TERMINAL_LIST_SORTS.physical, 'sort') ?? 'created_desc' }, pageReq({ page, pageSize })));
  }

  @Get('physical/:terminalId') @RequirePermission('pos.checkout.view')
  physicalDetail(@Req() req: any, @Param('terminalId') id: string) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(() => this.r().physicalDetail(c, String(id).slice(0, 128))); }

  @Get('tap-to-pay') @RequirePermission('pos.checkout.view') @ListQuery(PHONE_LIST)
  phones(@Req() req: any, @Query('search') search?: string, @Query('status') status?: string, @Query('sort') sort?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => this.r().phoneList(c, { q: searchText(search), status: oneOf(status, PHONE_STATUSES, 'status'), sort: oneOf(sort, TERMINAL_LIST_SORTS.phones, 'sort') ?? 'created_desc' }, pageReq({ page, pageSize })));
  }

  @Get('tap-to-pay/:deviceId') @RequirePermission('pos.checkout.view')
  phoneDetail(@Req() req: any, @Param('deviceId') id: string) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(() => this.r().phoneDetail(c, String(id).slice(0, 128))); }

  @Get('activity') @RequirePermission('pos.checkout.view') @ListQuery(ACTIVITY_LIST)
  activity(@Req() req: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('search') search?: string, @Query('status') status?: string,
    @Query('device') device?: string, @Query('deviceId') deviceId?: string, @Query('sort') sort?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset, from, to });
      const list = await this.r().activityList(c, { period, q: searchText(search), status: oneOf(status, ACTIVITY_STATUSES, 'status'), device: oneOf(device, ACTIVITY_DEVICE_KINDS, 'device'),
        deviceId: deviceId ? String(deviceId).slice(0, 128) : undefined, sort: oneOf(sort, TERMINAL_LIST_SORTS.activity, 'sort') ?? 'time_desc' }, pageReq({ page, pageSize }));
      return { ...list, period, dateBasis: 'transaction' as const };
    });
  }

  @Get('routing') @RequirePermission('pos.checkout.view')
  routing(@Req() req: any) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(() => this.r().routing(c)); }
}
