// salon-staff-invitations.controller.ts — wave 4 pilot P3: the salon invites its own front desk / manager.
//   POST /pos/access/invitations   { email | phone, fullName, role: RECEPTION | RECEPTIONIST | FRONT_DESK | MANAGER, branchId?, channel? }
//                                  [roles.manage]  → the SAME invitation the Super Admin sends (user_invitations, delivery,
//                                  public accept), always into the caller's own salon, within the caller's own permissions.
//                                  every role → needs a fresh step-up (403 STEP_UP_REQUIRED; POST /auth/step-up) — §59.
import { Body, Controller, Inject, Optional, Post, Req, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { STEP_UP_DEFAULT_SECONDS } from '@aipowersalon/permissions/guards';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminPlatformService } from './super-admin-platform.service';
import { run } from './super-admin-platform.controller';
import { PL_INVITATION_BODY } from '../request-schemas-platform';

const actorOf = (req: any) => { const c = req?.ctx || {}; return { tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: Array.isArray(c.permissions) ? c.permissions : [], branchId: c.branchId ?? null }; };

/** The session's step-up stamp — the SAME sessions row (and window) apps/api StepUpGuard reads. Fail closed. */
export function sessionStepUpFresh(db: any, req: any, maxAgeSeconds: number = STEP_UP_DEFAULT_SECONDS): () => Promise<boolean> {
  return async () => {
    const sid = req?.sessionId ?? req?.ctx?.sessionId ?? null; const userId = req?.ctx?.userId ?? null;
    if (!db || !sid || !userId) return false;
    const r: any = await sql`select (last_step_up_at is not null and last_step_up_at > now() - (${maxAgeSeconds} * interval '1 second')) as fresh
                               from sessions where id = ${sid} and user_id = ${userId} and revoked_at is null limit 1`.execute(db);
    return !!r?.rows?.[0]?.fresh;
  };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/access/invitations')
export class SalonStaffInvitationsController {
  constructor(private readonly svc: SuperAdminPlatformService, @Optional() @Inject(DATABASE) private readonly db?: any) {}

  // Security Deep Scan §59: every staff invitation mints an account into a role — step-up for all of them (the service's
  // own manager check below stays as a second, permission-derived line).
  @Post('') @RequirePermission('roles.manage') @RequireStepUp()
  invite(@Req() r: any, @Body(ValidatedBody(PL_INVITATION_BODY, { strict: true })) b: any) { return run(() => this.svc.inviteSalonStaff({ ...actorOf(r), stepUpFresh: sessionStepUpFresh(this.db, r) }, b ?? {})); }
}
