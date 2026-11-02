// reminder-center.controller.ts — Appointment Reminders guide §13: pos/reminder-center/*. Tenant + branch scope come from
// the session only. Reads need communications.view; Cancel Pending and Safe Retry need communications.manage (the owner's
// decision on record: Front Desk keeps full communications control). Settings stay on GET/PATCH /pos/reminders.
import { Body, Controller, Get, HttpException, Inject, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { withCode } from '@aipowersalon/api-contracts';
import { DATABASE, ListQuery, type AppDatabase } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature, ValidatedBody } from '@aipowersalon/permissions/guards';
import { RemindersService } from './reminders.service';
import { ReminderCenter, type RcCtx } from './reminder-center';
import { REMINDER_CANCEL_BODY, REMINDER_RETRY_BODY } from '../request-schemas';
import { allowedBranchesOf } from '../tenant-messaging/tenant-messaging.tenant.controller';

function ctxOf(r: any): RcCtx {
  const c = r?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId ?? null, role: c.role ?? null, allowedBranches: allowedBranchesOf(c) };
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const LIST_SPEC = {
  filters: {
    tab: { type: 'enum', values: ['upcoming', 'sent', 'delivered', 'failed', 'cancelled', 'skipped', 'all'] },
    channel: { type: 'enum', values: ['sms', 'email'] },
    branchId: { type: 'uuid' },
    basis: { type: 'enum', values: ['created', 'scheduled', 'sent', 'delivered', 'appointment'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
  },
  sort: { allowed: ['due', 'newest'], default: 'due' }, search: { maxLength: 120 }, maxLimit: 50, defaultLimit: 20, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const KPIS_SPEC = {
  filters: { branchId: { type: 'uuid' }, preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } },
  sort: { allowed: ['fixed'], default: 'fixed' }, maxLimit: 6, defaultLimit: 6, dateRange: { maxDays: 3700 },
} as const;   // six counters
const HISTORY_SPEC = { filters: {}, sort: { allowed: ['newest'], default: 'newest' }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('smart_reminders')
@Controller('pos/reminder-center')
export class ReminderCenterController {
  private readonly center: ReminderCenter | null;
  constructor(svc: RemindersService, @Optional() @Inject(DATABASE) db: AppDatabase | null) {
    this.center = db ? new ReminderCenter(db as unknown as Kysely<any>, svc) : null;
  }
  private c(): ReminderCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Reminders are not available here.' }, 503), 'SERVICE_UNAVAILABLE');
    return this.center;
  }

  /** the six counters, each on its written basis, in the salon's time zone (guide §4, §14) */
  @Get('kpis') @RequirePermission('communications.view') @ListQuery(KPIS_SPEC)
  kpis(@Req() r: any, @Query() q: any) { return this.c().kpis(ctxOf(r), { preset: s(q?.preset), from: s(q?.from), to: s(q?.to), branchId: s(q?.branchId) }); }

  /** Upcoming (earliest due first) or history tabs (newest created first) — server search, filters, date basis, pages (§5) */
  @Get('reminders') @RequirePermission('communications.view') @ListQuery(LIST_SPEC)
  list(@Req() r: any, @Query() q: any) {
    return this.c().list(ctxOf(r), { tab: s(q?.tab), q: s(q?.q), channel: s(q?.channel), branchId: s(q?.branchId), basis: s(q?.basis), preset: s(q?.preset), from: s(q?.from), to: s(q?.to),
      page: Number(q?.page) || 1, pageSize: Number(q?.pageSize ?? q?.limit) || 20 });
  }

  /** linked booking, customer, rule, template version, attempts, provider events (§6) */
  @Get('reminders/:id') @RequirePermission('communications.view')
  details(@Req() r: any, @Param('id') id: string) { return this.c().details(ctxOf(r), id); }

  @Post('reminders/:id/cancel') @RequirePermission('communications.manage')
  cancel(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REMINDER_CANCEL_BODY, { strict: true })) b: { reason?: string }) { return this.c().cancelPending(ctxOf(r), id, b?.reason ?? ''); }

  @Post('reminders/:id/retry') @RequirePermission('communications.manage')
  retry(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REMINDER_RETRY_BODY, { strict: true })) b: { idempotencyKey?: string; reason?: string; confirm?: boolean; acknowledgeDuplicateRisk?: boolean }) {
    return this.c().retry(ctxOf(r), id, b ?? {});
  }

  /** scheduler · Twilio · email · booking sync · delivery reports — probes over recorded runs and records (§11) */
  @Get('health') @RequirePermission('communications.view')
  health(@Req() r: any) { return this.c().health(ctxOf(r)); }

  /** a customer's reminders, newest first, with each one's event trail (§10) */
  @Get('customers/:customerId/reminders') @RequirePermission('communications.view') @ListQuery(HISTORY_SPEC)
  customer(@Req() r: any, @Param('customerId') customerId: string, @Query() q: any) { return this.c().customerHistory(ctxOf(r), customerId, Number(q?.page) || 1, Number(q?.pageSize ?? q?.limit) || 10); }
}
