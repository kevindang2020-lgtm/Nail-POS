// email-center.controller.ts — HTTP surface of email-center.ts (Communications → Email). Tenant and branch come ONLY from the
// session; bodies are strict; every method re-checks its permission. The only sends: test (to staff), compose (to one
// customer, address from the record) and resend (the 741 protected retry) — each confirmed and idempotent.
import { Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { EMPTY_BODY, EMAIL_TEST_BODY, EMAIL_COMPOSE_BODY, EMAIL_RESEND_BODY } from '../request-schemas';
import { asHttp } from '../notifications/customer-notifications';
import type { EmailCenter, EcContext } from './email-center';

export const EMAIL_CENTER = 'EMAIL_CENTER';
function ctxOf(req: any): EcContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { return asHttp(e); } }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const WINDOW_SPEC = { filters: { preset: PRESET }, dateRange: { maxDays: 3700 }, params: [] } as const;
const HISTORY_SPEC = {
  filters: {
    preset: PRESET, basis: { type: 'enum', values: ['created', 'sent', 'event', 'booking', 'receipt'] },
    status: { type: 'enum', values: ['accepted', 'delivered', 'failed', 'bounced', 'blocked', 'suppressed', 'simulated'] },
    category: { type: 'enum', values: ['booking', 'receipt', 'reminder', 'follow_up', 'marketing', 'manual'] },
  },
  search: { maxLength: 120 }, sort: { allowed: ['newest'], default: 'newest' }, maxLimit: 50, defaultLimit: 20, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/email-center')
export class EmailCenterController {
  private readonly center: EmailCenter | null;
  constructor(@Optional() @Inject(EMAIL_CENTER) center: EmailCenter | null) { this.center = center; }
  private c(): EmailCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'EMAIL_NOT_AVAILABLE', message: 'Email is not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'EMAIL_NOT_AVAILABLE');
    return this.center;
  }

  @Get('settings') @RequirePermission('pos.communications.view')
  settings(@Req() r: any) { return run(() => this.c().settings(ctxOf(r))); }

  @Get('summary') @RequirePermission('pos.communications.view') @ListQuery(WINDOW_SPEC)
  summary(@Req() r: any, @Query() q: any) { return run(() => this.c().summary(ctxOf(r), { preset: s(q?.preset), from: s(q?.from), to: s(q?.to) })); }

  @Get('health') @RequirePermission('pos.communications.view')
  health(@Req() r: any) { return run(() => this.c().health(ctxOf(r))); }

  @Post('health/check') @RequirePermission('pos.communications.manage')
  check(@Req() r: any, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return run(() => this.c().checkHealth(ctxOf(r))); }

  @Get('history') @RequirePermission('pos.communications.view') @ListQuery(HISTORY_SPEC)
  history(@Req() r: any, @Query() q: any) {
    return run(() => this.c().history(ctxOf(r), { q: s(q?.q), status: s(q?.status), category: s(q?.category), basis: s(q?.basis), preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize ?? q?.limit }));
  }

  @Get('messages/:id') @RequirePermission('pos.communications.view')
  detail(@Req() r: any, @Param('id') id: string) { return run(() => this.c().detail(ctxOf(r), id)); }

  @Post('messages/:id/resend') @RequirePermission('pos.communications.manage')
  resend(@Req() r: any, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Body(ValidatedBody(EMAIL_RESEND_BODY, { strict: true })) b: any) {
    return run(() => this.c().resend(ctxOf(r), id, { idempotencyKey: key ?? b?.idempotencyKey, confirm: b?.confirm }));
  }

  @Post('test') @RequirePermission('pos.communications.manage')
  test(@Req() r: any, @Headers('idempotency-key') key: string | undefined, @Body(ValidatedBody(EMAIL_TEST_BODY, { strict: true })) b: any) {
    return run(() => this.c().test(ctxOf(r), { to: b?.to, idempotencyKey: key ?? b?.idempotencyKey, confirm: b?.confirm }));
  }

  @Post('compose') @RequirePermission('pos.communications.manage')
  compose(@Req() r: any, @Headers('idempotency-key') key: string | undefined, @Body(ValidatedBody(EMAIL_COMPOSE_BODY, { strict: true })) b: any) {
    return run(() => this.c().compose(ctxOf(r), { customerId: b?.customerId, subject: b?.subject, body: b?.body, idempotencyKey: key ?? b?.idempotencyKey, confirm: b?.confirm, preview: b?.preview }));
  }
}
