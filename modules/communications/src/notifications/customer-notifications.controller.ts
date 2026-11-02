// customer-notifications.controller.ts — HTTP surface of customer-notifications.ts (Customer Notifications Complete Build Guide,
// 741). Tenant and branch come ONLY from the session (req.ctx); bodies are strict; every service method re-checks the permission.
// Nothing here sends except POST records/:id/retry — one confirmed, idempotent, re-checked resend of one failed row.
// Re-subscribing stays on the one existing route, POST /pos/notifications/opt-in (consent note + STOP rules, consent history).
import { Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Optional, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { EMPTY_BODY, CN_RETRY_BODY, CN_ALERT_SETTINGS_BODY } from '../request-schemas';
import { asHttp, type CustomerNotificationsCenter, type CnContext } from './customer-notifications';

export const CUSTOMER_NOTIFICATIONS_CENTER = 'CUSTOMER_NOTIFICATIONS_CENTER';
function ctxOf(req: any): CnContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { return asHttp(e); } }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const LIST_SPEC = {
  filters: {
    preset: PRESET, tab: { type: 'enum', values: ['all', 'sms', 'email', 'failed', 'blocked', 'pending', 'unknown', 'delivered'] },
    basis: { type: 'enum', values: ['created', 'delivered', 'callback'] }, status: { type: 'enum', values: ['sent', 'delivered', 'failed', 'blocked', 'simulated'] },
    channel: { type: 'enum', values: ['sms', 'email'] }, type: { type: 'enum', values: ['receipt', 'reminder', 'followup', 'marketing', 'account', 'notification', 'conversation', 'unknown'] },
    branchId: { type: 'uuid' },
  },
  sort: { allowed: ['newest', 'oldest'], default: 'newest' }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 20, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const WINDOW_SPEC = {
  filters: { preset: PRESET, basis: { type: 'enum', values: ['created', 'delivered', 'callback'] }, branchId: { type: 'uuid' } },
  dateRange: { maxDays: 3700 }, params: [],
} as const;
const OPT_SPEC = {
  filters: { view: { type: 'enum', values: ['current', 'history'] }, channel: { type: 'enum', values: ['sms', 'email'] } },
  search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 20, params: ['page'],
} as const;
const TIMELINE_SPEC = { filters: { channel: { type: 'enum', values: ['all', 'sms', 'email', 'booking', 'follow_up', 'receipt'] } }, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;
const INCIDENT_SPEC = { filters: { status: { type: 'enum', values: ['open', 'closed', 'all'] } }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customer-notifications')
export class CustomerNotificationsController {
  private readonly center: CustomerNotificationsCenter | null;
  constructor(@Optional() @Inject(CUSTOMER_NOTIFICATIONS_CENTER) center: CustomerNotificationsCenter | null) { this.center = center; }
  private c(): CustomerNotificationsCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'NOTIFICATIONS_NOT_AVAILABLE', message: 'Customer notifications are not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'NOTIFICATIONS_NOT_AVAILABLE');
    return this.center;
  }

  @Get('summary') @RequirePermission('pos.communications.view') @ListQuery(WINDOW_SPEC)
  summary(@Req() r: any, @Query() q: any) { return run(() => this.c().summary(ctxOf(r), { preset: s(q?.preset), from: s(q?.from), to: s(q?.to), basis: s(q?.basis), branchId: s(q?.branchId) })); }

  @Get('records') @RequirePermission('pos.communications.view') @ListQuery(LIST_SPEC)
  list(@Req() r: any, @Query() q: any) {
    return run(() => this.c().list(ctxOf(r), { q: s(q?.q), tab: s(q?.tab), basis: s(q?.basis), status: s(q?.status), channel: s(q?.channel), type: s(q?.type), branchId: s(q?.branchId),
      sort: s(q?.sort), preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize ?? q?.limit }));
  }

  @Get('records/:id') @RequirePermission('pos.communications.view')
  detail(@Req() r: any, @Param('id') id: string) { return run(() => this.c().detail(ctxOf(r), id)); }

  @Post('records/:id/retry') @RequirePermission('pos.communications.manage')
  retry(@Req() r: any, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Body(ValidatedBody(CN_RETRY_BODY, { strict: true })) b: any) {
    return run(() => this.c().retry(ctxOf(r), id, { idempotencyKey: key ?? b?.idempotencyKey, confirm: b?.confirm }));
  }

  @Get('failures') @RequirePermission('pos.communications.view') @ListQuery(WINDOW_SPEC)
  failures(@Req() r: any, @Query() q: any) { return run(() => this.c().failures(ctxOf(r), { preset: s(q?.preset), from: s(q?.from), to: s(q?.to), branchId: s(q?.branchId) })); }

  @Get('opt-outs') @RequirePermission('pos.communications.view') @ListQuery(OPT_SPEC)
  optOuts(@Req() r: any, @Query() q: any) { return run(() => this.c().optOuts(ctxOf(r), { view: s(q?.view), channel: s(q?.channel), q: s(q?.q), page: q?.page, pageSize: q?.pageSize ?? q?.limit })); }

  @Get('customers/:customerId/timeline') @RequirePermission('pos.communications.view') @ListQuery(TIMELINE_SPEC)
  timeline(@Req() r: any, @Param('customerId') customerId: string, @Query() q: any) { return run(() => this.c().timeline(ctxOf(r), customerId, { channel: s(q?.channel), page: q?.page, pageSize: q?.pageSize ?? q?.limit })); }

  @Get('health') @RequirePermission('pos.communications.view')
  health(@Req() r: any) { return run(() => this.c().health(ctxOf(r))); }

  @Post('health/check') @RequirePermission('pos.communications.manage')
  checkHealth(@Req() r: any, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return run(() => this.c().checkHealth(ctxOf(r))); }

  @Get('incidents') @RequirePermission('pos.communications.view') @ListQuery(INCIDENT_SPEC)
  incidents(@Req() r: any, @Query() q: any) { return run(() => this.c().incidents(ctxOf(r), { status: s(q?.status), page: q?.page, pageSize: q?.pageSize ?? q?.limit })); }

  @Get('alert-settings') @RequirePermission('pos.communications.view')
  alertSettings(@Req() r: any) { return run(() => this.c().alertSettings(ctxOf(r))); }

  @Put('alert-settings') @RequirePermission('pos.communications.manage')
  saveAlertSettings(@Req() r: any, @Body(ValidatedBody(CN_ALERT_SETTINGS_BODY, { strict: true })) b: any) { return run(() => this.c().saveAlertSettings(ctxOf(r), b || {})); }
}
