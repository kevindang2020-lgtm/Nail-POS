// membership-enroll.controller.ts — tenant Memberships enrollment/redemption surface (`/pos/memberships/*`). Guards:
// TenantAuthGuard + RolePermissionGuard; tenant/branch/role come from req.ctx (session). Enroll/reserve/redeem/release
// require pos.memberships.manage; lookups require pos.memberships.view. These paths do not collide with the overview /
// plans controller (members/*, customers/*, and the enroll/reserve/redeem/release verbs are distinct).
import { Idempotent } from '@aipowersalon/database/nest';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CANCEL_BODY, ENROLL_BODY, MEMBERS_BY_CUSTOMERS_BODY, PAUSE_BODY, REDEEM_BODY, RELEASE_BODY, RESERVE_BODY, RESUME_BODY } from './request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MembershipEnrollService, ForbiddenError, ValidationError, ConcurrencyError, type EnrollRequest, type ReserveRequest, type RedeemRequest } from './membership-enroll.service';
import type { EnrollContext } from './membership-enroll.repository';

function ctxFrom(req: any): EnrollContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
export async function runMembershipRoute<T>(fn: () => T | Promise<T>): Promise<T> { return run(fn); }   // for tests
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    // Constitution 5 §57: every stale edit answers VERSION_CONFLICT, so every app shows the same refresh prompt
    if (e instanceof ConcurrencyError) throw new HttpException({ code: 'VERSION_CONFLICT', message: e.message }, HttpStatus.CONFLICT);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('memberships')   // BUILD_PLAN Phase 12 (#13): plan-gated — observe by default (feature-entitlement.ts)
@Controller('pos/memberships')
export class MembershipEnrollController {
  constructor(private readonly svc: MembershipEnrollService) {}

  @Idempotent() @Post('enroll') @RequirePermission('pos.memberships.manage')   // D6: a double tap / retry enrolls once
  enroll(@Req() r: any, @Body(ValidatedBody(ENROLL_BODY, { strict: true })) b: EnrollRequest) { return run(() => this.svc.enroll(ctxFrom(r), b)); }

  @Get('customers/:customerId/memberships') @RequirePermission('pos.memberships.view')
  customerMemberships(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.listCustomerMemberships(ctxFrom(r), id)); }

  // Batch member-status for a list of customers (one query). Read-only, so view permission; POST carries the id array.
  @Post('members/by-customers') @RequirePermission('pos.memberships.view')
  membersByCustomers(@Req() r: any, @Body(ValidatedBody(MEMBERS_BY_CUSTOMERS_BODY, { strict: true })) body: { customerIds?: string[] }) { return run(() => this.svc.membershipsByCustomers(ctxFrom(r), body?.customerIds ?? [])); }

  @Get('members/:membershipId/benefits') @RequirePermission('pos.memberships.view')
  benefits(@Req() r: any, @Param('membershipId') id: string) { return run(() => this.svc.getMembershipBenefits(ctxFrom(r), id)); }

  @Get('coverage/:ticketId') @RequirePermission('pos.memberships.view')
  coverage(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.coverage(ctxFrom(r), id)); }

  @Post('reserve') @RequirePermission('pos.memberships.manage')
  reserve(@Req() r: any, @Body(ValidatedBody(RESERVE_BODY, { strict: true })) b: ReserveRequest) { return run(() => this.svc.reserveBenefit(ctxFrom(r), b)); }

  @Post('release') @RequirePermission('pos.memberships.manage')
  release(@Req() r: any, @Body(ValidatedBody(RELEASE_BODY, { strict: true })) b: { reservationRef: string }) { return run(() => this.svc.releaseBenefit(ctxFrom(r), b?.reservationRef)); }

  @Post('redeem') @RequirePermission('pos.memberships.manage')
  redeem(@Req() r: any, @Body(ValidatedBody(REDEEM_BODY, { strict: true })) b: RedeemRequest) { return run(() => this.svc.redeemBenefit(ctxFrom(r), b)); }

  // Lifecycle — cancel (auto_renew off; at-period-end keeps benefits until the paid period ends, or immediate), pause,
  // resume. Status change only; no charge and no refund. Optimistic concurrency: a stale expectedVersion returns 409.
  @Post('cancel') @RequirePermission('pos.memberships.manage')
  cancel(@Req() r: any, @Body(ValidatedBody(CANCEL_BODY, { strict: true })) b: { membershipId: string; atPeriodEnd?: boolean; reason?: string | null; expectedVersion?: number }) {
    return run(() => this.svc.cancelMembership(ctxFrom(r), b?.membershipId, { atPeriodEnd: b?.atPeriodEnd, reason: b?.reason ?? null, expectedVersion: b?.expectedVersion }));
  }

  @Post('pause') @RequirePermission('pos.memberships.manage')
  pause(@Req() r: any, @Body(ValidatedBody(PAUSE_BODY, { strict: true })) b: { membershipId: string; resumesAt?: string | null; expectedVersion?: number }) {
    return run(() => this.svc.pauseMembership(ctxFrom(r), b?.membershipId, { resumesAt: b?.resumesAt ?? null, expectedVersion: b?.expectedVersion }));
  }

  @Post('resume') @RequirePermission('pos.memberships.manage')
  resume(@Req() r: any, @Body(ValidatedBody(RESUME_BODY, { strict: true })) b: { membershipId: string; expectedVersion?: number }) {
    return run(() => this.svc.resumeMembership(ctxFrom(r), b?.membershipId, { expectedVersion: b?.expectedVersion }));
  }
}
