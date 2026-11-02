// revoke-technician-access.ts — the ONE termination / suspension chain for a technician's access (mandate §63, §137;
// merged Oct 12 2026 from the Technician Profile package's auth/revoke-technician-access.ts — it lives in the workforce
// module because employment lifecycle owns it; modules/identity (AUTH merge) and modules/super-admin import it from
// @aipowersalon/workforce). Before this, POS suspend/archive flipped `technicians.status` only, "disconnect membership"
// flipped the membership only, and the Super Admin path wrote `sessions.revoked_at` that no guard read — so a
// technician the salon had let go kept a working login, a live SSE stream and a kiosk Clock PIN.
//
// Every caller (TechniciansService.setLifecycle, TechProfileService.posDeactivateMembership,
// GlobalTechAdminService suspend/lock/revokeSessions) goes through here, so the chain cannot drift apart again:
//   1. users.status            → 'suspended' (suspend) | 'inactive' (terminate)   [sessions_only: untouched]
//   2. tech_salon_memberships  → terminate: 'former' (+ end_date); PLATFORM suspend: 'paused' (pause_reason
//                                'platform_suspend:…'); a SALON suspend leaves the employment as it is   [sessions_only: untouched]
//   3. sessions                → status 'revoked' AND revoked_at (both — the guard reads either)
//   4. refresh_tokens          → revoked_at
//   5. technician_clock_pins   → disabled_at (573) so the kiosk no longer identifies the PIN
//   6. audit row               → technician_access_revoked through modules/audit's repository, in the transaction
//   7. realtime                → none pushed here (§343); the revoked session check
//                                (sse-session-guard) ends the stream itself on the next tick.
// Pure Kysely/SQL over the real tables; no Nest. The caller supplies the db and the actor; a transaction is used so a
// half-applied revocation (login blocked but sessions alive, or the reverse) cannot exist.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { KyselyAuditRepository } from '@aipowersalon/audit';
import { SESSION, USER_ACCOUNT } from '@aipowersalon/identity';
import { TECH_SALON_MEMBERSHIP } from '../workforce-lifecycles';

export type RevokeMode = 'suspend' | 'terminate' | 'sessions_only';

export interface RevokeTechnicianAccessInput {
  /** Tenant the action is scoped to. For a platform-wide (Super Admin) revocation pass `globalTechProfileId` and
   *  `tenantId: null` — every salon login of that profile is cut. */
  tenantId: string | null;
  /** technicians.id (POS roster row) — resolves user_id + global profile when given. */
  technicianId?: string | null;
  /** users.id — when the caller already knows the login. */
  userId?: string | null;
  /** global_tech_profiles.id — platform-wide revocation across every tenant. */
  globalTechProfileId?: string | null;
  mode: RevokeMode;
  reason?: string | null;
  actor: { userId: string | null; role: string | null; branchId?: string | null };
  /** Source of the call, recorded in the audit row (e.g. 'pos_suspend', 'pos_archive', 'membership_deactivate', 'super_admin_suspend'). */
  source: string;
}

export interface RevokeTechnicianAccessResult {
  userIds: string[];
  usersUpdated: number;
  membershipsUpdated: number;
  sessionsRevoked: number;
  refreshTokensRevoked: number;
  clockPinsDisabled: number;
  technicianIds: string[];
}

export interface RevokeRealtimeHook { toTechnician(technicianId: string, event: any, payload?: unknown): void; }

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
/** The audit row, written through modules/audit's repository on THIS transaction (a revocation nobody can see in the
 *  audit trail is the bug — it is never best-effort here). Tenant → audit_events; platform → audit_logs. */
async function auditIn(trx: Kysely<any>, tenantId: string | null, actor: { userId: string | null; role: string | null; branchId?: string | null }, action: string, resourceType: string, resourceId: string | null, metadata: Record<string, unknown>): Promise<void> {
  const repo = new KyselyAuditRepository(trx as any);
  if (tenantId) await repo.record({ tenantId, branchId: isUuid(actor.branchId) ? actor.branchId : null, userId: isUuid(actor.userId) ? actor.userId : null, role: actor.role ?? null }, { module: 'workforce', action, resourceType, resourceId, metadata });
  else await repo.recordPlatform({ userId: actor.userId, role: actor.role, module: 'workforce', action, resourceType, resourceId, metadata } as any);
}
/** Salon-side membership moves the chain may make (machine TECH_SALON_MEMBERSHIP). A SALON suspension leaves the
 *  employment (membership) as it is — the roster status, the login, the sessions and the Clock PIN carry it; only the
 *  PLATFORM (Super Admin, tenantId null) pauses memberships, marked so the platform restore lifts exactly those. */
const PLATFORM_PAUSE = 'platform_suspend';

const rows = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
const affected = (r: any): number => Number(r?.numAffectedRows ?? r?.numUpdatedRows ?? 0);

/** Resolve the set of (user_id, technician_id, tenant_id) rows this revocation covers. */
async function resolveTargets(db: Kysely<any>, input: RevokeTechnicianAccessInput): Promise<{ userIds: string[]; technicianIds: string[]; tenantIds: string[]; profileId: string | null }> {
  const userIds = new Set<string>(); const technicianIds = new Set<string>(); const tenantIds = new Set<string>();
  let profileId: string | null = input.globalTechProfileId ?? null;
  if (input.technicianId && input.tenantId) {
    const r = rows(await sql`select id, user_id, global_tech_profile_id, tenant_id from technicians
                               where id = ${input.technicianId} and tenant_id = ${input.tenantId} limit 1`.execute(db))[0];
    if (r) {
      technicianIds.add(String(r.id)); tenantIds.add(String(r.tenant_id));
      if (r.user_id) userIds.add(String(r.user_id));
      if (!profileId && r.global_tech_profile_id) profileId = String(r.global_tech_profile_id);
    }
  }
  if (input.userId) {
    userIds.add(input.userId);
    if (input.tenantId) tenantIds.add(input.tenantId);
    for (const t of rows(await sql`select id, tenant_id from technicians where user_id = ${input.userId}${input.tenantId ? sql` and tenant_id = ${input.tenantId}` : sql``}`.execute(db))) {
      technicianIds.add(String(t.id)); tenantIds.add(String(t.tenant_id));
    }
  }
  if (profileId && !input.tenantId) {
    // platform-wide: every salon login + roster row of this profile
    for (const u of rows(await sql`select id, tenant_id from users where global_tech_profile_id = ${profileId}`.execute(db))) {
      userIds.add(String(u.id)); if (u.tenant_id) tenantIds.add(String(u.tenant_id));
    }
    for (const t of rows(await sql`select id, tenant_id, user_id from technicians where global_tech_profile_id = ${profileId}`.execute(db))) {
      technicianIds.add(String(t.id)); tenantIds.add(String(t.tenant_id)); if (t.user_id) userIds.add(String(t.user_id));
    }
  } else if (profileId && input.tenantId) {
    // tenant-scoped but keyed by profile: this salon's login(s) for the profile
    for (const u of rows(await sql`select id from users where global_tech_profile_id = ${profileId} and tenant_id = ${input.tenantId}`.execute(db))) userIds.add(String(u.id));
    for (const t of rows(await sql`select id, user_id from technicians where global_tech_profile_id = ${profileId} and tenant_id = ${input.tenantId}`.execute(db))) {
      technicianIds.add(String(t.id)); if (t.user_id) userIds.add(String(t.user_id));
    }
    tenantIds.add(input.tenantId);
  }
  return { userIds: [...userIds], technicianIds: [...technicianIds], tenantIds: [...tenantIds], profileId };
}

export async function revokeTechnicianAccess(db: Kysely<any>, input: RevokeTechnicianAccessInput): Promise<RevokeTechnicianAccessResult> {
  const reason = input.reason ? String(input.reason).slice(0, 500) : null;
  const result = await db.transaction().execute(async (trx) => {
    const t = await resolveTargets(trx, input);
    const out: RevokeTechnicianAccessResult = { userIds: t.userIds, technicianIds: t.technicianIds, usersUpdated: 0, membershipsUpdated: 0, sessionsRevoked: 0, refreshTokensRevoked: 0, clockPinsDisabled: 0 };

    if (input.mode !== 'sessions_only') {
      const userStatus = input.mode === 'suspend' ? 'suspended' : 'inactive';
      for (const uid of t.userIds) {
        // never demote a SUPER_ADMIN or an OWNER login through the technician chain
        out.usersUpdated += affected(await sql`update users set status = ${userStatus}, updated_at = now()
                                                where id = ${uid} and role = 'TECHNICIAN' and status <> ${userStatus} and ${canMoveToSql(USER_ACCOUNT, userStatus)}`.execute(trx));
      }
      if (t.profileId && input.mode === 'terminate') {
        const scope = input.tenantId ? sql` and tenant_id = ${input.tenantId}` : sql``;
        out.membershipsUpdated += affected(await sql`update tech_salon_memberships
             set status = 'former', end_date = coalesce(end_date, now()), updated_at = now()
           where global_tech_profile_id = ${t.profileId} and status in ('active', 'paused', 'suspended')
             and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'former')}${scope}`.execute(trx));
      } else if (t.profileId && input.mode === 'suspend' && !input.tenantId) {
        out.membershipsUpdated += affected(await sql`update tech_salon_memberships
             set status = 'paused', paused_at = now(), pause_reason = ${PLATFORM_PAUSE + ':' + String(input.reason ?? '').slice(0, 200)}, updated_at = now()
           where global_tech_profile_id = ${t.profileId} and status = 'active' and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'paused')}`.execute(trx));
      }
    }

    for (const uid of t.userIds) {
      const scope = input.tenantId ? sql` and (tenant_id = ${input.tenantId} or tenant_id is null)` : sql``;
      out.sessionsRevoked += affected(await sql`update sessions set status = 'revoked', revoked_at = coalesce(revoked_at, now())
                                                 where user_id = ${uid} and (status <> 'revoked' or revoked_at is null) and ${canMoveToSql(SESSION, 'revoked')}${scope}`.execute(trx));
      try {
        out.refreshTokensRevoked += affected(await sql`update refresh_tokens set revoked_at = now()
                                                        where user_id = ${uid} and revoked_at is null`.execute(trx));
      } catch { /* refresh_tokens may not carry revoked_at in every deployment; the session row is the authority */ }
    }

    for (const tid of t.technicianIds) {
      out.clockPinsDisabled += affected(await sql`update technician_clock_pins
            set disabled_at = coalesce(disabled_at, now()), disabled_reason = ${input.mode + ':' + input.source}, updated_at = now()
          where technician_id = ${tid} and disabled_at is null${input.tenantId ? sql` and tenant_id = ${input.tenantId}` : sql``}`.execute(trx));
    }

    // Audit — one row per affected tenant (the Super Admin audit screens read per tenant). Never the reason verbatim
    // beyond 500 chars, never a token or PIN.
    const tenants = t.tenantIds.length ? t.tenantIds : [input.tenantId].filter(Boolean) as string[];
    for (const tenantId of tenants.length ? tenants : [null]) {
      await auditIn(trx, tenantId, input.actor, 'technician_access_revoked', 'technician', t.technicianIds[0] ?? t.userIds[0] ?? t.profileId ?? null,
        { mode: input.mode, source: input.source, reason, userIds: t.userIds, technicianIds: t.technicianIds, globalTechProfileId: t.profileId,
          usersUpdated: out.usersUpdated, membershipsUpdated: out.membershipsUpdated, sessionsRevoked: out.sessionsRevoked, clockPinsDisabled: out.clockPinsDisabled });
    }
    return out;
  });

  // No realtime push from here (§343): the revoked session ends the technician's SSE stream itself (sse-session-guard
  // reads the store), and the boards refetch from the lifecycle's own events. A nudge to a room whose stream is being
  // cut told nobody anything.
  return result;
}

/**
 * The inverse for a REINSTATEMENT (POS activate/reactivate, Super Admin restore/unlock): a login the technician chain
 * suspended is re-enabled, and the salon membership returns to active. Sessions stay revoked (they sign in again),
 * and the Clock PIN stays disabled until a manager resets it — a reinstated technician gets a fresh PIN, not the old
 * one that was live during the suspension.
 */
export async function restoreTechnicianAccess(db: Kysely<any>, input: { tenantId: string; technicianId: string; actor: { userId: string | null; role: string | null; branchId?: string | null }; source: string }): Promise<{ usersUpdated: number; membershipsUpdated: number }> {
  return db.transaction().execute(async (trx) => {
    const t = await resolveTargets(trx, { tenantId: input.tenantId, technicianId: input.technicianId, mode: 'suspend', actor: input.actor, source: input.source });
    let usersUpdated = 0; let membershipsUpdated = 0;
    for (const uid of t.userIds) {
      // a login the PLATFORM has blocked (global profile paused / locked / suspended / anonymized / merged) is not
      // reinstated by a salon's "activate" — the Super Admin restores it
      usersUpdated += affected(await sql`update users set status = 'active', updated_at = now()
                                          where id = ${uid} and role = 'TECHNICIAN' and status in ('suspended', 'inactive') and ${canMoveToSql(USER_ACCOUNT, 'active')}
                                            and not exists (select 1 from global_tech_profiles g where g.id = users.global_tech_profile_id
                                                              and g.status in ('paused', 'locked', 'suspended', 'anonymized', 'merged'))`.execute(trx));
    }
    if (t.profileId) {
      // former → active only (an archive / disconnect reversed); a platform-paused membership stays the platform's
      membershipsUpdated += affected(await sql`update tech_salon_memberships set status = 'active', end_date = null, updated_at = now()
                                                where global_tech_profile_id = ${t.profileId} and tenant_id = ${input.tenantId} and status = 'former'
                                                  and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'active')}`.execute(trx));
    }
    await auditIn(trx, input.tenantId, input.actor, 'technician_access_restored', 'technician', input.technicianId, { source: input.source, userIds: t.userIds, usersUpdated, membershipsUpdated });
    return { usersUpdated, membershipsUpdated };
  });
}

/** Platform-wide inverse (Super Admin restore / unlock): every TECHNICIAN login of the profile that the chain
 *  suspended returns to active, and memberships the chain suspended return to active. Sessions and Clock PINs are
 *  NOT resurrected. NOTE: a membership a salon itself suspended before the platform action is also reactivated here
 *  (the chain does not record which actor suspended it); the salon's POS roster status (technicians.status) is
 *  untouched, so that salon's own suspension still holds on its side. */
export async function restorePlatformTechnicianAccess(db: Kysely<any>, input: { globalTechProfileId: string; actor: { userId: string | null; role: string | null }; source: string }): Promise<{ usersUpdated: number; membershipsUpdated: number }> {
  return db.transaction().execute(async (trx) => {
    const usersUpdated = affected(await sql`update users set status = 'active', updated_at = now()
                                             where global_tech_profile_id = ${input.globalTechProfileId} and role = 'TECHNICIAN' and status = 'suspended'
                                               and ${canMoveToSql(USER_ACCOUNT, 'active')}`.execute(trx));
    const membershipsUpdated = affected(await sql`update tech_salon_memberships set status = 'active', paused_at = null, pause_reason = null, updated_at = now()
                                                   where global_tech_profile_id = ${input.globalTechProfileId} and status = 'paused' and pause_reason like ${PLATFORM_PAUSE + ':%'}
                                                     and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'active')}`.execute(trx));
    await auditIn(trx, null, input.actor, 'technician_access_restored', 'global_tech_profile', input.globalTechProfileId, { source: input.source, usersUpdated, membershipsUpdated });
    return { usersUpdated, membershipsUpdated };
  });
}
