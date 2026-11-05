// platform-staff.repository.ts — platform accounts (users with role = 'SUPER_ADMIN') and their role changes.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { decideRoleChange, decideStatusChange, MIN_REASON, type RoleChangeDecision } from './platform-staff-core';

import type { PlatformStaffRow } from '@aipowersalon/api-contracts/platform';
import { canMoveToSql } from '@aipowersalon/database';
import { USER_ACCOUNT, SESSION } from '@aipowersalon/identity';
export type { PlatformStaffRow } from '@aipowersalon/api-contracts/platform';

export class KyselyPlatformStaffRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async list(): Promise<PlatformStaffRow[]> {
    const r = await sql<any>`select id, email, full_name, platform_role, status, last_login_at from users where role = 'SUPER_ADMIN' order by email`.execute(this.db);
    return r.rows.map((x: any) => ({ userId: String(x.id), email: x.email ?? null, fullName: x.full_name ?? null, platformRole: x.platform_role ?? null,
      status: String(x.status), lastLoginAt: x.last_login_at ? new Date(x.last_login_at).toISOString() : null }));
  }

  /**
   * Decide AND apply in one transaction: the platform accounts are locked first, so the active-super-admin count the
   * rule sees cannot change underneath it (two administrators demoting each other at once: the second sees one left).
   * A successful change revokes the target's sessions (their signed token carries the old role) and is audited.
   */
  async changeRole(actor: { userId: string; permissions: readonly string[] }, targetId: string, newRole: string, reason: string): Promise<RoleChangeDecision> {
    return this.db.transaction().execute(async (trx) => {
      const locked = (await sql<any>`select id, platform_role, status from users where role = 'SUPER_ADMIN' order by id for update`.execute(trx)).rows;
      const t = locked.find((x: any) => String(x.id) === targetId) ?? null;
      const activeSuperAdmins = locked.filter((x: any) => x.platform_role === 'PLATFORM_SUPER_ADMIN' && x.status === 'active').length;
      const d = decideRoleChange({ actor, target: t ? { userId: String(t.id), isPlatformAccount: true, status: String(t.status), currentRole: t.platform_role ?? null } : null,
        newRole, reason, activeSuperAdmins });
      if (!d.ok) return d;
      await sql`update users set platform_role = ${d.to}, updated_at = now() where id = ${targetId} and role = 'SUPER_ADMIN'`.execute(trx);
      await sql`update sessions set revoked_at = now(), status = 'revoked' where user_id = ${targetId} and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')}`.execute(trx);
      await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${actor.userId}, 'SUPER_ADMIN', 'platform_role_changed', 'platform_user', ${targetId},
                        ${JSON.stringify({ from: d.from, to: d.to, reason: reason.trim() })}::jsonb)`.execute(trx);
      return d;
    });
  }

  /** §24 suspend / reactivate — locked like a role change so the last-Super-Admin rule cannot race; suspension revokes sessions. */
  async changeStatus(actor: { userId: string; permissions: readonly string[] }, targetId: string, to: string, reason: string) {
    return this.db.transaction().execute(async (trx) => {
      const locked = (await sql<any>`select id, platform_role, status from users where role = 'SUPER_ADMIN' order by id for update`.execute(trx)).rows;
      const t = locked.find((x: any) => String(x.id) === targetId) ?? null;
      const activeSuperAdmins = locked.filter((x: any) => x.platform_role === 'PLATFORM_SUPER_ADMIN' && x.status === 'active').length;
      const d = decideStatusChange({ actor, target: t ? { userId: String(t.id), status: String(t.status), role: t.platform_role ?? null } : null, to, reason, activeSuperAdmins });
      if (!d.ok) return d;
      await sql`update users set status = ${d.to}, updated_at = now() where id = ${targetId} and role = 'SUPER_ADMIN' and ${canMoveToSql(USER_ACCOUNT, d.to)}`.execute(trx);
      if (d.to === 'suspended') await sql`update sessions set revoked_at = now(), status = 'revoked' where user_id = ${targetId} and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')}`.execute(trx);
      await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${actor.userId}, 'SUPER_ADMIN', ${d.to === 'suspended' ? 'platform_user_suspended' : 'platform_user_reactivated'}, 'platform_user', ${targetId},
                        ${JSON.stringify({ from: d.from, to: d.to, reason: reason.trim() })}::jsonb)`.execute(trx);
      return d;
    });
  }

  /** §24 View Sessions — a platform account's sessions, newest first (no tokens). */
  async sessions(targetId: string) {
    const r = await sql<any>`select s.id, s.status, s.created_at, s.expires_at, s.revoked_at, s.last_seen_at, s.ip_address::text as ip, s.user_agent, s.device_name, s.platform
                               from sessions s join users u on u.id = s.user_id and u.role = 'SUPER_ADMIN'
                              where s.user_id = ${targetId} order by s.created_at desc limit 50`.execute(this.db);
    return r.rows.map((x: any) => ({ id: String(x.id), status: String(x.status), createdAt: new Date(x.created_at).toISOString(), expiresAt: x.expires_at ? new Date(x.expires_at).toISOString() : null,
      revokedAt: x.revoked_at ? new Date(x.revoked_at).toISOString() : null, lastSeenAt: x.last_seen_at ? new Date(x.last_seen_at).toISOString() : null,
      ip: x.ip ?? null, userAgent: x.user_agent ?? null, device: x.device_name ?? x.platform ?? null }));
  }

  /** §24 Revoke Sessions — every live session of that platform account; audited with a reason. Not your own (use sign out). */
  async revokeSessions(actor: { userId: string; permissions: readonly string[] }, targetId: string, reason: string): Promise<{ ok: true; revoked: number } | { ok: false; status: 400 | 403 | 404; code: string; message: string }> {
    if (!actor.permissions.includes('super_admin.platform_roles.manage')) return { ok: false, status: 403, code: 'forbidden', message: 'Managing platform accounts requires super_admin.platform_roles.manage.' };
    if ((reason ?? '').trim().length < MIN_REASON) return { ok: false, status: 400, code: 'reason_required', message: `A reason of at least ${MIN_REASON} characters is required.` };
    if (targetId === actor.userId) return { ok: false, status: 403, code: 'self_change', message: 'Sign out of your own sessions from your account menu.' };
    return this.db.transaction().execute(async (trx) => {
      const exists = (await sql<any>`select 1 from users where id = ${targetId} and role = 'SUPER_ADMIN'`.execute(trx)).rows.length > 0;
      if (!exists) return { ok: false as const, status: 404 as const, code: 'not_found', message: 'Platform account not found.' };
      const r: any = await sql`update sessions set revoked_at = now(), status = 'revoked' where user_id = ${targetId} and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')}`.execute(trx);
      const revoked = Number(r?.numAffectedRows ?? r?.numUpdatedRows ?? 0);
      await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${actor.userId}, 'SUPER_ADMIN', 'platform_user_sessions_revoked', 'platform_user', ${targetId}, ${JSON.stringify({ revoked, reason: reason.trim() })}::jsonb)`.execute(trx);
      return { ok: true as const, revoked };
    });
  }

  /**
   * Constitution 7 §24 — reset a platform user's MFA. platform_roles.manage; never your own; reason ≥ MIN_REASON; a
   * platform account. One transaction: remove every authenticator, end every session, retire earlier unused recovery
   * tokens, create ONE single-use token (hash stored, 24 h), audit. The raw token is returned once — it is useless
   * without the user's own password.
   */
  async resetMfa(actor: { userId: string; permissions: readonly string[] }, targetId: string, reason: string):
      Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; status: 400 | 403 | 404; code: string; message: string }> {
    if (!actor.permissions.includes('super_admin.platform_roles.manage')) return { ok: false, status: 403, code: 'forbidden', message: 'Resetting a platform user\'s MFA requires super_admin.platform_roles.manage.' };
    if ((reason ?? '').trim().length < MIN_REASON) return { ok: false, status: 400, code: 'reason_required', message: `A reason of at least ${MIN_REASON} characters is required.` };
    if (targetId === actor.userId) return { ok: false, status: 403, code: 'self_change', message: 'You cannot reset your own MFA. Another platform administrator must.' };
    const { randomBytes, createHash } = await import('node:crypto');
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 3600_000);
    return this.db.transaction().execute(async (trx) => {
      const exists = (await sql<any>`select 1 from users where id = ${targetId} and role = 'SUPER_ADMIN'`.execute(trx)).rows.length > 0;
      if (!exists) return { ok: false as const, status: 404 as const, code: 'not_found', message: 'Platform account not found.' };
      await sql`delete from mfa_factors where user_id = ${targetId}`.execute(trx);
      await sql`update sessions set revoked_at = now(), status = 'revoked' where user_id = ${targetId} and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')}`.execute(trx);
      await sql`update mfa_recovery_tokens set used_at = now() where user_id = ${targetId} and used_at is null`.execute(trx);
      await sql`insert into mfa_recovery_tokens (user_id, token_hash, created_by, reason, expires_at) values (${targetId}, ${hash}, ${actor.userId}, ${reason.trim()}, ${expiresAt})`.execute(trx);
      await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${actor.userId}, 'SUPER_ADMIN', 'platform_user_mfa_reset', 'platform_user', ${targetId}, ${JSON.stringify({ reason: reason.trim(), recoveryExpiresAt: expiresAt.toISOString() })}::jsonb)`.execute(trx);
      return { ok: true as const, token, expiresAt: expiresAt.toISOString() };
    });
  }
}
