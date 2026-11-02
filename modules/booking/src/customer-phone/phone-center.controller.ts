// phone-center.controller.ts — HTTP surface of phone-center.ts (Phone Number Management Complete Build Guide). READ ONLY.
// Tenant and branch come only from the session; filters are validated; nothing here changes a number, sends a code or retries a sync —
// those stay on pos/customers/:customerId/phone/* (CustomerPhoneController), which owns the state machine and the audit.
import { Controller, Get, HttpException, HttpStatus, Inject, Optional, Param, Query, Req, UseGuards } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import type { PhoneCenter, PcContext } from './phone-center';

export const PHONE_CENTER = 'PHONE_CENTER';
function ctxOf(req: any): PcContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId || null, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof HttpException) throw e;
    throw withCode(new HttpException({ code: 'INTERNAL_ERROR', message: 'Phone management could not be loaded.' }, HttpStatus.INTERNAL_SERVER_ERROR), 'INTERNAL_ERROR');
  }
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const GROUP = { type: 'enum', values: ['pending', 'code_sent', 'retry_allowed', 'expired', 'failed', 'manager_review', 'cancelled', 'completed', 'sync_attention'] } as const;
const COMMON_FILTERS = {
  group: GROUP, source: { type: 'enum', values: ['staff_pos', 'customer_app', 'kiosk', 'ai_receptionist', 'import'] }, branchId: { type: 'uuid' },
  shared: { type: 'enum', values: ['yes', 'no'] }, method: { type: 'enum', values: ['sms', 'manual'] },
  sync: { type: 'enum', values: ['synced', 'retry_scheduled', 'failed', 'in_progress', 'pending', 'attention', 'all'] },
} as const;
const HISTORY_SPEC = {
  filters: { ...COMMON_FILTERS, preset: PRESET, basis: { type: 'enum', values: ['requested', 'verified', 'applied', 'failed', 'audit'] } },
  sort: { allowed: ['newest'], default: 'newest' }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const QUEUE_SPEC = { filters: COMMON_FILTERS, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;
const CUSTOMER_SPEC = { filters: {}, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customer-phone-center')
export class PhoneCenterController {
  private readonly center: PhoneCenter | null;
  constructor(@Optional() @Inject(PHONE_CENTER) center: PhoneCenter | null) { this.center = center; }
  private c(): PhoneCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'INTERNAL_ERROR', message: 'Phone management is not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'INTERNAL_ERROR');
    return this.center;
  }
  private f(q: any) {
    return { q: s(q?.q), group: s(q?.group), source: s(q?.source), branchId: s(q?.branchId), shared: s(q?.shared), method: s(q?.method), sync: s(q?.sync),
      basis: s(q?.basis), preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize ?? q?.limit };
  }

  @Get('summary') @RequirePermission('pos.customers.view')
  summary(@Req() r: any) { return run(() => this.c().summary(ctxOf(r))); }

  @Get('health') @RequirePermission('pos.customers.view')
  health(@Req() r: any) { return run(() => this.c().health(ctxOf(r))); }

  @Get('requests') @RequirePermission('pos.customers.view') @ListQuery(HISTORY_SPEC)
  history(@Req() r: any, @Query() q: any) { return run(() => this.c().history(ctxOf(r), this.f(q))); }

  @Get('pending') @RequirePermission('pos.customers.view') @ListQuery(QUEUE_SPEC)
  pending(@Req() r: any, @Query() q: any) { return run(() => this.c().pending(ctxOf(r), this.f(q))); }

  @Get('sync') @RequirePermission('pos.customers.view') @ListQuery(QUEUE_SPEC)
  sync(@Req() r: any, @Query() q: any) { return run(() => this.c().syncIssues(ctxOf(r), this.f(q))); }

  @Get('requests/:id') @RequirePermission('pos.customers.view')
  detail(@Req() r: any, @Param('id') id: string) { return run(() => this.c().detail(ctxOf(r), id)); }

  @Get('customers') @RequirePermission('pos.customers.view') @ListQuery(CUSTOMER_SPEC)
  customers(@Req() r: any, @Query() q: any) { return run(() => this.c().customers(ctxOf(r), { q: s(q?.q), page: q?.page, pageSize: q?.pageSize ?? q?.limit })); }
}
