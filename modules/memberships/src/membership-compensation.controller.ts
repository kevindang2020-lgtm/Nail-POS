// membership-compensation.controller.ts — tenant surface to book membership-redemption commission for a ticket into the
// compensation_adjustments ledger (`POST /pos/memberships/compensation/book/:ticketId`). Guards: TenantAuthGuard +
// RolePermissionGuard; requires pos.memberships.manage. The literal `compensation/book/:ticketId` path does not collide
// with the overview/plans or enroll controllers that share the /pos/memberships base. Intended to be called at checkout
// finalize for the ticket; the operation is idempotent.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature } from '@aipowersalon/permissions/guards';
import { Controller, Post, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MembershipCompService, ValidationError } from './membership-compensation.service';
import type { MembershipCompContext } from './membership-compensation.repository';

function ctxFrom(req: any): MembershipCompContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('memberships')   // BUILD_PLAN Phase 12 (#13): plan-gated — observe by default (feature-entitlement.ts)
@Controller('pos/memberships')
export class MembershipCompController {
  constructor(private readonly svc: MembershipCompService) {}

  @Post('compensation/book/:ticketId') @RequirePermission('pos.memberships.manage')
  book(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.bookTicketMembershipComp(ctxFrom(r), id)); }
}
