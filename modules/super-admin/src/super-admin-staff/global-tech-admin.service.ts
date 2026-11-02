// global-tech-admin.service.ts — Super Admin's authority over a technician's PLATFORM account.
//
// CROSS-TENANT BY DESIGN: a global technician account spans salons. Every query here is deliberately unscoped by
// tenant because the subject IS the technician, not any one salon's copy of her. This is a SuperAdminGuard-only
// surface — the guard is the boundary, and it is the whole boundary.
//
// == THE LINE THIS FILE DRAWS =============================================================================
//
// A salon can end its OWN relationship with a technician. It can suspend her, mark her former, revoke her
// access. Its vocabulary of destruction stops at its own door, and none of those three words reaches
// `global_tech_profiles`.
//
// Super Admin is the only party that can touch the account itself — and even here it cannot simply do it. An
// erasure needs a request, an approval, no legal hold, and a stated reason (decideAnonymize). A merge refuses
// outright when two profiles share a salon, because collapsing them would pick a winner between two payroll
// histories and the platform is the one party that cannot know which is real.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { buildMediaUrl } from '@aipowersalon/media';
import {
  anonymizedDisplayName, decideAnonymize, decideMerge,
  type DeleteRequestState, type MergeCandidate,
} from './global-tech-admin-core';
import { canMoveToSql, InvalidStateTransitionError, type StateMachine } from '@aipowersalon/database';
import { USER_ACCOUNT } from '@aipowersalon/identity';
import { TECH_SALON_MEMBERSHIP, TECH_PORTFOLIO_PHOTO, revokeTechnicianAccess, restorePlatformTechnicianAccess } from '@aipowersalon/workforce';
import { GLOBAL_TECH_PROFILE, GLOBAL_TECH_DELETE_REQUEST } from '../lifecycles';
/** Phase 12 (#27): a conditional status write that moved no row lost a race (the account / membership changed after it
 *  was read) — refuse with 409 instead of carrying on with the cascade as if it had moved. */
const moved = (from: string | null, to: string, m: StateMachine<any> = GLOBAL_TECH_PROFILE) => (r: { rows: unknown[] }) => {
  if (!r.rows.length) throw new InvalidStateTransitionError(m, from, to, 'concurrent');
};


export class GlobalTechAdminError extends Error {
  constructor(public code: string, msg: string) { super(msg); this.name = 'GlobalTechAdminError'; }
}

export interface AdminCtx { userId?: string; ip?: string }

const n = (v: any) => Number(v ?? 0);
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

@Injectable()
export class GlobalTechAdminService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {}

  private need(): NonNullable<AppDatabase> {
    if (!this.db) throw new GlobalTechAdminError('unavailable', 'Technician administration requires a database.');
    return this.db;
  }

  // ── search ─────────────────────────────────────────────────────────────────────────────────────────────


  /** GET /super-admin/technicians?q= — by tech code, name, phone or email. */
  async search(q: string, limit = 50) {
    const term = String(q ?? '').trim();
    const like = `%${term.toLowerCase()}%`;
    const r: any = await sql`
      select p.id, p.tech_code, p.display_name, p.status, p.overall_rating, p.rating_count,
             p.portfolio_photo_count, p.created_at, p.merged_into_profile_id, p.avatar_url,
             (select count(*)::int from tech_salon_memberships m
               where m.global_tech_profile_id = p.id and m.status = 'active') as active_salons
        from global_tech_profiles p
       where ${term ? sql`(
               lower(p.tech_code) like ${like}
            or lower(p.display_name) like ${like}
            or lower(coalesce(p.email_normalized, '')) like ${like}
            or coalesce(p.normalized_phone, '') like ${like})` : sql`true`}
       order by p.created_at desc
       limit ${Math.min(200, Math.max(1, limit))}`.execute(this.need());

    return {
      technicians: (r?.rows ?? []).map((x: any) => ({
        profileId: String(x.id),
        techCode: String(x.tech_code),
        displayName: String(x.display_name ?? ''),
        avatarUrl: x.avatar_url ? buildMediaUrl(x.avatar_url) : null,
        status: String(x.status),
        mergedInto: x.merged_into_profile_id ? String(x.merged_into_profile_id) : null,
        overallRating: x.overall_rating == null ? null : Number(x.overall_rating),
        ratingCount: n(x.rating_count),
        portfolioPhotoCount: n(x.portfolio_photo_count),
        activeSalonCount: n(x.active_salons),
        createdAt: iso(x.created_at),
      })),
    };
  }

  // ── detail: the profile, the salons, the work history ──────────────────────────────────────────────────

  /** GET /super-admin/technicians/:profileId — everything the platform knows about this technician. */
  async detail(profileId: string) {
    const db = this.need();
    // Phase 12 #19: the columns the profile view maps — never phone_hash / normalized contact keys
    const p: any = await sql`select id, tech_code, display_name, status, merged_into_profile_id, public_slug, overall_rating, rating_count,
                                    portfolio_photo_count, is_public, suspended_at, suspend_reason, anonymized_at, created_at
                               from global_tech_profiles where id = ${profileId} limit 1`.execute(db);
    const row = p?.rows?.[0];
    if (!row) throw new GlobalTechAdminError('not_found', 'No such technician account.');

    const salons: any = await sql`
      select m.id, m.tenant_id, m.branch_id, m.status, m.role_label, m.start_date, m.end_date, m.ended_reason,
             t.display_name as salon_name, t.tenant_code, b.name as branch_name
        from tech_salon_memberships m
        join tenants t on t.id = m.tenant_id
        left join branches b on b.id = m.branch_id
       where m.global_tech_profile_id = ${profileId}
       order by (m.status = 'active') desc, m.created_at desc`.execute(db);

    const openRequest = await this.openDeleteRequest(profileId);

    return {
      profile: {
        profileId: String(row.id),
        techCode: String(row.tech_code),
        displayName: String(row.display_name ?? ''),
        status: String(row.status),
        mergedInto: row.merged_into_profile_id ? String(row.merged_into_profile_id) : null,
        publicSlug: row.public_slug,
        overallRating: row.overall_rating == null ? null : Number(row.overall_rating),
        ratingCount: n(row.rating_count),
        portfolioPhotoCount: n(row.portfolio_photo_count),
        isPublic: !!row.is_public,
        suspendedAt: iso(row.suspended_at),
        suspendReason: row.suspend_reason ?? null,
        anonymizedAt: iso(row.anonymized_at),
        createdAt: iso(row.created_at),
      },
      // The employment HISTORY, not just the live salons — a former salon is the point of a work history.
      salons: (salons?.rows ?? []).map((s: any) => ({
        membershipId: String(s.id),
        tenantId: String(s.tenant_id),
        salonName: String(s.salon_name ?? ''),
        salonCode: s.tenant_code ?? null,
        branchName: s.branch_name ?? null,
        status: String(s.status),
        roleLabel: s.role_label ?? null,
        startedAt: iso(s.start_date),
        endedAt: iso(s.end_date),
        endedReason: s.ended_reason ?? null,
      })),
      openDeleteRequest: openRequest,
    };
  }

  // ── platform suspension ────────────────────────────────────────────────────────────────────────────────

  /**
   * Suspend the ACCOUNT, not the employment.
   *
   * This is the one lever a salon does not have, and it is why `decideIdentity` refuses to link a suspended
   * profile: a suspension that a salon could route around by simply re-hiring the technician would not be a
   * suspension at all. It also closes every salon switch — see TechWorkplacesService.switchTarget.
   */
  async suspend(ctx: AdminCtx, profileId: string, reason: string) {
    const r = String(reason ?? '').trim();
    if (!r) throw new GlobalTechAdminError('invalid', 'A platform suspension needs a reason on the record.');
    const cur = await this.status(profileId);
    if (cur === 'anonymized' || cur === 'merged') throw new GlobalTechAdminError('invalid', `This account is ${cur} and cannot be suspended.`);

    // The cascade: a suspension is not just a label — it hides the profile, blocks messaging, freezes deals, and cuts
    // every live session. The profile/messaging/deals levers reuse the Phase-3 flags (already enforced on read paths).
    await sql`update global_tech_profiles
                 set status = 'suspended', suspended_at = now(), suspend_reason = ${r},
                     admin_profile_hidden = true, admin_messaging_paused = true, admin_deals_frozen = true, updated_at = now()
               where id = ${profileId} and status = ${cur} and ${canMoveToSql(GLOBAL_TECH_PROFILE, 'suspended')} returning id`.execute(this.need()).then(moved(cur, 'suspended'));
    const revoked = await this.revokeAllSessions(ctx, profileId, 'suspend', r, 'super_admin_suspend');
    await this.recordStatusEvent(ctx, profileId, cur, 'suspended', 'suspended', r);
    await this.audit(ctx, 'super_admin.tech_account_suspended', profileId, { reason: r, sessionsRevoked: revoked });
    await this.notifyProfileTechnicians(profileId, 'Account suspended', 'Your platform account has been suspended. Please contact support.');
    return { ok: true as const, status: 'suspended' as const, sessionsRevoked: revoked };
  }

  /** Restore a suspended account. Never restores a tombstone — that is what "irreversible" means. Lifts the cascade. */
  async restore(ctx: AdminCtx, profileId: string) {
    const cur = await this.status(profileId);
    if (cur !== 'suspended') throw new GlobalTechAdminError('invalid', `Only a suspended account can be restored. This one is ${cur}.`);

    await sql`update global_tech_profiles
                 set status = 'active', suspended_at = null, suspend_reason = null,
                     admin_profile_hidden = false, admin_messaging_paused = false, admin_deals_frozen = false, updated_at = now()
               where id = ${profileId} and status = ${cur} and ${canMoveToSql(GLOBAL_TECH_PROFILE, 'active')} returning id`.execute(this.need()).then(moved(cur, 'active'));
    await restorePlatformTechnicianAccess(this.need(), { globalTechProfileId: profileId, actor: { userId: ctx.userId || null, role: 'SUPER_ADMIN' }, source: 'super_admin_restore' });
    await this.recordStatusEvent(ctx, profileId, cur, 'active', 'restored', null);
    await this.audit(ctx, 'super_admin.tech_account_restored', profileId, {});
    await this.notifyProfileTechnicians(profileId, 'Account restored', 'Your platform account has been restored. You may sign in again.');
    return { ok: true as const, status: 'active' as const };
  }

  /** Revoke every live session + refresh token for all of this technician's logins (they hold one per salon).
   *  Technician Profile merge (mandate §137): this used to write only `sessions.revoked_at` while the guard read
   *  `status`, so the sessions the operator was told were dead stayed live. Now the shared chain
   *  (@aipowersalon/workforce revoke-technician-access) writes BOTH markers, disables the kiosk Clock PIN and — for
   *  suspend/lock — sets users.status + memberships. A failure here is NOT swallowed into "0 revoked": a suspension
   *  whose sessions survived is not a suspension. */
  private async revokeAllSessions(ctx: AdminCtx, profileId: string, mode: 'suspend' | 'sessions_only', reason: string | null, source: string): Promise<number> {
    const res = await revokeTechnicianAccess(this.need(), {
      tenantId: null, globalTechProfileId: profileId, mode, reason,
      actor: { userId: ctx.userId || null, role: 'SUPER_ADMIN' }, source,
    });
    return res.sessionsRevoked;
  }

  /** Notify every active salon login the technician holds (a global action reaches them wherever they work). */
  private async notifyProfileTechnicians(profileId: string, title: string, body: string) {
    try {
      const r: any = await sql`select id, tenant_id from technicians where global_tech_profile_id = ${profileId} and is_active = true`.execute(this.need());
      for (const t of (r?.rows ?? [])) {
        await sql`insert into technician_notifications (tenant_id, technician_id, type, title, body)
                    values (${t.tenant_id}, ${t.id}, 'account', ${title}, ${body})`.execute(this.need()).catch(() => {});
      }
    } catch { /* notifications never block the action they describe */ }
  }

  // ── support panel: read the technician's support/security posture, and act on it ─────────────────────────

  /**
   * A support-desk summary for the technician detail: their live sessions, open support tickets, and the current
   * security posture (account status + the scoped-pause flags). Reuses the real support/session tables — no new store.
   */
  async techSupportSummary(ctx: AdminCtx, profileId: string) {
    const db = this.need();
    const acct: any = await sql`select status, admin_profile_hidden, admin_messaging_paused, admin_deals_frozen, suspended_at, paused_at
                                  from global_tech_profiles where id = ${profileId} limit 1`.execute(db).catch(() => null);
    if (!acct?.rows?.length) throw new GlobalTechAdminError('not_found', 'No such technician profile.');
    const a = acct.rows[0];
    const sess: any = await sql`select count(*)::int n from sessions
                                  where revoked_at is null and (expires_at is null or expires_at > now())
                                    and user_id in (select id from users where global_tech_profile_id = ${profileId})`.execute(db).catch(() => null);
    const tix: any = await sql`select t.id, t.subject, t.status, t.tenant_id, t.created_at from support_tickets t
                                 where t.created_by_user_id in (select id from users where global_tech_profile_id = ${profileId})
                                   and t.status not in ('resolved', 'closed', 'cancelled')
                                 order by t.created_at desc limit 25`.execute(db).catch(() => null);
    const openTickets = (tix?.rows ?? []).map((r: any) => ({ ticketId: r.id, subject: r.subject, status: r.status, tenantId: r.tenant_id, createdAt: r.created_at ? new Date(r.created_at).toISOString() : null }));
    return {
      accountStatus: a.status,
      security: {
        profileHidden: !!a.admin_profile_hidden, messagingPaused: !!a.admin_messaging_paused, dealsFrozen: !!a.admin_deals_frozen,
        suspendedAt: a.suspended_at ? new Date(a.suspended_at).toISOString() : null,
        pausedAt: a.paused_at ? new Date(a.paused_at).toISOString() : null,
      },
      activeSessions: Number(sess?.rows?.[0]?.n ?? 0),
      openTicketCount: openTickets.length,
      openTickets,
      elevatedForDangerousActions: await this.isElevated(ctx),
    };
  }

  /** Support action: cut every live session for this technician (e.g. a lost device) without changing account status. */
  async revokeSessions(ctx: AdminCtx, profileId: string) {
    const acct = await this.status(profileId);
    if (acct === 'anonymized' || acct === 'merged') throw new GlobalTechAdminError('invalid', `This account is ${acct}.`);
    const revoked = await this.revokeAllSessions(ctx, profileId, 'sessions_only', null, 'super_admin_revoke_sessions');
    await this.audit(ctx, 'super_admin.tech_sessions_revoked', profileId, { sessionsRevoked: revoked });
    return { ok: true as const, sessionsRevoked: revoked };
  }

  // ── pause: a temporary, reversible restriction, kept deliberately distinct from a suspension ─────────────

  /**
   * Pause a technician's global account. Reversible and technician-friendly (a break, a review, a self-request) — NOT a
   * security action. A pause carries its own fields and never touches the suspend fields. Optional expiry is advisory.
   */
  async pauseAccount(ctx: AdminCtx, profileId: string, reason: string, opts?: { expiresAt?: string | null }) {
    const r = String(reason ?? '').trim();
    if (!r) throw new GlobalTechAdminError('invalid', 'A pause needs a reason on the record.');
    const cur = await this.status(profileId);
    if (cur !== 'active') throw new GlobalTechAdminError('invalid', `Only an active account can be paused. This one is ${cur}.`);
    let expiresAt: Date | null = null;
    if (opts?.expiresAt) { const d = new Date(opts.expiresAt); if (!Number.isNaN(d.getTime())) expiresAt = d; }

    await sql`update global_tech_profiles
                 set status = 'paused', paused_at = now(), pause_reason = ${r}, pause_expires_at = ${expiresAt}, updated_at = now()
               where id = ${profileId} and status = ${cur} and ${canMoveToSql(GLOBAL_TECH_PROFILE, 'paused')} returning id`.execute(this.need()).then(moved(cur, 'paused'));
    await this.recordStatusEvent(ctx, profileId, cur, 'paused', 'paused', r, expiresAt);
    await this.audit(ctx, 'super_admin.tech_account_paused', profileId, { reason: r, expiresAt: expiresAt ? expiresAt.toISOString() : null });
    await this.notifyProfileTechnicians(profileId, 'Account paused', 'Your platform account has been temporarily paused.');
    return { ok: true as const, status: 'paused' as const };
  }

  /** Lift a pause. Only a paused account can be reactivated this way — a suspension uses restore(), a lock its own path. */
  async reactivateAccount(ctx: AdminCtx, profileId: string) {
    const cur = await this.status(profileId);
    if (cur !== 'paused') throw new GlobalTechAdminError('invalid', `Only a paused account can be reactivated. This one is ${cur}.`);

    await sql`update global_tech_profiles
                 set status = 'active', paused_at = null, pause_reason = null, pause_expires_at = null, updated_at = now()
               where id = ${profileId} and status = ${cur} and ${canMoveToSql(GLOBAL_TECH_PROFILE, 'active')} returning id`.execute(this.need()).then(moved(cur, 'active'));
    await this.recordStatusEvent(ctx, profileId, cur, 'active', 'reactivated', null);
    await this.audit(ctx, 'super_admin.tech_account_reactivated', profileId, {});
    await this.notifyProfileTechnicians(profileId, 'Account reactivated', 'Your platform account is active again.');
    return { ok: true as const, status: 'active' as const };
  }

  // ── lock / unlock: a security lock (manual here; the same status an automatic lockout would set) ─────────

  /** Lock the account — a security stop. Blocks login (status ≠ active) and cuts live sessions. Reason required. */
  async lockAccount(ctx: AdminCtx, profileId: string, reason: string) {
    const r = String(reason ?? '').trim();
    if (!r) throw new GlobalTechAdminError('invalid', 'A security lock needs a reason on the record.');
    const cur = await this.status(profileId);
    if (cur !== 'active' && cur !== 'paused') throw new GlobalTechAdminError('invalid', `Only an active or paused account can be locked. This one is ${cur}.`);

    await sql`update global_tech_profiles set status = 'locked', updated_at = now() where id = ${profileId} and status = ${cur} and ${canMoveToSql(GLOBAL_TECH_PROFILE, 'locked')} returning id`.execute(this.need()).then(moved(cur, 'locked'));
    const revoked = await this.revokeAllSessions(ctx, profileId, 'suspend', r, 'super_admin_lock');
    await this.recordStatusEvent(ctx, profileId, cur, 'locked', 'locked', r);
    await this.audit(ctx, 'super_admin.tech_account_locked', profileId, { reason: r, sessionsRevoked: revoked });
    await this.notifyProfileTechnicians(profileId, 'Account locked', 'Your platform account has been locked for security. Please contact support.');
    return { ok: true as const, status: 'locked' as const, sessionsRevoked: revoked };
  }

  /** Reset the lock — unlock a locked account back to active. */
  async unlockAccount(ctx: AdminCtx, profileId: string) {
    const cur = await this.status(profileId);
    if (cur !== 'locked') throw new GlobalTechAdminError('invalid', `Only a locked account can be unlocked. This one is ${cur}.`);

    await sql`update global_tech_profiles set status = 'active', updated_at = now() where id = ${profileId} and status = ${cur} and ${canMoveToSql(GLOBAL_TECH_PROFILE, 'active')} returning id`.execute(this.need()).then(moved(cur, 'active'));
    await restorePlatformTechnicianAccess(this.need(), { globalTechProfileId: profileId, actor: { userId: ctx.userId || null, role: 'SUPER_ADMIN' }, source: 'super_admin_unlock' });
    await this.recordStatusEvent(ctx, profileId, cur, 'active', 'unlocked', null);
    await this.audit(ctx, 'super_admin.tech_account_unlocked', profileId, {});
    await this.notifyProfileTechnicians(profileId, 'Account unlocked', 'Your platform account has been unlocked. You may sign in again.');
    return { ok: true as const, status: 'active' as const };
  }

  /** GET the account-status history — the append-only trail of every pause/suspend/restore decision. */
  async statusHistory(profileId: string) {
    const r: any = await sql`select from_status, to_status, action, scope, reason, actor_user_id, expires_at, created_at
                               from tech_account_status_events where global_tech_profile_id = ${profileId}
                              order by created_at desc limit 200`.execute(this.need());
    return { events: (r?.rows ?? []).map((e: any) => ({
      fromStatus: e.from_status ?? null, toStatus: e.to_status, action: e.action, scope: e.scope,
      reason: e.reason ?? null, expiresAt: e.expires_at ? new Date(e.expires_at).toISOString() : null,
      createdAt: new Date(e.created_at).toISOString(),
    })) };
  }

  /** Append-only status-change record. Best-effort: history must never block the state change it describes. */
  private async recordStatusEvent(ctx: AdminCtx, profileId: string, from: string | null, to: string, action: string, reason: string | null, expiresAt?: Date | null, scope = 'global_account', targetId?: string | null, targetKind?: string | null) {
    await sql`insert into tech_account_status_events (global_tech_profile_id, from_status, to_status, action, scope, reason, actor_user_id, expires_at, target_id, target_kind)
                values (${profileId}, ${from}, ${to}, ${action}, ${scope}, ${reason}, ${ctx?.userId ?? null}, ${expiresAt ?? null}, ${targetId ?? null}, ${targetKind ?? null})`
      .execute(this.need()).catch(() => {});
  }

  // ── membership-level pause: one salon relationship, without touching the global account or the others ────

  private async membershipRow(membershipId: string): Promise<{ id: string; profileId: string; tenantId: string; status: string } | null> {
    const r: any = await sql`select id, global_tech_profile_id, tenant_id, status from tech_salon_memberships where id = ${membershipId} limit 1`.execute(this.need());
    if (!r?.rows?.length) return null;
    const row = r.rows[0];
    return { id: row.id, profileId: row.global_tech_profile_id, tenantId: row.tenant_id, status: String(row.status) };
  }

  /**
   * Pause ONE salon membership. The global account and every other membership are untouched — this is the concrete
   * proof that global-account status and membership status are separate concepts. Reversible; a reason is required.
   */
  async pauseMembership(ctx: AdminCtx, membershipId: string, reason: string) {
    const r = String(reason ?? '').trim();
    if (!r) throw new GlobalTechAdminError('invalid', 'Pausing a salon membership needs a reason on the record.');
    const m = await this.membershipRow(membershipId);
    if (!m) throw new GlobalTechAdminError('not_found', 'No such salon membership.');
    if (m.status !== 'active') throw new GlobalTechAdminError('invalid', `Only an active membership can be paused. This one is ${m.status}.`);

    await sql`update tech_salon_memberships set status = 'paused', paused_at = now(), pause_reason = ${r}, updated_at = now() where id = ${membershipId} and status = 'active' and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'paused')} returning id`.execute(this.need()).then(moved('active', 'paused', TECH_SALON_MEMBERSHIP));
    await this.recordStatusEvent(ctx, m.profileId, 'active', 'paused', 'membership_paused', r, null, 'salon_membership', membershipId, 'membership');
    await this.audit(ctx, 'super_admin.tech_membership_paused', m.profileId, { membershipId, tenantId: m.tenantId, reason: r });
    return { ok: true as const, membershipId, status: 'paused' as const };
  }

  /** Lift a membership pause — back to active, global account and siblings unaffected. */
  async reactivateMembership(ctx: AdminCtx, membershipId: string) {
    const m = await this.membershipRow(membershipId);
    if (!m) throw new GlobalTechAdminError('not_found', 'No such salon membership.');
    if (m.status !== 'paused') throw new GlobalTechAdminError('invalid', `Only a paused membership can be reactivated. This one is ${m.status}.`);

    await sql`update tech_salon_memberships set status = 'active', paused_at = null, pause_reason = null, updated_at = now() where id = ${membershipId} and status = 'paused' and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'active')} returning id`.execute(this.need()).then(moved('paused', 'active', TECH_SALON_MEMBERSHIP));
    await this.recordStatusEvent(ctx, m.profileId, 'paused', 'active', 'membership_reactivated', null, null, 'salon_membership', membershipId, 'membership');
    await this.audit(ctx, 'super_admin.tech_membership_reactivated', m.profileId, { membershipId, tenantId: m.tenantId });
    return { ok: true as const, membershipId, status: 'active' as const };
  }

  /**
   * Destination-salon approval for an incoming transfer. A membership parked at pending_salon_approval means the
   * receiving salon hasn't signed off yet. Approving moves it to the technician's own consent gate
   * (pending_tech_approval); rejecting closes it. The technician still has the final say after the salon approves.
   */
  async decideDestinationApproval(ctx: AdminCtx, membershipId: string, approve: boolean, reason?: string) {
    const m = await this.membershipRow(membershipId);
    if (!m) throw new GlobalTechAdminError('not_found', 'No such salon membership.');
    if (m.status !== 'pending_salon_approval') throw new GlobalTechAdminError('invalid', `This membership is ${m.status}, not awaiting destination approval.`);
    const to = approve ? 'pending_tech_approval' : 'rejected';
    await sql`update tech_salon_memberships set status = ${to}, updated_at = now() where id = ${membershipId} and status = 'pending_salon_approval' and ${canMoveToSql(TECH_SALON_MEMBERSHIP, to)} returning id`.execute(this.need()).then(moved('pending_salon_approval', to, TECH_SALON_MEMBERSHIP));
    await this.recordStatusEvent(ctx, m.profileId, 'pending_salon_approval', to, approve ? 'destination_approved' : 'destination_rejected', reason ? String(reason).trim() : null, null, 'salon_membership', membershipId, 'membership');
    await this.audit(ctx, `super_admin.tech_transfer_destination_${approve ? 'approved' : 'rejected'}`, m.profileId, { membershipId, tenantId: m.tenantId });
    return { ok: true as const, membershipId, status: to };
  }

  // ── scoped pauses: suppress ONE facet (public profile / messaging / deals) without changing account status ──────

  private static readonly SCOPED = {
    profile:   { col: 'admin_profile_hidden',   on: 'profile_hidden',   off: 'profile_shown' },
    messaging: { col: 'admin_messaging_paused',  on: 'messaging_paused', off: 'messaging_resumed' },
    deals:     { col: 'admin_deals_frozen',      on: 'deals_frozen',     off: 'deals_unfrozen' },
  } as const;

  /**
   * Suppress or restore one facet of a technician's public presence — their public profile, their DMs, or their deals —
   * as a Super Admin override that sits ON TOP of the technician's own setting (it never overwrites it). Pausing needs a
   * reason; the account's own status is untouched.
   */
  async setScopedPause(ctx: AdminCtx, profileId: string, scope: 'profile' | 'messaging' | 'deals', paused: boolean, reason?: string) {
    const def = GlobalTechAdminService.SCOPED[scope];
    if (!def) throw new GlobalTechAdminError('invalid', "scope must be 'profile', 'messaging', or 'deals'.");
    const r = String(reason ?? '').trim();
    if (paused && !r) throw new GlobalTechAdminError('invalid', 'Pausing a profile facet needs a reason on the record.');
    const cur = await this.status(profileId);
    if (cur === 'anonymized' || cur === 'merged') throw new GlobalTechAdminError('invalid', `This account is ${cur}.`);

    await sql`update global_tech_profiles set ${sql.raw(def.col)} = ${paused}, updated_at = now() where id = ${profileId}`.execute(this.need());
    await this.recordStatusEvent(ctx, profileId, null, paused ? 'suppressed' : 'restored', paused ? def.on : def.off, paused ? r : null, null, `scope_${scope}`, null, scope);
    await this.audit(ctx, `super_admin.tech_${paused ? def.on : def.off}`, profileId, { scope, paused, reason: paused ? r : null });
    return { ok: true as const, scope, paused };
  }

  // ── deletion: a request, then a decision, then the act ──────────────────────────────────────────────────

  async openDeleteRequest(profileId: string): Promise<DeleteRequestState | null> {
    const r: any = await sql`
      select id, global_tech_profile_id, status, reason, legal_hold
        from global_tech_delete_requests
       where global_tech_profile_id = ${profileId} and status in ('pending', 'approved')
       limit 1`.execute(this.need());
    const x = r?.rows?.[0];
    return x ? {
      requestId: String(x.id), profileId: String(x.global_tech_profile_id),
      status: String(x.status), reason: String(x.reason ?? ''), legalHold: !!x.legal_hold,
    } : null;
  }

  /** POST /super-admin/technicians/:id/delete-request — log the ask. Erasure starts here, never at the act. */
  async requestDeletion(ctx: AdminCtx, profileId: string, body: { reason?: string; requesterKind?: string; legalHold?: boolean }) {
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new GlobalTechAdminError('invalid', 'A deletion request needs a reason.');
    const kind = String(body?.requesterKind ?? 'technician');
    if (!['technician', 'support', 'legal'].includes(kind)) {
      throw new GlobalTechAdminError('invalid', 'requesterKind must be technician, support or legal.');
    }
    await this.status(profileId);   // 404s if the profile does not exist
    if (await this.openDeleteRequest(profileId)) {
      throw new GlobalTechAdminError('invalid', 'A deletion request is already open for this technician.');
    }

    const r: any = await sql`
      insert into global_tech_delete_requests
        (global_tech_profile_id, requester_kind, requested_by_user_id, reason, legal_hold)
      values (${profileId}, ${kind}, ${ctx.userId ?? null}, ${reason}, ${!!body?.legalHold})
      returning id`.execute(this.need());

    await this.audit(ctx, 'super_admin.tech_delete_requested', profileId, { requestId: String(r.rows[0].id), requesterKind: kind, reason });
    return { ok: true as const, requestId: String(r.rows[0].id), status: 'pending' as const };
  }

  /** Approve or reject the request. A SECOND decision, by a named human — never the same click as the act. */
  async decideDeletion(ctx: AdminCtx, requestId: string, decision: 'approve' | 'reject', note?: string) {
    if (decision !== 'approve' && decision !== 'reject') throw new GlobalTechAdminError('invalid', 'Decision must be approve or reject.');
    const r: any = await sql`
      update global_tech_delete_requests
         set status = ${decision === 'approve' ? 'approved' : 'rejected'},
             decided_by_user_id = ${ctx.userId ?? null}, decided_at = now(),
             decision_note = ${note ?? null}, updated_at = now()
       where id = ${requestId} and status = 'pending' and ${canMoveToSql(GLOBAL_TECH_DELETE_REQUEST, decision === 'approve' ? 'approved' : 'rejected')}
       returning global_tech_profile_id`.execute(this.need());
    if (!r?.rows?.length) throw new GlobalTechAdminError('not_found', 'No pending deletion request with that id.');

    await this.audit(ctx, `super_admin.tech_delete_${decision === 'approve' ? 'approved' : 'rejected'}`,
      String(r.rows[0].global_tech_profile_id), { requestId, note: note ?? null });
    return { ok: true as const, status: decision === 'approve' ? 'approved' : 'rejected' };
  }

  /**
   * POST /super-admin/technicians/:id/anonymize — the act itself.
   *
   * What it erases: the technician's OWN data — name, photo, bio, portfolio, specialties, followers, the phone
   * and email that identify her across salons. The keys are released; the tech_code is kept forever, so the id
   * can never be handed to anybody else.
   *
   * What it does NOT touch, deliberately: `technicians`, `tickets`, `payments`, `payroll`, `audit_logs`. The
   * spec says "Preserve required audit/payment/payroll history", and all of it keys on technician_id — the
   * SALON's employment record — never on the global profile. A salon's books survive the erasure of the person's
   * platform identity, which is exactly the distinction this whole architecture is built on.
   */
  async anonymize(ctx: AdminCtx, profileId: string) {
    const db = this.need();
    await this.requireElevation(ctx);
    const status = await this.status(profileId);
    const req = await this.openDeleteRequest(profileId);
    const d = decideAnonymize(status, req);
    if (!d.ok) throw new GlobalTechAdminError(d.code, d.message);

    const p: any = await sql`select tech_code from global_tech_profiles where id = ${profileId} limit 1`.execute(db);
    const techCode = String(p.rows[0].tech_code);

    await db.transaction().execute(async (trx: any) => {
      await sql`
        update global_tech_profiles set
          display_name = ${anonymizedDisplayName(techCode)},
          title = null, avatar_url = null, bio = null, years_experience = null,
          specialties = '[]'::jsonb, languages = '[]'::jsonb, profile_links = '{}'::jsonb,
          normalized_phone = null, phone_hash = null, email_normalized = null,
          is_public = false, is_bookable = false, marketplace_discovery_enabled = false,
          status = 'anonymized', anonymized_at = now(), anonymize_reason = ${req!.reason}, updated_at = now()
        where id = ${profileId} and ${canMoveToSql(GLOBAL_TECH_PROFILE, 'anonymized')} returning id`.execute(trx).then(moved(status, 'anonymized'));

      // Her portfolio comes down. It is her work, on her profile, and she asked for it to be gone.
      await sql`update tech_portfolio_photos set is_public = false, moderation_status = 'hidden', updated_at = now()
                 where global_tech_profile_id = ${profileId} and ${canMoveToSql(TECH_PORTFOLIO_PHOTO, 'hidden')}`.execute(trx);

      // Her followers are a relationship TO her. There is no longer a her to follow.
      await sql`delete from customer_favorite_techs where global_tech_profile_id = ${profileId}`.execute(trx);

      // Every employment ends. The membership rows STAY — a salon's roster history is the salon's record, and
      // deleting it would take payroll's referential integrity with it.
      await sql`update tech_salon_memberships
                   set status = 'former', end_date = coalesce(end_date, now()),
                       ended_reason = 'account_anonymized', updated_at = now()
                 where global_tech_profile_id = ${profileId} and status not in ('former', 'rejected', 'cancelled') and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'former')}`.execute(trx);

      // The logins close. The rows stay: audit_logs and payroll point at them.
      await sql`update users set status = 'inactive', updated_at = now()
                 where global_tech_profile_id = ${profileId} and ${canMoveToSql(USER_ACCOUNT, 'inactive')}`.execute(trx);

      await sql`update global_tech_delete_requests set status = 'completed', completed_at = now(), updated_at = now()
                 where id = ${req!.requestId} and ${canMoveToSql(GLOBAL_TECH_DELETE_REQUEST, 'completed')}`.execute(trx);
    });

    await this.audit(ctx, 'super_admin.tech_account_anonymized', profileId, { requestId: req!.requestId, techCode, reason: req!.reason });
    return { ok: true as const, status: 'anonymized' as const, techCode };
  }

  // ── merge ──────────────────────────────────────────────────────────────────────────────────────────────

  private async candidate(profileId: string, trx?: any): Promise<MergeCandidate | null> {
    const db = trx ?? this.need();
    const r: any = await sql`select id, tech_code, display_name, status from global_tech_profiles where id = ${profileId} limit 1`.execute(db);
    const x = r?.rows?.[0];
    if (!x) return null;
    // "Known at" = any membership OR any live roster row. A roster row with no membership (a legacy hire, a
    // transfer mid-flight) still means that salon has her books under this profile.
    const t: any = await sql`
      select tenant_id from tech_salon_memberships where global_tech_profile_id = ${profileId}
      union
      select tenant_id from technicians where global_tech_profile_id = ${profileId} and archived_at is null`.execute(db);
    return {
      profileId: String(x.id), techCode: String(x.tech_code), displayName: String(x.display_name ?? ''),
      status: String(x.status), tenantIds: (t?.rows ?? []).map((y: any) => String(y.tenant_id)),
    };
  }

  /**
   * GET /super-admin/technicians/duplicates — profiles that look like the same human.
   *
   * == WHAT IT CAN FIND ======================================================================================
   * uq_gtp_phone_hash / uq_gtp_email mean two LIVE profiles can never share a key — so the old "group by key"
   * query could, by construction, return nothing. What duplicates actually look like on this platform:
   *
   *   1. One profile has her PHONE, the other has her EMAIL (one salon hired her on each). The profiles share no
   *      key with each other — but each key is also carried by the `users` / `technicians` rows the OTHER profile
   *      is linked to. So this compares every profile's keys against the normalized phone / email on the roster
   *      and login rows of every other profile (the same identityKeys() normalization the identity service uses).
   *   2. A profile whose keys were NULLED (anonymized / merged) and a live profile with the same number. The
   *      tombstone's number is gone from global_tech_profiles, but the roster rows it is still linked to kept it;
   *      the same cross-table comparison finds the pair. Reported with the tombstone's status, so the operator
   *      sees "this is a released number being reused", which is allowed — not a merge candidate.
   *
   * == WHAT IT CANNOT FIND ===================================================================================
   *   * Two profiles with NO overlapping phone / email anywhere (a typo'd number, a second mobile, two salons that
   *     each stored only a name). The platform has nothing to compare; that pair is found by a human, not a query.
   *   * A roster row that was never linked to any profile (global_tech_profile_id IS NULL) — see
   *     scripts/backfill-global-tech.ts, which is where those get an identity.
   *   * Rows whose stored phone pre-dates the normalizer and is not E.164 (digits only): compared on the last 10
   *     digits as a fallback, which can over-match across country codes. Those pairs are flagged `weak: true`.
   */
  async duplicates() {
    const r: any = await sql`
      with keys as (
        -- every (profile, key) pair the platform knows, from the profile itself AND from the rows linked to it
        select p.id as profile_id, 'p:' || p.phone_hash as k, false as weak from global_tech_profiles p where p.phone_hash is not null
        union
        select p.id, 'e:' || p.email_normalized, false from global_tech_profiles p where p.email_normalized is not null
        union
        select t.global_tech_profile_id, 'n:' || t.normalized_phone, false from technicians t
         where t.global_tech_profile_id is not null and t.normalized_phone ~ '^\\+[0-9]{8,15}$'
        union
        select t.global_tech_profile_id, 'd:' || right(regexp_replace(t.normalized_phone, '[^0-9]', '', 'g'), 10), true from technicians t
         where t.global_tech_profile_id is not null and t.normalized_phone is not null
           and length(regexp_replace(t.normalized_phone, '[^0-9]', '', 'g')) >= 10
        union
        select t.global_tech_profile_id, 'e:' || lower(t.email), false from technicians t
         where t.global_tech_profile_id is not null and t.email is not null and t.email like '%@%'
        union
        select u.global_tech_profile_id, 'n:' || u.normalized_phone, false from users u
         where u.global_tech_profile_id is not null and u.normalized_phone ~ '^\\+[0-9]{8,15}$'
        union
        select u.global_tech_profile_id, 'e:' || lower(u.email), false from users u
         where u.global_tech_profile_id is not null and u.email is not null and u.email like '%@%'
        union
        -- the profile's own E.164 phone, in the same 'n:' space as the roster/login phones
        select p.id, 'n:' || p.normalized_phone, false from global_tech_profiles p where p.normalized_phone is not null
        union
        select p.id, 'd:' || right(regexp_replace(p.normalized_phone, '[^0-9]', '', 'g'), 10), true from global_tech_profiles p
         where p.normalized_phone is not null and length(regexp_replace(p.normalized_phone, '[^0-9]', '', 'g')) >= 10
      ), pairs as (
        select a.profile_id as a_id, b.profile_id as b_id, bool_and(a.weak) as weak
          from keys a join keys b on a.k = b.k and a.profile_id < b.profile_id
         group by a.profile_id, b.profile_id
      )
      select pr.a_id, pr.b_id, pr.weak,
             pa.tech_code as a_code, pa.display_name as a_name, pa.status as a_status, pa.created_at as a_created,
             pb.tech_code as b_code, pb.display_name as b_name, pb.status as b_status, pb.created_at as b_created
        from pairs pr
        join global_tech_profiles pa on pa.id = pr.a_id
        join global_tech_profiles pb on pb.id = pr.b_id
       where pa.status <> 'merged' and pb.status <> 'merged'
       order by pr.weak asc, pa.created_at asc`.execute(this.need());

    // Union-find over the pairs so A~B and B~C come back as ONE group {A, B, C}.
    const parent = new Map<string, string>();
    const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
    const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    const meta = new Map<string, any>();
    const weakIds = new Set<string>();
    for (const x of (r?.rows ?? [])) {
      const a = String(x.a_id), b = String(x.b_id);
      meta.set(a, { profileId: a, techCode: String(x.a_code), displayName: String(x.a_name ?? ''), status: String(x.a_status), createdAt: iso(x.a_created) });
      meta.set(b, { profileId: b, techCode: String(x.b_code), displayName: String(x.b_name ?? ''), status: String(x.b_status), createdAt: iso(x.b_created) });
      union(a, b);
      if (x.weak) { weakIds.add(a); weakIds.add(b); }
    }
    const groups = new Map<string, any[]>();
    for (const id of meta.keys()) { const root = find(id); const g = groups.get(root) ?? []; g.push(meta.get(id)); groups.set(root, g); }
    // The keys themselves are never returned — a phone hash is nobody's business but hers.
    return {
      groups: [...groups.values()].filter((g) => g.length > 1).map((g) => ({
        profiles: g.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
        // a group containing a tombstone is a RELEASED key being reused by a new person — informational, not mergeable
        containsTombstone: g.some((p) => p.status === 'anonymized'),
        weak: g.every((p) => weakIds.has(p.profileId)),
      })),
    };
  }

  /**
   * POST /super-admin/technicians/:canonicalId/merge — absorb `duplicateId` into `canonicalId`.
   *
   * Irreversible, so it is transactional and it refuses rather than guesses. Everything that belongs to the
   * TECHNICIAN moves: her employment records, her logins, her salon rosters, her portfolio, her ratings, her
   * followers. The losing profile is not deleted — it becomes a signpost pointing at the winner, keeping its
   * tech_code forever so the id is never handed out again.
   */
  async merge(ctx: AdminCtx, canonicalId: string, duplicateId: string, reason: string) {
    const db = this.need();
    await this.requireElevation(ctx);
    const r = String(reason ?? '').trim();
    if (!r) throw new GlobalTechAdminError('invalid', 'A merge needs a reason. It cannot be undone.');

    await db.transaction().execute(async (trx: any) => {
      // The decision is made INSIDE the transaction, on rows locked for the duration — two operators merging the
      // same pair, or a merge racing a hire, cannot both pass the "no shared salon" check and then both write.
      await sql`select id from global_tech_profiles where id in (${canonicalId}, ${duplicateId}) for update`.execute(trx);
      const decision = decideMerge(await this.candidate(canonicalId, trx), await this.candidate(duplicateId, trx));
      if (!decision.ok) throw new GlobalTechAdminError(decision.code, decision.message);

      // == KEY ORDER, AND WHY IT MATTERS ======================================================================
      // uq_gtp_phone_hash / uq_gtp_email are partial unique indexes over LIVE profiles. The old order — copy the
      // duplicate's keys onto the canonical row, THEN null them on the duplicate — put the same phone hash on two
      // live rows for one statement and failed with a unique violation on exactly the merges that mattered (the
      // ones where the duplicate held a key the survivor lacked). So: read the duplicate's keys, CLEAR them on the
      // duplicate (which also turns it into the signpost), and only then fill the survivor's blanks.
      const dk: any = await sql`select normalized_phone, phone_hash, email_normalized from global_tech_profiles where id = ${duplicateId}`.execute(trx);
      const dupKeys = dk.rows[0] ?? {};

      // The signpost. Keys released, tech_code kept forever.
      await sql`
        update global_tech_profiles set
          status = 'merged', merged_into_profile_id = ${canonicalId}, merged_at = now(),
          normalized_phone = null, phone_hash = null, email_normalized = null,
          is_public = false, is_bookable = false, marketplace_discovery_enabled = false, updated_at = now()
        where id = ${duplicateId} and ${canMoveToSql(GLOBAL_TECH_PROFILE, 'merged')} returning id`.execute(trx).then(moved(null, 'merged'));

      // The surviving profile inherits any key it was MISSING — that missing key is usually the very reason the
      // duplicate existed (one salon had her email, the other had her phone, and neither matched).
      await sql`
        update global_tech_profiles set
          normalized_phone = coalesce(normalized_phone, ${dupKeys.normalized_phone ?? null}),
          phone_hash       = coalesce(phone_hash,       ${dupKeys.phone_hash ?? null}),
          email_normalized = coalesce(email_normalized, ${dupKeys.email_normalized ?? null}),
          updated_at = now()
        where id = ${canonicalId}`.execute(trx);

      // Everything the technician owns follows her into the surviving account. (No shared salon — decideMerge —
      // so the one-roster-row-per-salon and one-login-per-salon indexes cannot fire here.)
      await sql`update technicians            set global_tech_profile_id = ${canonicalId}, updated_at = now() where global_tech_profile_id = ${duplicateId}`.execute(trx);
      await sql`update users                  set global_tech_profile_id = ${canonicalId}, updated_at = now() where global_tech_profile_id = ${duplicateId}`.execute(trx);
      await sql`update tech_salon_memberships set global_tech_profile_id = ${canonicalId}, updated_at = now() where global_tech_profile_id = ${duplicateId}`.execute(trx);
      await sql`update tech_portfolio_photos  set global_tech_profile_id = ${canonicalId}, updated_at = now() where global_tech_profile_id = ${duplicateId}`.execute(trx);
      await sql`update reviews                set global_tech_profile_id = ${canonicalId} where global_tech_profile_id = ${duplicateId}`.execute(trx);

      // A customer who followed BOTH profiles followed ONE person. She does not become two followers.
      await sql`delete from customer_favorite_techs f
                 where f.global_tech_profile_id = ${duplicateId}
                   and exists (select 1 from customer_favorite_techs g
                                where g.user_id = f.user_id and g.global_tech_profile_id = ${canonicalId})`.execute(trx);
      await sql`update customer_favorite_techs set global_tech_profile_id = ${canonicalId} where global_tech_profile_id = ${duplicateId}`.execute(trx);

      // The ratings and photo counts are denormalized on the profile. After a merge they are simply wrong until
      // recomputed — and a wrong star rating is the kind of quiet lie this codebase does not ship.
      await sql`
        update global_tech_profiles p set
          rating_count = (select count(*)::int from reviews r where r.global_tech_profile_id = ${canonicalId} and coalesce(r.is_public, true) and not coalesce(r.is_hidden_by_manager, false)),
          overall_rating = (select round(avg(r.rating)::numeric, 2) from reviews r where r.global_tech_profile_id = ${canonicalId} and coalesce(r.is_public, true) and not coalesce(r.is_hidden_by_manager, false)),
          portfolio_photo_count = (select count(*)::int from tech_portfolio_photos x where x.global_tech_profile_id = ${canonicalId} and x.moderation_status = 'approved' and x.is_public),
          updated_at = now()
        where p.id = ${canonicalId}`.execute(trx);
    });

    await this.audit(ctx, 'super_admin.tech_profiles_merged', canonicalId, { canonicalId, duplicateId, reason: r });
    return { ok: true as const, canonicalId, duplicateId };
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────────────

  private async status(profileId: string): Promise<string> {
    const r: any = await sql`select status from global_tech_profiles where id = ${profileId} limit 1`.execute(this.need());
    if (!r?.rows?.length) throw new GlobalTechAdminError('not_found', 'No such technician account.');
    return String(r.rows[0].status);
  }

  /** Platform-level, so tenant_id is null: this is an act ON a technician, not an act inside a salon. */
  /**
   * Elevated-approval second factor for the irreversible actions (anonymize, merge). Beyond holding the per-action
   * permission, the operator must currently be elevated — an approved, unexpired security_admin grant on the record.
   * This is what turns "you're allowed to" into "you're allowed to, right now, with sign-off."
   */
  /** Read-only: is the acting operator currently elevated for the dangerous technician actions (anonymize / merge)? */
  async myElevation(ctx: AdminCtx) {
    return { elevated: await this.isElevated(ctx) };
  }

  /** Is this operator currently elevated for `privilege` — an approved, unexpired grant on the record? */
  private async isElevated(ctx: AdminCtx, privilege = 'security_admin'): Promise<boolean> {
    const r: any = await sql`select 1 from privileged_access_grants
                               where user_id = ${ctx?.userId ?? null} and privilege = ${privilege}
                                 and status = 'active' and expires_at > now() limit 1`.execute(this.need()).catch(() => null);
    return !!r?.rows?.length;
  }

  private async requireElevation(ctx: AdminCtx, privilege = 'security_admin') {
    if (!(await this.isElevated(ctx, privilege))) throw new GlobalTechAdminError('elevation_required', `This action needs active elevated approval (an approved ${privilege} grant). Request one and have it approved first.`);
  }

  private async audit(ctx: AdminCtx, action: string, profileId: string, metadata: Record<string, unknown>) {
    await sql`
      insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
      values (null, ${ctx.userId ?? null}, 'SUPER_ADMIN', ${action}, 'global_tech_profile', ${profileId},
              ${ctx.ip ?? null}, ${JSON.stringify(metadata)}::jsonb)`.execute(this.need()).catch(() => {});
  }
}
