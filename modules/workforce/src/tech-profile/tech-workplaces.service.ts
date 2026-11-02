// tech-workplaces.service.ts — the technician's own list of salons, and their consent.
//
// CROSS-TENANT BY DESIGN: a technician's employment relationships span salons — that is the definition of the
// feature. Authorization here is NOT by tenant; it is by GLOBAL PROFILE OWNERSHIP. The profile id is derived
// from the verified session (the technicians row in the session's own tenant) and never read from the request,
// so a technician can only ever act on memberships that are their own. A tampered membershipId belonging to
// another technician matches nothing, because every statement carries
//
//     and global_tech_profile_id = <the profile the SESSION resolves to>
//
// That predicate is to this file what `tenant_id` is to the rest of the codebase, and it is enforced on every
// row this file touches.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TechProfileError, type TechProfileCtx } from './tech-profile.service';
import { GlobalTechIdentityService } from './global-tech-identity.service';
import { decideTechSwitch, isEmployed, needsSalonAction, needsTechAction, type SwitchableWorkplace, type TechSwitchDecision } from './global-tech-identity-core';
import { effectiveTechPermissions } from '@aipowersalon/permissions';
import { permissionsFor, type Role } from '@aipowersalon/permissions';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { TECH_SALON_MEMBERSHIP } from '../workforce-lifecycles';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export interface Workplace {
  membershipId: string;
  tenantId: string;
  salonName: string;
  branchId: string | null;
  status: string;
  roleLabel: string | null;
  isCurrentSession: boolean;
  canWorkHere: boolean;
  awaitingMe: boolean;
  awaitingSalon: boolean;
  startedAt: string | null;
}

@Injectable()
export class TechWorkplacesService {
  constructor(
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null,
    @Optional() @Inject(GlobalTechIdentityService) private readonly identity?: GlobalTechIdentityService,
  ) {}

  private need(): NonNullable<AppDatabase> {
    if (!this.db) throw new TechProfileError('unavailable', 'Workplaces require a database.');
    return this.db;
  }

  /**
   * The technician's global profile, resolved from the SESSION.
   *
   * This is the authorization root of the whole file. It reads the technicians row in the session's own tenant
   * — the one tenant we know this session is entitled to — and takes the profile id from there. Nothing about
   * which profile is being acted on ever comes from the client.
   */
  private async myProfileId(ctx: TechProfileCtx): Promise<string> {
    const r: any = await sql`
      select global_tech_profile_id from technicians
       where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId} and is_active = true
       limit 1`.execute(this.need());
    const id = r?.rows?.[0]?.global_tech_profile_id;
    if (!id) throw withCode(new TechProfileError('not_technician', 'No technician profile is linked to this account.'), 'NO_TECHNICIAN_PROFILE');
    return String(id);
  }

  /** GET /tech/workplaces — every salon this technician has a relationship with, and what it needs from them. */
  async list(ctx: TechProfileCtx): Promise<{ workplaces: Workplace[] }> {
    const profileId = await this.myProfileId(ctx);
    const r: any = await sql`
      select m.id, m.tenant_id, m.branch_id, m.status, m.role_label, m.start_date, t.display_name
        from tech_salon_memberships m
        join tenants t on t.id = m.tenant_id
       where m.global_tech_profile_id = ${profileId}
       order by (m.status = 'active') desc, t.display_name asc`.execute(this.need());

    return {
      workplaces: (r?.rows ?? []).map((m: any): Workplace => ({
        membershipId: String(m.id),
        tenantId: String(m.tenant_id),
        salonName: String(m.display_name ?? 'Salon'),
        branchId: m.branch_id ? String(m.branch_id) : null,
        status: String(m.status),
        roleLabel: m.role_label ?? null,
        isCurrentSession: String(m.tenant_id) === ctx.tenantId,
        canWorkHere: isEmployed(m.status),
        awaitingMe: needsTechAction(m.status),
        awaitingSalon: needsSalonAction(m.status),
        startedAt: m.start_date ? new Date(m.start_date).toISOString() : null,
      })),
    };
  }

  /**
   * POST /tech/workplaces/:membershipId/accept — the technician says yes to a salon.
   *
   * This is the counterpart to the salon's approval, and it is the reason a manager typing a known phone number
   * cannot simply conscript an existing technician: the salon gets its employment record immediately, but the
   * technician's GLOBAL identity — their followers, portfolio, rating, public page — only attaches to that
   * salon when the technician themselves taps accept.
   *
   * The salon must still be active. A technician cannot be walked into a suspended or cancelled tenant.
   */
  async accept(ctx: TechProfileCtx, membershipId: string) {
    const db = this.need();
    const profileId = await this.myProfileId(ctx);

    const m: any = await sql`
      select m.id, m.tenant_id, m.status, m.transfer_from_tenant_id, m.transfer_request_id,
             t.display_name, t.status as tenant_status, p.status as profile_status
        from tech_salon_memberships m
        join tenants t on t.id = m.tenant_id
        join global_tech_profiles p on p.id = m.global_tech_profile_id
       where m.id = ${membershipId} and m.global_tech_profile_id = ${profileId} limit 1`.execute(db);
    const row = m?.rows?.[0];
    if (!row) throw withCode(new TechProfileError('not_found', 'That salon invitation is not yours or no longer exists.'), 'INVITATION_NOT_FOUND');
    if (!needsTechAction(row.status)) throw withCode(new TechProfileError('invalid_state', `This workplace is already ${row.status}.`), 'WORKPLACE_STATE_INVALID');
    if (String(row.tenant_status) !== 'active') throw withCode(new TechProfileError('invalid', 'That salon is not active on AIPowerSalon.'), 'SALON_NOT_ACTIVE');
    // A paused / locked / suspended account does not join a salon by accepting an invitation — the same rule that
    // keeps decideIdentity from linking one and the transfer executor from moving one.
    if (String(row.profile_status) !== 'active') throw withCode(new TechProfileError('invalid_state', 'Your AIPowerSalon account is not active. Contact support.'), 'ACCOUNT_NOT_ACTIVE');

    const tenantId = String(row.tenant_id);
    const fromTenantId = row.transfer_from_tenant_id ? String(row.transfer_from_tenant_id) : null;

    // ONE transaction: the membership goes active, it gets its login + roster row + branch grant, and — if this was
    // a transfer — the old salon's employment ends. Either all of it, or she is still exactly where she was. It used
    // to be three separate statements; a materialize that failed left an "active" employee with no roster row.
    await db.transaction().execute(async (trx: any) => {
      await sql`
        update tech_salon_memberships
           set status = 'active', start_date = coalesce(start_date, now()), updated_at = now()
         where id = ${membershipId} and global_tech_profile_id = ${profileId} and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'active')} and status = ${String(row.status)}`.execute(trx)
        .then((r: any) => { if (!Number(r?.numAffectedRows ?? r?.numUpdatedRows ?? 0)) throw new InvalidStateTransitionError(TECH_SALON_MEMBERSHIP, null, 'active', 'concurrent'); });

      // An active membership needs a login and a roster row at that salon, or she is employed somewhere she cannot
      // sign in to and appears on no schedule. Same primitive the Super Admin transfer executor uses.
      if (this.identity?.available) {
        try {
          await this.identity.materializeMembership(tenantId, membershipId, trx);
        } catch (e: any) {
          if (e?.name === 'GlobalTechIdentityError') throw new TechProfileError(e.code, e.message);
          throw e;
        }
      }

      // THE DEPARTURE, and it happens HERE — on arrival, never on approval.
      //
      // If this membership carries a transfer intent, the old salon's employment ends now that the new one is real.
      // Ending it any earlier would have fired her from a job she still had, on the strength of a move she had not
      // accepted yet; if she had then declined, she would have been employed nowhere.
      if (fromTenantId && this.identity?.available) {
        await this.identity.endEmployment(trx, {
          profileId, tenantId: fromTenantId, reason: 'transferred', requestId: row.transfer_request_id ?? null,
          actorUserId: ctx.userId, actorRole: 'TECHNICIAN',
        });
      } else if (fromTenantId) {
        await sql`
          update tech_salon_memberships set
            status = 'former', end_date = coalesce(end_date, now()), ended_reason = 'transferred', updated_at = now()
          where global_tech_profile_id = ${profileId} and tenant_id = ${fromTenantId} and status = 'active' and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'former')}`.execute(trx);
      }

      await sql`
        insert into technician_audit_logs (tenant_id, branch_id, technician_id, user_id, action, metadata)
        select ${tenantId}, null, null, ${ctx.userId}, 'tech_accepted_salon_invite',
               ${JSON.stringify({ membershipId, profileId, transferFromTenantId: fromTenantId })}::jsonb`.execute(trx).catch(() => {});
    });

    // post-commit half of the departure: the shared revoke chain (Clock PIN, access-revoked audit, realtime nudge)
    if (fromTenantId && this.identity?.available) {
      await this.identity.afterDeparture({ profileId, tenantId: fromTenantId, reason: 'transferred', actorUserId: ctx.userId, actorRole: 'TECHNICIAN', source: 'tech_transfer_accept' });
    }

    return { ok: true as const, status: 'active' as const, salonName: String(row.display_name ?? 'Salon') };
  }

  /**
   * POST /tech/workplaces/:membershipId/decline — the technician says no.
   *
   * 'cancelled', not 'rejected'. A technician declining a salon is not a salon rejecting a technician, and
   * writing the latter would leave a rejection on their record that no salon ever issued.
   */
  async decline(ctx: TechProfileCtx, membershipId: string) {
    const db = this.need();
    const profileId = await this.myProfileId(ctx);

    const m: any = await sql`
      select id, tenant_id, status from tech_salon_memberships
       where id = ${membershipId} and global_tech_profile_id = ${profileId} limit 1`.execute(db);
    const row = m?.rows?.[0];
    if (!row) throw withCode(new TechProfileError('not_found', 'That salon invitation is not yours or no longer exists.'), 'INVITATION_NOT_FOUND');
    if (!needsTechAction(row.status)) throw withCode(new TechProfileError('invalid_state', `This workplace is already ${row.status}.`), 'WORKPLACE_STATE_INVALID');

    await sql`
      update tech_salon_memberships set status = 'cancelled', end_date = now(), updated_at = now()
       where id = ${membershipId} and global_tech_profile_id = ${profileId} and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'cancelled')} and status = ${String(row.status)}`.execute(db)
      .then((r: any) => { if (!Number(r?.numAffectedRows ?? r?.numUpdatedRows ?? 0)) throw new InvalidStateTransitionError(TECH_SALON_MEMBERSHIP, null, 'cancelled', 'concurrent'); });

    await sql`
      insert into technician_audit_logs (tenant_id, branch_id, technician_id, user_id, action, metadata)
      select ${row.tenant_id}, null, null, ${ctx.userId}, 'tech_declined_salon_invite',
             ${JSON.stringify({ membershipId, profileId })}::jsonb`.execute(db).catch(() => {});

    return { ok: true as const, status: 'cancelled' as const };
  }

  // ── switching salon ──────────────────────────────────────────────────────────────────────────────────

  /**
   * The rows the SWITCH decision is made from. Resolved from the session's own global profile — nothing here is
   * built from the request body.
   *
   * This joins to the technician's `users` row IN EACH SALON, because under option (b) that row IS the identity
   * the switched session becomes. Its role and its status are read from the TARGET salon, so a salon that
   * suspended a technician's login has, by that act alone, closed the switch into it.
   */
  private async switchable(profileId: string): Promise<SwitchableWorkplace[]> {
    const r: any = await sql`
      select m.tenant_id, m.branch_id, m.status, t.display_name, t.status as tenant_status,
             u.id as user_id, u.status as user_status, u.role as user_role
        from tech_salon_memberships m
        join tenants t on t.id = m.tenant_id
        left join users u on u.tenant_id = m.tenant_id and u.global_tech_profile_id = m.global_tech_profile_id
       where m.global_tech_profile_id = ${profileId}`.execute(this.need());

    return (r?.rows ?? []).map((x: any): SwitchableWorkplace => ({
      tenantId: String(x.tenant_id),
      branchId: x.branch_id ? String(x.branch_id) : null,
      salonName: String(x.display_name ?? 'Salon'),
      status: String(x.status),
      tenantStatus: String(x.tenant_status ?? ''),
      userId: x.user_id ? String(x.user_id) : null,
      userStatus: x.user_status ? String(x.user_status) : null,
      role: x.user_role ? String(x.user_role) : null,
    }));
  }

  /**
   * POST /tech/context/switch — resolve which salon this technician may become active in.
   *
   * == WHAT THIS CHANGES, AND YOU SHOULD KNOW IT ==========================================================
   *
   * The switched session's SUBJECT changes: `userId` becomes the technician's `users` row in the TARGET salon.
   * That is what option (b) requires — each salon has its own login row — and it means one authentication at
   * one salon yields a session at every salon the technician is actively employed at and has consented to.
   *
   * So: ONE password now protects ALL of a technician's salons. That is the same property the Owner app has
   * had since it shipped (one login, many salons, `decideSwitch` validates membership), and it is what "switch
   * between active salon relationships in the app" means. If you want Salon B's password demanded on every
   * switch, this method is where that decision goes — say so and it becomes a re-login prompt instead.
   *
   * What is NOT carried across is authority: the session takes the TARGET salon's role, and the caller derives
   * permissions from that role. Salon A granting payment rights cannot smuggle them into Salon B.
   */
  async switchTarget(ctx: TechProfileCtx, requestedTenantId: string): Promise<TechSwitchDecision> {
    const profileId = await this.myProfileId(ctx);

    // A platform-suspended technician does not switch anywhere. A suspension a technician can step around by
    // tapping a different salon is not a suspension.
    const p: any = await sql`select status from global_tech_profiles where id = ${profileId} limit 1`.execute(this.need());
    const status = String(p?.rows?.[0]?.status ?? '');
    if (status !== 'active') {
      return { ok: false, reason: 'access_suspended', message: 'Your AIPowerSalon account is not active. Contact support.' };
    }

    return decideTechSwitch(await this.switchable(profileId), String(requestedTenantId ?? ''));
  }

  /** Append-only. Switching salon is security-relevant: it is how a technician moves between businesses. */
  async recordSwitch(ctx: TechProfileCtx, target: { tenantId: string; branchId: string | null; userId: string }) {
    await sql`
      insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${target.tenantId}, ${target.branchId}, ${target.userId}, 'TECHNICIAN', 'tech.salon_switched',
              'tenant', ${target.tenantId}, ${JSON.stringify({ fromTenantId: ctx.tenantId })}::jsonb)`
      .execute(this.need()).catch(() => {});   // auditing must never block the switch itself
  }
  /**
   * The permissions the switched session carries AT THE TARGET SALON.
   *
   * Not the source salon's. Salon A granting `pos.tech.process_payment` must not follow the technician into
   * Salon B, which granted nothing — and Salon B REVOKING something the role grants by default must survive the
   * switch too, or a technician suspended from taking payments at B could restore the right by tapping away to A
   * and back.
   *
   * Fail-safe: a lookup failure falls back to the role defaults. It can widen nothing.
   */
  async permissionsAtTarget(tenantId: string, userId: string, role: string): Promise<string[]> {
    const base = permissionsFor(role as Role);
    if (role !== 'TECHNICIAN') return base;
    try {
      const r: any = await sql`
        select p.permission_key, p.allowed
          from technician_permissions p
          join technicians t on t.id = p.technician_id and t.tenant_id = p.tenant_id
         where p.tenant_id = ${tenantId} and t.user_id = ${userId}`.execute(this.need());
      return effectiveTechPermissions(base, (r?.rows ?? []).map((x: any) => ({ permission: String(x.permission_key), allowed: !!x.allowed })));
    } catch {
      return base;
    }
  }

}
