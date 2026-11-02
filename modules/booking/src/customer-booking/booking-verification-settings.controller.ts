// booking-verification-settings.controller.ts — the tenant's Booking Phone Verification settings.
//
// Lives under `pos/settings/*` alongside every other settings surface, so it appears where a salon owner already
// looks. The STORAGE is a dedicated table rather than the generic per-category JSONB store — because this
// configuration needs branch rows, a monotonic version stamped onto every verification session, and a join
// against the platform policy, none of which that store can serve. Reused surface, dedicated storage.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { VERIFICATION_SETTINGS_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { bookingVerificationUsage } from './booking-verification-usage';
import { BookingVerificationSettingsService, VerificationSettingsError } from './booking-verification-settings.service';
import { BookingVerificationSettingsControllerListQueries } from './booking-verification-settings.list-queries';

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof VerificationSettingsError) {
      // 409, not 400: the request is well-formed, the SYSTEM is not ready for it. A tenant who has not connected
      // Twilio has not made a mistake — they have not finished a prerequisite, and the message says which.
      const status = e.code === 'forbidden' ? HttpStatus.FORBIDDEN : e.code === 'provider_required' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
      throw new HttpException({ code: e.code, message: e.message }, status);
    }
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(BookingVerificationSettingsControllerListQueries)
@Controller('pos/settings/booking-phone-verification')
export class BookingVerificationSettingsController {
  constructor(private readonly svc: BookingVerificationSettingsService, @Optional() @Inject(DATABASE) private readonly db?: AppDatabase | null) {}

  @Get() @RequirePermission('settings.view')
  get(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.get(r?.ctx?.tenantId, branchId || null));
  }

  /** Phase 4: the salon's verification activity — counts, verify rate, per channel, recent failures (masked numbers). */
  @Get('usage') @RequirePermission('settings.view')
  usage(@Req() r: any, @Query('days') days?: string) {
    return bookingVerificationUsage(this.db ?? null, r?.ctx?.tenantId, r?.ctx?.branchId ?? null, Number(days) || 30);
  }

  // `settings.edit` — NOT `settings.view`. Turning verification on or off changes who is able to book this salon
  // at all, so it is not a read-tier action, and a receptionist does not get it by default.
  @Patch() @RequirePermission('settings.edit')
  patch(@Req() r: any, @Body(ValidatedBody(VERIFICATION_SETTINGS_BODY, { strict: true })) body: any) {
    return run(() => this.svc.patch(r?.ctx?.userId, r?.ctx?.tenantId, body?.branchId ?? null, body ?? {}));
  }

  /** Branch override. Same permission — a branch that can silently disable verification is the same hole. */
  @Patch('branches/:branchId') @RequirePermission('settings.edit')
  patchBranch(@Req() r: any, @Param('branchId') branchId: string, @Body(ValidatedBody(VERIFICATION_SETTINGS_BODY, { strict: true })) body: any) {
    return run(() => this.svc.patch(r?.ctx?.userId, r?.ctx?.tenantId, branchId, body ?? {}));
  }
}
