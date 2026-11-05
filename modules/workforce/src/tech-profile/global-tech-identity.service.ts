// global-tech-identity.service.ts — one permanent technician identity, and the salon links UP to it.
//
// This file carries NO cross-tenant exemption, on purpose. Every write here names its tenant_id and is
// therefore still policed by check:tenant. The only cross-tenant reads live in global-tech-directory.kysely.ts,
// which is three SELECTs long precisely so that its exemption cannot hide anything.
//
// == THE ORDER OF OPERATIONS, AND WHY IT IS SAFE TO FAIL ===================================================
//
// The manager's create flow is: repo.create() writes the salon's `technicians` row → then attachToTechnician()
// resolves the global identity. If the second step throws, what is left behind is a `technicians` row with no
// global identity — which is EXACTLY the state every technician in the database is in today, is handled by
// the existing lazy `getOrCreateMyProfile`, and is repaired by scripts/backfill-global-tech.ts.
//
// The reverse order would leave a global profile and a login for a person nobody hired. Between an orphan
// employment record and an orphan human identity, only one of them is harmless.
import { mintInvitationToken, invitationExpiry, InvitationDelivery, KyselyInvitationDeliverySink, acceptUrl, SESSION, USER_ACCOUNT } from '@aipowersalon/identity';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyAuditRepository } from '@aipowersalon/audit';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { GlobalTechDirectory } from './global-tech-directory.kysely';
import { slugify } from './tech-profile-core';
import { portalUrl } from '@aipowersalon/config';
import { revokeTechnicianAccess } from '../technicians/revoke-technician-access';
import { recordEmploymentEvent, hasEndedBefore, hasHireEvent } from '../technicians/employment-history';
import { defaultCommissionForTenant } from '../compensation/compensation-rule-loader';
import {
  branchRoleForLabel, decideIdentity, formatTechCode, GlobalTechIdentityError, identityKeys, isEndedMembership,
  managerLookupView, splitName, type ManagerLookupView, type MembershipStatus,
} from './global-tech-identity-core';
import { assertTransition, canMoveToSql } from '@aipowersalon/database';
import { TECH_SALON_MEMBERSHIP } from '../workforce-lifecycles';

export { GlobalTechIdentityError } from './global-tech-identity-core';

export interface IdentityCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }

export interface AttachInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  roleLabel?: string | null;
}

export interface AttachResult {
  profileId: string;
  techCode: string;
  userId: string;
  membershipId: string;
  membershipStatus: MembershipStatus;
  /** true → this human already had an AIPowerSalon account and we linked it instead of minting a second one. */
  linkedExistingProfile: boolean;
  matchedOn: 'phone' | 'email' | null;
  invite: {
    created: boolean; tokenPrefix: string | null; reason: string | null;
    /** What ACTUALLY happened to it. `not_connected` is not `sent`, and this never says it is. */
    channel?: 'email' | 'sms' | null;
    deliveryStatus?: 'delivered' | 'failed' | 'not_connected' | null;
    /** Returned ONLY when delivery failed, so a human can hand the link over. */
    manualToken?: string | null;
    /**
     * The same thing, ready to paste. A `manualToken` that no screen ever shows is an honest fallback nobody can
     * use — which is just a dead end with better manners.
     */
    acceptUrl?: string | null;
  };
}

const rand = () => Math.random().toString(36).slice(2, 6);

/** The ONE delete of a technician's `user_branch_access` grants at a salon (`branchId` null → every branch). Standalone
 *  so the departure paths that may not hold the Nest service (TechProfileService.posDeactivateMembership) still run it. */
export async function revokeBranchAccessRows(trx: any, tenantId: string, userId: string, branchId: string | null): Promise<void> {
  await sql`
    delete from user_branch_access
     where tenant_id = ${tenantId} and user_id = ${userId} and access_level = 'staff'
       and (${branchId}::uuid is null or branch_id = ${branchId}::uuid)`.execute(trx);
}

@Injectable()
export class GlobalTechIdentityService {
  constructor(
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null,
    @Optional() private readonly directory?: GlobalTechDirectory,
  ) {}

  private need(): NonNullable<AppDatabase> {
    if (!this.db) throw new GlobalTechIdentityError('unavailable', 'Technician identity requires a database.');
    return this.db;
  }
  private dir(): GlobalTechDirectory {
    if (!this.directory) throw new GlobalTechIdentityError('unavailable', 'Technician directory is not configured.');
    return this.directory;
  }

  get available(): boolean { return !!this.db && !!this.directory; }

  // ── POST /pos/technicians/lookup ───────────────────────────────────────────────────────────────────────

  /**
   * "Does this person already have an AIPowerSalon account?" — asked by the manager BEFORE creating anybody.
   *
   * The answer is shaped by managerLookupView(), which hands back the technician's own public identity and a
   * COUNT of their salons — never the names of the salons. A manager asking whether someone already exists is
   * not asking where else they work, and only the first of those is their question to ask.
   */
  async lookupForManager(ctx: IdentityCtx, input: { phone?: string; email?: string }): Promise<ManagerLookupView | { found: false }> {
    if (!this.available) return { found: false };
    const keys = identityKeys(input);
    if (!keys.phoneHash && !keys.emailNormalized) return { found: false };
    const found = await this.dir().findByKeys(keys);
    if (!found) return { found: false };
    const row = await this.dir().loadRow(found.profileId);
    if (!row) return { found: false };
    return managerLookupView(row, ctx.tenantId);
  }

  // ── the permanent id ───────────────────────────────────────────────────────────────────────────────────

  /** Sequence-backed, so a code is never handed out twice — not even after a deletion. */
  private async allocateTechCode(trx: any): Promise<string> {
    const r: any = await sql`select nextval('global_tech_code_seq') as n`.execute(trx);
    return formatTechCode(Number(r.rows[0].n));
  }

  // ── the manager create path ────────────────────────────────────────────────────────────────────────────

  /**
   * Give a freshly-created `technicians` row its global identity.
   *
   * The status this lands in is the whole ethical core of the feature:
   *
   *   NEW human      → membership 'active'. The salon is entering a technician who has no account anywhere;
   *                    nobody else's identity is being touched, and the salon plainly employs them.
   *
   *   EXISTING human → membership 'pending_tech_approval'. The technician ALREADY has a global profile — with
   *                    their followers, their portfolio, their rating, their public page. A salon typing a
   *                    phone number must not be able to attach all of that to itself, list the technician on
   *                    its salon page, and appear in their Workplaces, without the technician ever agreeing.
   *
   *                    The spec says "the technician must not be able to force themselves into a salon without
   *                    approval." This is that sentence read in the other direction, which is the direction
   *                    where the technician is the one with less power.
   *
   *                    The salon still gets its `technicians` row immediately — that is salon-owned employment
   *                    data and theirs to write. What waits for consent is the link to the global identity.
   */
  async attachToTechnician(ctx: IdentityCtx, technicianId: string, input: AttachInput): Promise<AttachResult> {
    const db = this.need();
    const keys = identityKeys({ phone: input.phone, email: input.email });
    const found = await this.dir().findByKeys(keys);
    const decision = decideIdentity(found);

    if (decision.action === 'refuse') throw new GlobalTechIdentityError(decision.code, decision.message);

    const linking = decision.action === 'link_existing';
    const membershipStatus: MembershipStatus = linking ? 'pending_tech_approval' : 'active';
    const name = splitName(input.fullName || (found?.displayName ?? 'Technician'));

    return db.transaction().execute(async (trx: any) => {
      const profileId = linking
        ? await this.linkExistingProfile(trx, decision.profileId, keys)
        : await this.createProfile(trx, { name: name.fullName, avatarUrl: input.avatarUrl ?? null, keys });

      const techCode = linking ? decision.techCode : await this.readTechCode(trx, profileId);
      const userId = await this.ensureTenantUser(trx, ctx, profileId, { name, email: keys.emailNormalized, phone: keys.normalizedPhone });
      const membershipId = await this.ensureMembership(trx, ctx, {
        profileId, technicianId, userId, status: membershipStatus, roleLabel: input.roleLabel ?? 'Technician',
      });
      // An ACTIVE membership is also a branch grant: this login may select this branch, in this role.
      if (membershipStatus === 'active' && ctx.branchId) {
        await this.grantBranchAccess(trx, ctx.tenantId, userId, ctx.branchId, input.roleLabel ?? 'Technician');
      }

      // The salon's technicians row now knows who it employs, and the Tech App's `where user_id = ctx.userId`
      // lookup can finally resolve — which it never could for a manager-created technician before today.
      //
      // CONSENT BEFORE LINK (TECHNICIAN_AUDIT P0 #12): when this is an EXISTING human, the roster row gets the
      // per-salon login but NOT `global_tech_profile_id`. That column is what every manager surface (posViewTechProfile,
      // customer salon lists, matching) joins on; writing it here would put her portfolio, rating and public page in
      // front of the hiring salon — and the salon's page in front of customers — before she has tapped accept. The
      // link lands in materializeMembership (TechWorkplacesService.accept). A NEW human has nothing to consent about
      // yet (the profile is being born here), so it links immediately as before.
      if (linking) {
        await sql`update technicians set user_id = ${userId}, updated_at = now()
                   where id = ${technicianId} and tenant_id = ${ctx.tenantId}`.execute(trx);
      } else {
        await sql`update technicians set user_id = ${userId}, global_tech_profile_id = ${profileId}, updated_at = now()
                   where id = ${technicianId} and tenant_id = ${ctx.tenantId}`.execute(trx);
      }

      const invite = await this.createInvitation(trx, ctx, { email: keys.emailNormalized, phone: keys.normalizedPhone, fullName: name.fullName, userId });

      // §128: a NEW human is employed from this moment; an EXISTING one is hired when she accepts (materializeMembership)
      if (membershipStatus === 'active') {
        await recordEmploymentEvent(trx, { tenantId: ctx.tenantId, technicianId, profileId, branchId: ctx.branchId || null, type: 'hired',
          to: input.roleLabel ?? 'Technician', actorUserId: ctx.userId || null, actorRole: ctx.role || null, source: 'pos_create' });
      }

      await this.audit(trx, ctx, linking ? 'tech_global_profile_linked' : 'tech_global_account_created', technicianId, {
        profileId, techCode, membershipStatus, matchedOn: linking ? decision.matchedOn : null,
      });

      return {
        profileId, techCode, userId, membershipId, membershipStatus,
        linkedExistingProfile: linking,
        matchedOn: linking ? decision.matchedOn : null,
        invite,
      };
    });
  }

  /**
   * Mint the permanent identity. This is the ONLY place a global technician account is born.
   *
   * Public because `TechProfileService.getOrCreateMyProfile` (the Tech App's lazy path) must come THROUGH here —
   * it used to insert into global_tech_profiles itself, without a tech_code (NOT NULL since 376) and without the
   * normalized keys that make the next salon recognise her. Two minters is how one human gets two accounts.
   */
  async createProfile(trx: any, i: { name: string; avatarUrl: string | null; keys: ReturnType<typeof identityKeys> }): Promise<string> {
    const techCode = await this.allocateTechCode(trx);
    let slug = slugify(i.name || 'nail-tech', rand());
    for (let n = 0; n < 3; n++) {
      const dupe: any = await sql`select id from global_tech_profiles where public_slug = ${slug} limit 1`.execute(trx);
      if (!dupe.rows.length) break;
      slug = slugify(i.name || 'nail-tech', rand());
    }
    const ins: any = await sql`
      insert into global_tech_profiles
        (tech_code, public_slug, display_name, avatar_url, normalized_phone, phone_hash, email_normalized, status)
      values (${techCode}, ${slug}, ${i.name || 'Technician'}, ${i.avatarUrl}, ${i.keys.normalizedPhone},
              ${i.keys.phoneHash}, ${i.keys.emailNormalized}, 'active')
      returning id`.execute(trx);
    return String(ins.rows[0].id);
  }

  /**
   * Link a profile that already exists — and FILL BLANKS ONLY.
   *
   * The technician owns this row. A salon that hires them may complete a field the technician never set (they
   * had no email on file; the salon has one). It may not overwrite a field the technician DID set — a salon
   * typing a stale phone number must not be able to rewrite the contact details on another salon's technician,
   * or on the technician's own public profile.
   */
  private async linkExistingProfile(trx: any, profileId: string, keys: ReturnType<typeof identityKeys>): Promise<string> {
    await sql`
      update global_tech_profiles set
        normalized_phone = coalesce(normalized_phone, ${keys.normalizedPhone}),
        phone_hash       = coalesce(phone_hash,       ${keys.phoneHash}),
        email_normalized = coalesce(email_normalized, ${keys.emailNormalized}),
        updated_at = now()
      where id = ${profileId}`.execute(trx);
    return profileId;
  }

  // ── the Tech App's own path: a logged-in technician with no global identity yet ─────────────────────────

  /**
   * The technician herself is signed in at this salon (her `technicians` row carries `user_id = ctx.userId`) and
   * has no global profile. Give her one — through the SAME minter and the SAME lookup the manager path uses.
   *
   *   keys match an ACTIVE profile → link it. She is the one acting, on her own row; that is consent.
   *   keys match a non-active one   → refuse with the real reason (never a silent second account).
   *   no match                      → mint, via createProfile (tech_code sequence, normalized keys).
   *
   * Compatible with "link after consent": if this roster row already has a membership that is PENDING her
   * acceptance (the salon typed her number; she has not said yes), she is "invited, not linked" and must accept
   * in Workplaces — minting a fresh profile here would be exactly the duplicate that flow exists to prevent.
   */
  async claimProfileForSessionTechnician(ctx: IdentityCtx, tech: {
    id: string; branchId: string | null; fullName: string; avatarUrl: string | null;
    normalizedPhone: string | null; email: string | null;
  }): Promise<{ profileId: string; linkedExistingProfile: boolean }> {
    const db = this.need();

    const open: any = await sql`
      select id, status, global_tech_profile_id from tech_salon_memberships
       where tenant_id = ${ctx.tenantId} and technician_id = ${tech.id}
         and status not in ('former', 'rejected', 'revoked', 'cancelled')
       order by (status = 'active') desc, created_at desc limit 1`.execute(db);
    const m = open?.rows?.[0];
    if (m && !isEndedMembership(String(m.status)) && String(m.status) !== 'active') {
      throw new GlobalTechIdentityError('pending_consent', 'This salon has invited you to link your profile. Accept the invitation in Workplaces first.');
    }

    const keys = identityKeys({ phone: tech.normalizedPhone, email: tech.email });
    const found = m?.global_tech_profile_id ? null : await this.dir().findByKeys(keys);
    const decision = m?.global_tech_profile_id ? null : decideIdentity(found);
    if (decision?.action === 'refuse') throw new GlobalTechIdentityError(decision.code, decision.message);

    const name = splitName(tech.fullName || 'Technician');
    const branchId = tech.branchId || ctx.branchId || (await this.primaryBranchId(db, ctx.tenantId));

    return db.transaction().execute(async (trx: any) => {
      let profileId: string;
      let linked = false;
      if (m?.global_tech_profile_id) {
        profileId = String(m.global_tech_profile_id);        // an ACTIVE membership already names her account
        linked = true;
      } else if (decision?.action === 'link_existing') {
        profileId = await this.linkExistingProfile(trx, decision.profileId, keys);
        linked = true;
      } else {
        profileId = await this.createProfile(trx, { name: name.fullName, avatarUrl: tech.avatarUrl, keys });
      }

      // her login here points up at the account (uq_users_tenant_gtp: one login per salon per account)
      await sql`update users set global_tech_profile_id = ${profileId}, updated_at = now()
                 where id = ${ctx.userId} and tenant_id = ${ctx.tenantId} and global_tech_profile_id is null`.execute(trx);
      await sql`update technicians set global_tech_profile_id = ${profileId}, updated_at = now()
                 where id = ${tech.id} and tenant_id = ${ctx.tenantId}`.execute(trx);

      // she already works HERE: the membership is active from the start
      await this.ensureMembership(trx, { ...ctx, branchId: branchId ?? '' }, {
        profileId, technicianId: tech.id, userId: ctx.userId, status: 'active', roleLabel: 'Technician',
      });
      if (branchId) await this.grantBranchAccess(trx, ctx.tenantId, ctx.userId, branchId, 'Technician');

      await this.audit(trx, ctx, linked ? 'tech_global_profile_linked' : 'tech_global_account_created', tech.id, {
        profileId, via: 'tech_app', matchedOn: decision?.action === 'link_existing' ? decision.matchedOn : null,
      });
      return { profileId, linkedExistingProfile: linked };
    });
  }

  /** The salon's main branch — the fallback when a membership or a roster row has none. Never NULL into a NOT NULL column. */
  private async primaryBranchId(db: any, tenantId: string): Promise<string | null> {
    const r: any = await sql`
      select id from branches where tenant_id = ${tenantId}
       order by (status = 'active') desc, created_at asc limit 1`.execute(db).catch(() => null);
    return r?.rows?.[0]?.id ? String(r.rows[0].id) : null;
  }

  private async readTechCode(trx: any, profileId: string): Promise<string> {
    const r: any = await sql`select tech_code from global_tech_profiles where id = ${profileId} limit 1`.execute(trx);
    return String(r.rows[0].tech_code);
  }

  // ── the per-salon login (option b) ─────────────────────────────────────────────────────────────────────

  /**
   * The technician's `users` row IN THIS SALON. One per salon, each pointing up at the one global profile.
   *
   * This is also the fix for the defect that made the transfer feature unusable: `posDecideMembershipRequest`
   * used to copy the OTHER salon's `profile.user_id` into this salon's technicians row. The Tech App then asked
   *
   *     select … from technicians where tenant_id = <this salon> and user_id = <session user id>
   *
   * and never matched, because the session user id in this salon is a different row entirely. An approved
   * transfer produced a technician who could not open the app at the salon that had just approved them.
   *
   * No password is set. The row is 'invited' until the technician accepts — under option (b) each salon's login
   * is its own credential, so a salon cannot mint a working login for somebody and then use it.
   */
  async ensureTenantUser(
    trx: any, ctx: IdentityCtx, profileId: string,
    i: { name: { firstName: string; lastName: string; fullName: string }; email: string | null; phone: string | null },
  ): Promise<string> {
    const existing: any = await sql`
      select id from users
       where tenant_id = ${ctx.tenantId} and global_tech_profile_id = ${profileId} limit 1`.execute(trx);
    if (existing.rows.length) return String(existing.rows[0].id);

    // A users row may already exist for this person in this salon from BEFORE they had a global identity
    // (every technician created by a manager until today). Adopt it rather than creating a second login.
    //
    // ANY live staff row, not only role = 'TECHNICIAN': migration 460 makes (tenant, email) and (tenant, phone)
    // unique across staff logins, so an owner who also does nails has ONE login here — and this is it.
    if (i.email || i.phone) {
      const legacy: any = await sql`
        select id from users
         where tenant_id = ${ctx.tenantId} and role not in ('CUSTOMER', 'SUPER_ADMIN') and status <> 'inactive'
           and global_tech_profile_id is null
           and ((${i.email}::text is not null and lower(email) = ${i.email})
             or (${i.phone}::text is not null and normalized_phone = ${i.phone}))
         order by (role = 'TECHNICIAN') desc, created_at asc
         limit 1`.execute(trx);
      if (legacy.rows.length) {
        const id = String(legacy.rows[0].id);
        await sql`update users set global_tech_profile_id = ${profileId}, updated_at = now() where id = ${id} and tenant_id = ${ctx.tenantId}`.execute(trx);
        return id;
      }
    }

    const ins: any = await sql`
      insert into users (tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone,
                         role, status, global_tech_profile_id)
      values (${ctx.tenantId}, ${ctx.branchId || null}, ${i.name.firstName}, ${i.name.lastName}, ${i.name.fullName},
              ${i.email}, ${i.phone}, 'TECHNICIAN', 'invited', ${profileId})
      returning id`.execute(trx);
    return String(ins.rows[0].id);
  }

  /** Called outside a transaction by the membership-approval path, which has its own flow. */
  async ensureTenantUserForProfile(ctx: IdentityCtx, profileId: string, i: { fullName: string; email: string | null; phone: string | null }): Promise<string> {
    const db = this.need();
    return db.transaction().execute((trx: any) =>
      this.ensureTenantUser(trx, ctx, profileId, { name: splitName(i.fullName), email: i.email, phone: i.phone }));
  }

  // ── the employment relationship ────────────────────────────────────────────────────────────────────────

  private async ensureMembership(
    trx: any, ctx: IdentityCtx,
    i: { profileId: string; technicianId: string; userId: string; status: MembershipStatus; roleLabel: string },
  ): Promise<string> {
    const existing: any = await sql`
      select id, status from tech_salon_memberships
       where global_tech_profile_id = ${i.profileId} and tenant_id = ${ctx.tenantId}
         and branch_id is not distinct from ${ctx.branchId || null} limit 1`.execute(trx);

    if (existing.rows.length) {
      const id = String(existing.rows[0].id);
      // Phase 12 (#27): a re-hire re-uses the row through the membership machine (a platform-suspended / revoked
      // membership is not re-activated by a salon), and only from the state just read (no lost update)
      assertTransition(TECH_SALON_MEMBERSHIP, String(existing.rows[0].status), i.status);
      await sql`
        update tech_salon_memberships set
          technician_id = ${i.technicianId}, user_id = ${i.userId}, role_label = ${i.roleLabel},
          invited_by_user_id = ${ctx.userId},
          status = ${i.status}, start_date = case when ${i.status} = 'active' then now() else start_date end,
          updated_at = now()
        where id = ${id} and tenant_id = ${ctx.tenantId} and status = ${String(existing.rows[0].status)}`.execute(trx);
      return id;
    }

    const ins: any = await sql`
      insert into tech_salon_memberships
        (global_tech_profile_id, tenant_id, branch_id, technician_id, user_id, status, role_label,
         requested_by_user_id, invited_by_user_id, start_date)
      values (${i.profileId}, ${ctx.tenantId}, ${ctx.branchId || null}, ${i.technicianId}, ${i.userId},
              ${i.status}, ${i.roleLabel}, ${ctx.userId}, ${ctx.userId},
              ${i.status === 'active' ? sql`now()` : sql`null`})
      returning id`.execute(trx);
    return String(ins.rows[0].id);
  }

  // ── the invite ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Create the invitation — and actually SEND it.
   *
   * Reuses `user_invitations`, the platform's own token primitives (same sha-256 hash, same prefix, same TTL) and
   * the platform's own delivery seam (`InvitationDelivery` → `INVITE_NOTIFIER_URL`). A second invitation table
   * would be a second thing to expire, revoke and audit; a second delivery mechanism would be a second place to
   * forget that `not_connected` is not `sent`.
   *
   * == SMS, AND WHY IT MATTERS MORE THAN EMAIL HERE ========================================================
   *
   * This used to bail out with `{ created: false, reason: 'no_email' }` — because `user_invitations.email` was
   * NOT NULL, having been built for platform staff, who all have one.
   *
   * A nail technician frequently does not. She has a mobile number. It is the number the salon hires her on, the
   * number the POS already stores, and the number her global account now deduplicates her by — and it was the one
   * identifier the invitation system could not use. The account got created, the membership got created, and the
   * person they belonged to was never told. Migration 379 makes email nullable, adds the phone, and a CHECK
   * insists on at least one: an invitation that can reach nobody is not an invitation.
   *
   * The result is reported HONESTLY. With no notifier configured it comes back `not_connected` with the one-time
   * token, so the manager can hand the link over. It never comes back "sent".
   */
  private async createInvitation(trx: any, ctx: IdentityCtx, i: { email: string | null; phone: string | null; fullName: string; userId: string }) {
    if (!i.email && !i.phone) return { created: false, tokenPrefix: null, reason: 'no_contact' as const, channel: null, deliveryStatus: null, manualToken: null };

    const open: any = await sql`
      select token_prefix from user_invitations
       where tenant_id = ${ctx.tenantId} and status = 'pending'
         and ((${i.email}::text is not null and lower(email) = ${i.email})
           or (${i.phone}::text is not null and normalized_phone = ${i.phone}))
       limit 1`.execute(trx);
    if (open.rows.length) {
      return { created: false, tokenPrefix: String(open.rows[0].token_prefix), reason: 'already_pending' as const, channel: null, deliveryStatus: null, manualToken: null };
    }

    // Email when we have one (the accept link is easier to open); otherwise SMS to the number she was hired on.
    const channel: 'email' | 'sms' = i.email ? 'email' : 'sms';
    const to = (i.email ?? i.phone) as string;

    const { token, tokenHash, tokenPrefix } = mintInvitationToken();
    const expiresAt = invitationExpiry();
    const ins: any = await sql`
      insert into user_invitations (tenant_id, branch_id, email, normalized_phone, role, invited_by_user_id, user_id,
                                    token_hash, token_prefix, delivery_channel, expires_at)
      values (${ctx.tenantId}, ${ctx.branchId || null}, ${i.email}, ${i.phone}, 'TECHNICIAN', ${ctx.userId}, ${i.userId},
              ${tokenHash}, ${tokenPrefix}, ${channel}, ${expiresAt})
      returning id`.execute(trx);

    const invitationId = String(ins.rows[0].id);

    // Delivered OUTSIDE the transaction's success — a notifier that is down must not roll back a hire. The row
    // exists, the failure is recorded on it, and the token comes back so somebody can pass the link on by hand.
    const sent = await new InvitationDelivery(new KyselyInvitationDeliverySink(this.db)).deliver({
      invitationId, channel, to, token, baseUrl: portalUrl(), role: 'TECHNICIAN', tenantId: ctx.tenantId,
      expiresAt: expiresAt.toISOString(),
    }).catch(() => null);

    return {
      created: true, tokenPrefix, reason: null,
      channel,
      deliveryStatus: sent?.deliveryStatus ?? null,
      manualToken: sent?.manualToken ?? null,
      acceptUrl: sent?.manualToken ? acceptUrl(portalUrl(), sent.manualToken) : null,
    };
  }

  // ── audit ──────────────────────────────────────────────────────────────────────────────────────────────

  private async audit(trx: any, ctx: IdentityCtx, action: string, technicianId: string | null, metadata: Record<string, unknown>) {
    await sql`
      insert into technician_audit_logs (tenant_id, branch_id, technician_id, user_id, action, metadata)
      values (${ctx.tenantId}, ${ctx.branchId || null}, ${technicianId}, ${ctx.userId || null}, ${action},
              ${JSON.stringify(metadata)}::jsonb)`.execute(trx).catch(() => {});
  }
  // ── making a membership REAL ───────────────────────────────────────────────────────────────────────────

  /**
   * Give a membership its login row and its roster row at the salon it belongs to. Idempotent.
   *
   * A `tech_salon_memberships` row is a RELATIONSHIP. It is not a login and it is not a place on a roster, and
   * until it has both, an "active" membership is a technician who is employed somewhere she cannot sign in to
   * and who appears on no schedule.
   *
   * Called from three places, and they are the three ways a technician's relationship with a salon becomes
   * real: she accepts it (TechWorkplacesService.accept), the salon approves her request
   * (TechProfileService.posDecideMembershipRequest), or a Super Admin executes an approved transfer she herself
   * asked for (CrossTenantTransferExecutor). All hold authority to do it; none should own a second copy of HOW.
   *
   * `tenantId` is a parameter and not a lookup, deliberately: every statement below carries it, so the caller has
   * to say which salon it believes it is acting on and cannot accidentally materialize a membership into
   * somebody else's. `outerTrx` lets the caller make "membership active + materialized" ONE transaction.
   */
  async materializeMembership(tenantId: string, membershipId: string, outerTrx?: any): Promise<{ userId: string; technicianId: string; branchId: string } | null> {
    const db = this.need();
    const run = async (trx: any) => {
      const m: any = await sql`
        select m.id, m.tenant_id, m.branch_id, m.global_tech_profile_id, m.role_label, m.technician_id,
               p.display_name, p.avatar_url, p.normalized_phone, p.email_normalized
          from tech_salon_memberships m
          join global_tech_profiles p on p.id = m.global_tech_profile_id
         where m.id = ${membershipId} and m.tenant_id = ${tenantId} limit 1`.execute(trx);
      const row = m?.rows?.[0];
      if (!row) return null;

      // technicians.branch_id is NOT NULL. A membership with no branch used to be inserted as NULL and fail —
      // or, worse, be caught and leave an "active" employee with no roster row. Fall back to the salon's primary
      // branch and RECORD that choice on the membership, so nothing downstream has to guess again.
      let branchId: string | null = row.branch_id ? String(row.branch_id) : null;
      let branchDefaulted = false;
      if (!branchId) {
        branchId = await this.primaryBranchId(trx, tenantId);
        if (!branchId) throw new GlobalTechIdentityError('no_branch', 'This salon has no branch to place the technician in.');
        branchDefaulted = true;
        const clash: any = await sql`
          select 1 from tech_salon_memberships
           where global_tech_profile_id = ${row.global_tech_profile_id} and tenant_id = ${tenantId} and branch_id = ${branchId}
             and id <> ${membershipId} limit 1`.execute(trx);
        if (!clash?.rows?.length) {
          await sql`update tech_salon_memberships set branch_id = ${branchId}, updated_at = now()
                     where id = ${membershipId} and tenant_id = ${tenantId}`.execute(trx);
        }
      }

      const ctx: IdentityCtx = { tenantId, branchId, userId: '', role: 'TECHNICIAN', permissions: [] };
      const name = splitName(String(row.display_name || 'Technician'));

      const userId = await this.ensureTenantUser(trx, ctx, String(row.global_tech_profile_id), {
        name, email: row.email_normalized ?? null, phone: row.normalized_phone ?? null,
      });

      // ONE roster row per (salon, account) — uq_technicians_tenant_gtp_live. A second branch does not get a
      // second roster row; it gets a membership and a branch grant. The roster row's branch_id stays her PRIMARY.
      // The membership's own technician_id first — the roster row the salon created at invite time, which (consent
      // before link, attachToTechnician) carries no global_tech_profile_id until this moment. Then by profile.
      let tech: any = row.technician_id
        ? await sql`select id, branch_id, is_active from technicians where tenant_id = ${tenantId} and id = ${row.technician_id} and archived_at is null limit 1`.execute(trx)
        : { rows: [] };
      if (!tech?.rows?.length) {
        tech = await sql`
          select id, branch_id, is_active from technicians
           where tenant_id = ${tenantId} and global_tech_profile_id = ${row.global_tech_profile_id} and archived_at is null
           limit 1`.execute(trx);
      }
      let technicianId: string;

      if (tech?.rows?.length) {
        technicianId = String(tech.rows[0].id);
        await sql`update technicians set user_id = ${userId}, global_tech_profile_id = ${row.global_tech_profile_id},
                                         is_active = true, status = 'active', ended_reason = null, updated_at = now()
                   where id = ${technicianId} and tenant_id = ${tenantId}`.execute(trx);
      } else {
        // the salon's own default rate (tenants.default_commission_percent) — never a literal (was 40)
        const tenantDefault = (await defaultCommissionForTenant(trx as any, tenantId)).commissionValue;
        const ins: any = await sql`
          insert into technicians (tenant_id, branch_id, user_id, first_name, last_name, full_name, avatar_url,
                                   role_label, status, commission_type, commission_value,
                                   default_commission_split_percent, is_active, global_tech_profile_id)
          values (${tenantId}, ${branchId}, ${userId}, ${name.firstName}, ${name.lastName}, ${name.fullName},
                  ${row.avatar_url}, ${row.role_label ?? 'Technician'}, 'active', 'percent', ${tenantDefault}, ${tenantDefault}, true,
                  ${row.global_tech_profile_id})
          returning id`.execute(trx);
        technicianId = String(ins.rows[0].id);
      }

      await sql`update tech_salon_memberships set user_id = ${userId}, technician_id = ${technicianId}, updated_at = now()
                 where id = ${membershipId} and tenant_id = ${tenantId}`.execute(trx);

      // §128 / §64 employment history, in this transaction: first employment → hired; back after a termination /
      // transfer → rehired (the old rows stay); already employed here and this membership adds a branch → branch_added.
      const wasActive = !!tech?.rows?.[0]?.is_active;
      const primaryBranch = tech?.rows?.[0]?.branch_id ? String(tech.rows[0].branch_id) : null;
      const hev = { tenantId, technicianId, profileId: String(row.global_tech_profile_id), branchId, actorUserId: null, actorRole: null, source: 'membership_activated', metadata: { membershipId } };
      if (await hasEndedBefore(trx, tenantId, technicianId) && !wasActive) await recordEmploymentEvent(trx, { ...hev, type: 'rehired', to: row.role_label ?? 'Technician' });
      else if (!(await hasHireEvent(trx, tenantId, technicianId))) await recordEmploymentEvent(trx, { ...hev, type: 'hired', to: row.role_label ?? 'Technician' });
      else if (wasActive && primaryBranch && primaryBranch !== branchId) await recordEmploymentEvent(trx, { ...hev, type: 'branch_added' });

      // the branch grant is what lets her login SELECT this branch (auth/branch-access.ts fails closed without it)
      await this.grantBranchAccess(trx, tenantId, userId, branchId, row.role_label ?? 'Technician');

      await this.audit(trx, { ...ctx, userId }, 'tech_membership_materialized', technicianId, {
        membershipId, profileId: String(row.global_tech_profile_id), branchId, branchDefaulted,
      });

      return { userId, technicianId, branchId };
    };
    return outerTrx ? run(outerTrx) : db.transaction().execute(run);
  }

  // ── branch grants: the per-branch authority a membership carries ──────────────────────────────────────

  /**
   * `user_branch_access` row for a technician login at one branch. Written whenever a membership becomes active,
   * removed when the employment ends. role = TECHNICIAN, or MANAGER when the membership's role_label says so.
   * access_level 'staff' keeps these rows out of the Owner app's `access_level = 'owner'` salon list.
   */
  async grantBranchAccess(trx: any, tenantId: string, userId: string, branchId: string, roleLabel: string | null | undefined): Promise<void> {
    const role = branchRoleForLabel(roleLabel);
    await sql`
      insert into user_branch_access (tenant_id, branch_id, user_id, role, access_level)
      values (${tenantId}, ${branchId}, ${userId}, ${role}, 'staff')
      on conflict (tenant_id, user_id, branch_id) do update
        set role = excluded.role, access_level = 'staff', updated_at = now()`.execute(trx);
  }

  /** Remove the grant(s). `branchId` null → every branch at this salon (the employment ended). */
  async revokeBranchAccess(trx: any, tenantId: string, userId: string, branchId: string | null): Promise<void> {
    await revokeBranchAccessRows(trx, tenantId, userId, branchId);
  }

  // ── the departure: ONE function, two callers ───────────────────────────────────────────────────────────

  /**
   * End a technician's employment at `tenantId`. Called by the transfer executor (a self-requested move lands
   * immediately) and by TechWorkplacesService.accept (she accepted a transfer; the old salon ends now). It was
   * two copies that each flipped the membership and stopped — leaving the roster row active, the login live and
   * every session valid at a salon she no longer worked at.
   *
   * What it does, all inside the caller's transaction:
   *   membership    → 'former' + ended_reason          (the salon's record of the relationship)
   *   technicians   → is_active = false, status 'inactive', ended_reason   ('transferred' is not in the
   *                    TechLifecycleStatus vocabulary — active | inactive | suspended | archived — so the reason
   *                    goes in ended_reason rather than inventing a status no screen understands)
   *   users         → status 'inactive'                 (the login at THIS salon; every other salon's login untouched)
   *   branch grants → removed
   *   sessions      → revoked (status + revoked_at: the guard reads `status`, the admin screen reads revoked_at)
   *
   * Her PRIVATE data at the old salon — pay, schedule, services, notes, tickets — is not touched. It is the
   * salon's record, and the rows stay exactly where payroll and audit point.
   *
   * Sessions are cut HERE, inside the transaction, with the same two statements the shared chain
   * (auth/revoke-technician-access.ts) uses — that helper opens its own transaction and cannot join this one, so
   * it runs AFTER commit via `afterDeparture()` for the rest of the chain (Clock PIN, the access-revoked audit
   * row, the realtime nudge). A crash between the two leaves nothing live: the sessions were already revoked.
   */
  async endEmployment(trx: any, i: { profileId: string; tenantId: string; reason: string; requestId?: string | null; actorUserId?: string | null; actorRole?: string | null }): Promise<{ membershipsEnded: number; techniciansEnded: number; usersEnded: number; sessionsRevoked: number }> {
    const m: any = await sql`
      update tech_salon_memberships set
        status = 'former', end_date = coalesce(end_date, now()), ended_reason = ${i.reason}, updated_at = now()
      where global_tech_profile_id = ${i.profileId} and tenant_id = ${i.tenantId}
        and status not in ('former', 'rejected', 'revoked', 'cancelled') and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'former')}`.execute(trx);

    const t: any = await sql`
      update technicians set is_active = false, status = 'inactive', ended_reason = ${i.reason}, updated_at = now()
      where tenant_id = ${i.tenantId} and global_tech_profile_id = ${i.profileId} and archived_at is null and is_active = true
      returning id, branch_id`.execute(trx);
    // §128: the ended employment is history — 'transferred' when that is why, otherwise 'terminated'
    for (const ended of t?.rows ?? []) {
      await recordEmploymentEvent(trx, { tenantId: i.tenantId, technicianId: String(ended.id), profileId: i.profileId, branchId: ended.branch_id ?? null,
        type: i.reason === 'transferred' ? 'transferred' : 'terminated', reason: i.reason, actorUserId: i.actorUserId ?? null, actorRole: i.actorRole ?? null,
        source: 'end_employment', metadata: { requestId: i.requestId ?? null } });
    }

    const users: any = await sql`
      select id from users where tenant_id = ${i.tenantId} and global_tech_profile_id = ${i.profileId}`.execute(trx);
    const userIds: string[] = (users?.rows ?? []).map((x: any) => String(x.id));

    let sessionsRevoked = 0;
    for (const userId of userIds) {
      await sql`update users set status = 'inactive', updated_at = now() where id = ${userId} and tenant_id = ${i.tenantId} and ${canMoveToSql(USER_ACCOUNT, 'inactive')}`.execute(trx);
      await this.revokeBranchAccess(trx, i.tenantId, userId, null);
      // Tenant-scoped (same rule as auth/revoke-technician-access.ts): leaving salon A never ends sessions at salon B.
      const s: any = await sql`update sessions set status = 'revoked', revoked_at = coalesce(revoked_at, now())
                                 where user_id = ${userId} and (tenant_id = ${i.tenantId} or tenant_id is null)
                                   and (revoked_at is null or status <> 'revoked') and ${canMoveToSql(SESSION, 'revoked')}`.execute(trx);
      sessionsRevoked += Number(s?.numAffectedRows ?? 0);
      await sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`.execute(trx).catch(() => {});
    }

    // in the transaction, through modules/audit (a failed audit fails the departure — never a silent .catch inside a trx)
    await new KyselyAuditRepository(trx).record(
      { tenantId: i.tenantId, userId: i.actorUserId ?? null, role: i.actorRole ?? null },
      { module: 'workforce', action: 'tech.employment_ended', resourceType: 'global_tech_profile', resourceId: i.profileId, reason: i.reason ?? null,
        metadata: { requestId: i.requestId ?? null, sessionsRevoked } });

    return {
      membershipsEnded: Number(m?.numAffectedRows ?? 0), techniciansEnded: (t?.rows ?? []).length,
      usersEnded: userIds.length, sessionsRevoked,
    };
  }

  /**
   * §60 / §107 operational blocks on LEAVING a salon: you do not move somebody out mid-service, or with a cash handoff
   * still unreconciled. ONE implementation — the Super Admin cross-tenant executor and the technician-requested
   * transfer both ask here. Returns a plain-words reason, or null when the departure may proceed.
   */
  async departureBlocker(db: any, profileId: string, fromTenantId: string): Promise<{ code: 'open_service' | 'cash_handoff_pending'; message: string } | null> {
    const st: any = await sql`select id from technicians where tenant_id = ${fromTenantId} and global_tech_profile_id = ${profileId} and archived_at is null`.execute(db).catch(() => null);
    for (const r of st?.rows ?? []) {
      const srcTechId = String(r.id);
      const inService: any = await sql`select 1 from pos_queue_items where assigned_technician_id = ${srcTechId} and tenant_id = ${fromTenantId} and status = 'in_service' limit 1`.execute(db).catch(() => null);
      if (inService?.rows?.length) return { code: 'open_service', message: 'She is serving a guest at her current salon — finish the service first.' };
      const cash: any = await sql`select 1 from tech_cash_handoffs where technician_id = ${srcTechId} and tenant_id = ${fromTenantId} and status not in ('reconciled', 'cancelled') limit 1`.execute(db).catch(() => null);
      if (cash?.rows?.length) return { code: 'cash_handoff_pending', message: 'She has a cash handoff at her current salon that is not reconciled yet.' };
    }
    return null;
  }

  /**
   * The post-commit half of a departure: the shared revoke chain (Clock PIN disabled, technician_access_revoked
   * audit row, realtime nudge). Idempotent over what endEmployment already did. Never throws — the employment
   * state is committed; a failure here is logged by the helper's own audit path or swallowed, not re-raised into a
   * transfer that has already happened.
   */
  async afterDeparture(i: { profileId: string; tenantId: string; reason: string; actorUserId?: string | null; actorRole?: string | null; source: string }): Promise<void> {
    if (!this.db) return;
    await revokeTechnicianAccess(this.db as any, {
      tenantId: i.tenantId, globalTechProfileId: i.profileId, mode: 'terminate', reason: i.reason,
      actor: { userId: i.actorUserId ?? null, role: i.actorRole ?? null }, source: i.source,
    }).catch(() => {});
  }
}
