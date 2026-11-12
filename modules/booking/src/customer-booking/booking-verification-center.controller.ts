// booking-verification-center.controller.ts — HTTP surface of booking-verification-center.ts (Booking Phone Verification
// Complete Build Guide §10–§14). Tenant and branch come only from the session; filters are validated; reads need
// settings.view (the page's own nav permission); the one write (an authorized resend) needs pos.booking.create and is
// rate-limited by the send path's cooldown. No route returns a code, a provider secret or a full phone number.
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { BVC_RESEND_BODY } from '../request-schemas';
import { BookingVerificationSettingsService } from './booking-verification-settings.service';
import { BookingService } from '../booking/booking.service';
import type { BookingVerificationCenter, BvcContext } from './booking-verification-center';

export const BOOKING_VERIFICATION_CENTER = 'BOOKING_VERIFICATION_CENTER';
function ctxOf(req: any): BvcContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId || null, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof HttpException) throw e;
    throw withCode(new HttpException({ code: 'INTERNAL_ERROR', message: 'Booking verification could not be loaded.' }, HttpStatus.INTERNAL_SERVER_ERROR), 'INTERNAL_ERROR');
  }
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const HISTORY_SPEC = {
  filters: {
    status: { type: 'enum', values: ['pending', 'verified', 'failed', 'expired', 'cancelled', 'provider_error'] },
    channel: { type: 'enum', values: ['online', 'customer_app', 'ai_receptionist', 'kiosk', 'front_desk', 'walk_in'] },
    branchId: { type: 'uuid' },
    basis: { type: 'enum', values: ['requested', 'completed', 'hold_created', 'hold_expired', 'appointment'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
  },
  sort: { allowed: ['newest'], default: 'newest' }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const LIVE_SPEC = { filters: {}, sort: { allowed: ['nearest_expiry'], default: 'nearest_expiry' }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/booking-verification-center')
export class BookingVerificationCenterController {
  private readonly center: BookingVerificationCenter | null;
  constructor(@Optional() @Inject(BOOKING_VERIFICATION_CENTER) center: BookingVerificationCenter | null, @Optional() private readonly settings?: BookingVerificationSettingsService | null,
    @Optional() booking?: BookingService | null) {
    this.center = center;
    // extras 10 Lost-Booking Recovery: fresh open times come from POS Booking's own availability engine (nothing is held or booked)
    if (center && booking) center.availability = (c, q) => booking.availability({ tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions }, q);
  }
  private c(): BookingVerificationCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'INTERNAL_ERROR', message: 'Booking verification is not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'INTERNAL_ERROR');
    return this.center;
  }

  @Get('summary') @RequirePermission('settings.view')
  summary(@Req() r: any) { return run(() => this.c().summary(ctxOf(r))); }

  @Get('health') @RequirePermission('settings.view')
  health(@Req() r: any) {
    return run(async () => {
      const ctx = ctxOf(r);
      // no settings service wired → the policy check answers Unknown; a settings READ error is a real error (not swallowed)
      const st = this.settings ? await this.settings.get(ctx.tenantId, ctx.branchId) : null;
      return this.c().health(ctx, st);
    });
  }

  @Get('live') @RequirePermission('settings.view') @ListQuery(LIVE_SPEC)
  live(@Req() r: any, @Query() q: any) { return run(() => this.c().live(ctxOf(r), { page: q?.page, pageSize: q?.pageSize ?? q?.limit })); }

  @Get('history') @RequirePermission('settings.view') @ListQuery(HISTORY_SPEC)
  history(@Req() r: any, @Query() q: any) {
    return run(() => this.c().history(ctxOf(r), { q: s(q?.q), status: s(q?.status), channel: s(q?.channel), branchId: s(q?.branchId), basis: s(q?.basis),
      preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize ?? q?.limit }));
  }

  @Get('history/:id') @RequirePermission('settings.view')
  detail(@Req() r: any, @Param('id') id: string) { return run(() => this.c().detail(ctxOf(r), id)); }

  @Post('history/:id/resend') @RequirePermission('pos.booking.create')
  resend(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(BVC_RESEND_BODY, { strict: true })) _b: unknown) { return run(() => this.c().resend(ctxOf(r), id)); }
}
