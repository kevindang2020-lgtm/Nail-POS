// cross-tenant-transfer.executor.ts — D4. An approved transfer now moves somebody.
//
// CROSS-TENANT BY DESIGN: a transfer is, by definition, a write into a tenant the acting session is not inside.
// The authority is SuperAdminGuard on the route that reaches here, and the fact that this file is reachable from
// nowhere else — no POS controller, no tech controller, no owner controller imports it.
//
// == WHAT IT REPLACES =====================================================================================
//
// `decideCrossTransfer` flipped a status column and stopped. Its own comment said so, and the audit row said
// `provisioning: 'deferred'`. The screens all showed "approved". The technician was still at the old salon.
//
// == THE STATUS IT LANDS IN, AND WHY ======================================================================
//
// `pending_tech_approval` — unless the technician asked for the move herself, in which case `active`.
//
// A Super Admin who can silently attach a technician's global identity to a salon she never agreed to work at is
// not an administrator; it is a back door around the consent the salons themselves are required to obtain. The
// platform gets to approve the transfer. It does not get to answer for her.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { GlobalTechIdentityService } from '@aipowersalon/workforce';
import type { CrossTenantTransferExecutor } from './super-admin-staff.service';
import { canMoveToSql } from '@aipowersalon/database';
import { TECH_SALON_MEMBERSHIP } from '@aipowersalon/workforce';

@Injectable()
export class KyselyCrossTenantTransferExecutor implements CrossTenantTransferExecutor {
  constructor(
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null,
    @Optional() @Inject(GlobalTechIdentityService) private readonly identity?: GlobalTechIdentityService,
  ) {}

  async execute(input: {
    requestId: string; userId: string; fromTenantId: string | null; toTenantId: string; toBranchId: string | null;
    requestedBy: string | null; decidedByUserId?: string; requireDestinationApproval?: boolean;
  }): Promise<{ executed: boolean; reason?: string; membershipId?: string; membershipStatus?: string; profileId?: string }> {
    if (!this.db || !this.identity?.available) return { executed: false, reason: 'database_unavailable' };
    const db = this.db;

    // Only a GLOBAL TECHNICIAN has a membership to write. An owner, a manager or a front-desk hire being moved
    // between tenants has no `tech_salon_memberships` row and never will — that is reported as `executed: false`
    // with the reason, never as a success. Half of this codebase's bugs were things that returned 200.
    const u: any = await sql`
      select global_tech_profile_id, role from users where id = ${input.userId} limit 1`.execute(db).catch(() => null);
    const row = u?.rows?.[0];
    if (!row) return { executed: false, reason: 'user_not_found' };
    if (!row.global_tech_profile_id) return { executed: false, reason: 'not_a_global_technician' };
    const profileId = String(row.global_tech_profile_id);

    // A suspended platform account does not get transferred anywhere. Same rule as decideIdentity: a suspension
    // that can be routed around by moving the technician is not a suspension.
    const p: any = await sql`select status from global_tech_profiles where id = ${profileId} limit 1`.execute(db).catch(() => null);
    if (String(p?.rows?.[0]?.status ?? '') !== 'active') return { executed: false, reason: 'account_not_active' };

    const t: any = await sql`select status from tenants where id = ${input.toTenantId} limit 1`.execute(db).catch(() => null);
    if (String(t?.rows?.[0]?.status ?? '') !== 'active') return { executed: false, reason: 'target_salon_inactive' };

    // Operational blocks at the SOURCE salon (§10): you do not move somebody out mid-service, or with a cash handoff
    // still unreconciled. These fire only when a source tenant is in play (a move/departure), not an add-a-salon.
    if (input.fromTenantId) {
      // ONE implementation shared with the technician-requested transfer (GlobalTechIdentityService.departureBlocker)
      const blocked = await this.identity.departureBlocker(db, profileId, input.fromTenantId);
      if (blocked) return { executed: false, reason: blocked.code };
    }

    // She asked for it herself → her consent is already on the record and the move is immediate.
    const selfRequested = !!input.requestedBy && input.requestedBy === input.userId;
    // If the destination salon must sign off, the new membership waits on THEM first (pending_salon_approval); otherwise
    // it goes straight to the technician's own consent gate. A self-requested move needs neither and is immediate.
    const status = selfRequested ? 'active' : (input.requireDestinationApproval ? 'pending_salon_approval' : 'pending_tech_approval');

    const existing: any = await sql`
      select id, status from tech_salon_memberships
       where global_tech_profile_id = ${profileId} and tenant_id = ${input.toTenantId}
         and branch_id is not distinct from ${input.toBranchId} limit 1`.execute(db).catch(() => null);

    if (existing?.rows?.length && existing.rows[0].status === 'active') {
      return { executed: false, reason: 'already_active_at_target', membershipId: String(existing.rows[0].id), profileId };
    }

    const identity = this.identity;
    // ONE transaction: the membership write, its materialization (login + roster row + branch grant) and — for an
    // immediate move — the departure from the source salon. A failure anywhere leaves her exactly where she was.
    const membershipId: string = await db.transaction().execute(async (trx: any) => {
      let id: string;
      if (existing?.rows?.length) {
        id = String(existing.rows[0].id);
        await sql`
          update tech_salon_memberships set
            status = ${status}, transfer_from_tenant_id = ${input.fromTenantId}, transfer_request_id = ${input.requestId},
            approved_by_user_id = ${input.decidedByUserId ?? null},
            start_date = case when ${status} = 'active' then now() else start_date end, updated_at = now()
          where id = ${id} and tenant_id = ${input.toTenantId} and ${canMoveToSql(TECH_SALON_MEMBERSHIP, status)}`.execute(trx);
      } else {
        const ins: any = await sql`
          insert into tech_salon_memberships
            (global_tech_profile_id, tenant_id, branch_id, status, role_label, requested_by_user_id,
             approved_by_user_id, transfer_from_tenant_id, transfer_request_id, start_date)
          values (${profileId}, ${input.toTenantId}, ${input.toBranchId}, ${status}, 'Technician',
                  ${input.requestedBy}, ${input.decidedByUserId ?? null}, ${input.fromTenantId}, ${input.requestId},
                  ${status === 'active' ? sql`now()` : sql`null`})
          returning id`.execute(trx);
        id = String(ins.rows[0].id);
      }

      // An ACTIVE membership needs a login and a roster row, or it is a technician employed somewhere she cannot
      // sign in to and who appears on no schedule. A PENDING one gets neither until she accepts — the salon does
      // not get to put her on its roster on the strength of a decision she has not made.
      if (status === 'active') {
        await identity.materializeMembership(input.toTenantId, id, trx);
        if (input.fromTenantId) {
          await identity.endEmployment(trx, {
            profileId, tenantId: input.fromTenantId, reason: 'transferred', requestId: input.requestId,
            actorUserId: input.decidedByUserId ?? null, actorRole: 'SUPER_ADMIN',
          });
        }
      }
      return id;
    });

    // post-commit half of the departure: the shared revoke chain (Clock PIN, access-revoked audit, realtime nudge)
    if (status === 'active' && input.fromTenantId) {
      await identity.afterDeparture({ profileId, tenantId: input.fromTenantId, reason: 'transferred', actorUserId: input.decidedByUserId ?? null, actorRole: 'SUPER_ADMIN', source: 'super_admin_cross_tenant_transfer' });
    }

    return { executed: true, membershipId, membershipStatus: status, profileId };
  }

  /**
   * The departure. It happens on ARRIVAL, never on approval.
   *
   * Ending the old employment when the transfer was merely APPROVED would fire a technician from a job she still
   * has, on the strength of a move she has not accepted — and if she then declines, she is employed nowhere. So
   * when the new membership is still `pending_tech_approval`, this is not called; TechWorkplacesService.accept
   * calls it if and when she says yes.
   */
  async endSourceEmployment(profileId: string, fromTenantId: string, requestId: string | null, actorUserId: string | null = null) {
    if (!this.db || !this.identity?.available) return;
    const identity = this.identity;
    // ONE implementation of "end the employment" — GlobalTechIdentityService.endEmployment (membership former, roster
    // row inactive, login inactive, branch grants gone, sessions revoked) — shared with TechWorkplacesService.accept.
    await this.db.transaction().execute((trx: any) =>
      identity.endEmployment(trx, { profileId, tenantId: fromTenantId, reason: 'transferred', requestId, actorUserId, actorRole: 'SUPER_ADMIN' }));
    await identity.afterDeparture({ profileId, tenantId: fromTenantId, reason: 'transferred', actorUserId, actorRole: 'SUPER_ADMIN', source: 'super_admin_cross_tenant_transfer' });
  }
}
