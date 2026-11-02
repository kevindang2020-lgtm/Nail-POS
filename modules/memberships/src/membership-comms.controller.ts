// membership-comms.controller.ts — tenant surface for member comms. `comms/reminders/run` powers the POS "Send Reminder"
// action (renewal-reminder sweep); `comms/members/:membershipId/reminder` sends a single member's reminder. Guards:
// TenantAuthGuard + RolePermissionGuard; requires pos.memberships.manage. The literal `comms/...` paths don't collide
// with the other controllers under /pos/memberships.
import { ListQuery } from '@aipowersalon/database';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { REMINDERS_BODY } from './request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MembershipCommsService, ValidationError } from './membership-comms.service';
import type { CommsContext } from './membership-comms.repository';

function ctxFrom(req: any): CommsContext {
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
export class MembershipCommsController {
  constructor(private readonly svc: MembershipCommsService) {}

  // Membership Overview mandate (Oct 29 2026): preview before Send Reminder (who, how many, already reminded) — sends nothing
  @Get('comms/reminders/preview') @RequirePermission('pos.memberships.manage')
  @ListQuery({ filters: { withinDays: { type: 'int', min: 1, max: 60 } }, search: false, maxLimit: 200, defaultLimit: 200 })
  previewReminders(@Req() r: any, @Query() q: any) { return run(() => this.svc.previewRenewalReminders(ctxFrom(r), Number(q?.withinDays) || 7)); }

  @Post('comms/reminders/run') @RequirePermission('pos.memberships.manage')
  runReminders(@Req() r: any, @Body(ValidatedBody(REMINDERS_BODY, { strict: true })) b: any) { return run(() => this.svc.runRenewalReminders(ctxFrom(r), Number(b?.withinDays) || 7)); }

  @Post('comms/members/:membershipId/reminder') @RequirePermission('pos.memberships.manage')
  reminder(@Req() r: any, @Param('membershipId') id: string) { return run(() => this.svc.sendRenewalReminder(ctxFrom(r), id)); }
}
