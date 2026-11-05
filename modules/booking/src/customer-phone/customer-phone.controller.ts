// customer-phone.controller.ts — the ONE phone-update surface.
//
// Both frontends land here: the receptionist at the POS and the customer in the app. The only thing that differs
// is `source`, which the pure core turns into a policy (staff may save a pending number; the app verifies first).
//
// The spec's first rule is right, and the audit proved it the hard way: `PATCH /pos/customers/:id` was writing
// `normalized_phone` directly -- no E.164, no duplicate check, no verification, no optimistic lock, no audit. A
// second path is a second set of rules, and the fraud moves to whichever set is weaker. That path is now closed,
// and this is the only one.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { PHONE_MANUAL_CONFIRM_BODY, PHONE_RESOLVE_BODY, PHONE_SEND_BODY, PHONE_START_BODY, PHONE_VERIFY_BODY } from '../request-schemas';
import { phoneUpdateHttpError } from './customer-phone-http';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerPhoneUpdateService, PhoneUpdateError } from './customer-phone-update.service';
import type { Actor } from './customer-phone-core';

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof PhoneUpdateError) throw phoneUpdateHttpError(e);   // one mapping for both controllers
    throw e;
  }
}

const ctxOf = (r: any, source: 'staff_pos' | 'customer_app') => ({
  tenantId: r?.ctx?.tenantId,
  branchId: r?.ctx?.branchId || null,   // the request context carries '' for "no branch" (found by the Phase 3 live proof)
  userId: r?.ctx?.userId ?? '',
  // SERVER-DERIVED. Never from the body: a client that could name its own role could grant itself the manager-only
  // manual-confirmation path.
  role: String(r?.ctx?.role ?? 'RECEPTION') as Actor,
  source,
} as const);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customers/:customerId/phone')
export class CustomerPhoneController {
  constructor(private readonly svc: CustomerPhoneUpdateService) {}

  /** The customer's number, its proof (verified / not / manually confirmed), and any change in flight. */
  @Get('status') @RequirePermission('pos.customers.view')
  status(@Req() r: any, @Param('customerId') customerId: string) {
    return run(() => this.svc.status(ctxOf(r, 'staff_pos'), customerId));
  }

  /** Show the code pad on the customer display (the customer types the code there, not aloud). */
  @Post(':sessionId/to-display') @RequirePermission('pos.customers.edit')
  toDisplay(@Req() r: any, @Param('customerId') customerId: string, @Param('sessionId') sessionId: string) {
    return run(() => this.svc.requestOnDisplay(ctxOf(r, 'staff_pos'), sessionId, customerId));
  }

  /** A manager re-runs a failed synchronisation now. */
  @Post(':sessionId/retry-sync') @RequirePermission('pos.customers.phone.retry_sync')
  retrySync(@Req() r: any, @Param('customerId') customerId: string, @Param('sessionId') sessionId: string) {
    return run(() => this.svc.retrySync(ctxOf(r, 'staff_pos'), sessionId, customerId));
  }

  /** Start: validate, duplicate-check, and (staff flow) save the number as pending. */
  @Post() @RequirePermission('pos.customers.edit')
  start(@Req() r: any, @Param('customerId') customerId: string, @Body(ValidatedBody(PHONE_START_BODY)) b: any) {
    return run(() => this.svc.start(ctxOf(r, 'staff_pos'), {
      customerId,
      newPhone: String(b?.phone ?? ''),
      reason: b?.reason ?? undefined,
      // The version the CLIENT last saw. A stale screen must not overwrite a newer number.
      expectedVersion: b?.expectedVersion != null ? Number(b.expectedVersion) : undefined,
      staffAssertsSharedPhone: !!b?.sharedFamilyPhone,
      idempotencyKey: b?.idempotencyKey ?? undefined,
    }));
  }

  /**
   * A MANAGER resolves a duplicate-number conflict and lets the change proceed (audit E6: there was no route for it).
   * `resolution` and a reason (≥ 12 characters) are recorded. Never merges anybody.
   */
  @Post('resolve') @RequirePermission('pos.customers.phone.resolve')
  resolve(@Req() r: any, @Param('customerId') customerId: string, @Body(ValidatedBody(PHONE_RESOLVE_BODY)) b: any) {
    const resolution = String(b?.resolution ?? '');
    if (!['shared_family_phone', 'different_people', 'same_person_keep_separate'].includes(resolution)) {
      throw new HttpException({ code: 'VALIDATION_FAILED', message: 'resolution must be shared_family_phone, different_people or same_person_keep_separate' }, HttpStatus.BAD_REQUEST);
    }
    return run(() => this.svc.start(ctxOf(r, 'staff_pos'), {
      customerId, newPhone: String(b?.phone ?? ''), reason: b?.reason ?? undefined,
      expectedVersion: b?.expectedVersion != null ? Number(b.expectedVersion) : undefined,
      idempotencyKey: b?.idempotencyKey ?? undefined,
      managerResolution: { resolution: resolution as any, reason: String(b?.reason ?? '') },
    }));
  }

  /** A MANAGER approves a receptionist's change (tenant setting require_manager_approval). */
  @Post(':sessionId/approve') @RequirePermission('pos.customers.phone.approve')
  approve(@Req() r: any, @Param('customerId') customerId: string, @Param('sessionId') sessionId: string) {
    return run(() => this.svc.approve(ctxOf(r, 'staff_pos'), sessionId, customerId));
  }

  @Post(':sessionId/send') @RequirePermission('pos.customers.edit')
  send(@Req() r: any, @Param('customerId') customerId: string, @Param('sessionId') sessionId: string, @Body(ValidatedBody(PHONE_SEND_BODY)) b: any) {
    return run(() => this.svc.sendCode(ctxOf(r, 'staff_pos'), sessionId, String(b?.phone ?? ''), customerId));
  }

  @Post(':sessionId/verify') @RequirePermission('pos.customers.edit')
  verify(@Req() r: any, @Param('customerId') customerId: string, @Param('sessionId') sessionId: string, @Body(ValidatedBody(PHONE_VERIFY_BODY)) b: any) {
    return run(() => this.svc.verify(ctxOf(r, 'staff_pos'), sessionId, String(b?.phone ?? ''), String(b?.code ?? ''), customerId));
  }

  /**
   * Manual confirmation -- a manager vouches for the number WITHOUT an SMS.
   *
   * A DIFFERENT permission from `pos.customers.edit`, deliberately. A receptionist who can edit a customer must not
   * silently also be able to mark a number usable without ever proving it: the receptionist is exactly who a social
   * engineer calls. The service checks the ROLE as well, so the permission cannot be granted around it.
   */
  @Post(':sessionId/manual-confirm') @RequirePermission('pos.customers.phone.manual_confirm')
  manual(@Req() r: any, @Param('customerId') customerId: string, @Param('sessionId') sessionId: string, @Body(ValidatedBody(PHONE_MANUAL_CONFIRM_BODY)) b: any) {
    return run(() => this.svc.manuallyConfirm(ctxOf(r, 'staff_pos'), sessionId, String(b?.phone ?? ''), String(b?.reason ?? ''), customerId));
  }

  @Post(':sessionId/cancel') @RequirePermission('pos.customers.edit')
  cancel(@Req() r: any, @Param('customerId') customerId: string, @Param('sessionId') sessionId: string) {
    return run(async () => { await this.svc.cancel(ctxOf(r, 'staff_pos'), sessionId, customerId); return { ok: true }; });
  }
}
