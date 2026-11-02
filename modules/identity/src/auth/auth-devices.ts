// auth-devices.ts — Constitution 3 §21–24 (Step 4, Oct 3 2026): the devices each user signs in from, and their trust.
//   new → recognized (second sign-in) → trusted (the user marks it, from a session that proved MFA; ALWAYS with an end
//   date — 30 days) → back to recognized when trust lapses. suspicious is reserved for the risk layer (§58–60). revoked
//   = the user signed it out (its sessions and refresh tokens end; a later sign-in starts it again as new). blocked = the
//   user refuses it: sign-in from it is refused until they unblock it.
// A trusted device never stands in for a credential (Constitution 12 §323) — trust only shapes alerts and the device list.
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION, BIOMETRIC_CREDENTIAL } from './identity-lifecycles';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';

export type TrustState = 'new' | 'recognized' | 'trusted' | 'suspicious' | 'blocked' | 'revoked';
export const TRUST_DAYS = 30;
export const WEB_DEVICE_COOKIE = 'aps_device';
export interface AuthDevice { id: string; name: string | null; platform: string | null; trustState: TrustState; trustedUntil: string | null; firstSeenAt: string; lastSeenAt: string; signInCount: number;
  /** S-A13: approved for platform (Super Admin) sign-in — null for salon accounts and unapproved devices. */
  platformApprovedAt?: string | null }
export const hashDeviceKey = (key: string) => createHash('sha256').update(String(key)).digest('hex');
export const newWebDeviceKey = () => 'dv_' + randomBytes(24).toString('base64url');
/** A usable device key: the native per-install id or the web cookie (bounded, printable). */
export function validDeviceKey(k: unknown): k is string { return typeof k === 'string' && /^[A-Za-z0-9_\-]{16,128}$/.test(k); }

/** The state a device moves to when its user signs in from it again (pure). */
export function stateOnSignIn(cur: { trustState: TrustState; trustedUntilMs: number | null } | null, nowMs: number): TrustState | 'refuse' {
  if (!cur) return 'new';
  if (cur.trustState === 'blocked') return 'refuse';
  if (cur.trustState === 'revoked') return 'new';
  if (cur.trustState === 'trusted') return cur.trustedUntilMs && cur.trustedUntilMs > nowMs ? 'trusted' : 'recognized';
  if (cur.trustState === 'new') return 'recognized';
  return cur.trustState;   // recognized / suspicious stay as they are
}

export class DeviceError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }

export class KyselyAuthDevices {
  constructor(private readonly db: any, private readonly now: () => number = () => Date.now()) {}
  private static row(r: any): AuthDevice {
    return { id: String(r.id), name: r.name ?? null, platform: r.platform ?? null, trustState: r.trust_state, trustedUntil: r.trusted_until ? new Date(r.trusted_until).toISOString() : null,
      firstSeenAt: new Date(r.first_seen_at).toISOString(), lastSeenAt: new Date(r.last_seen_at).toISOString(), signInCount: Number(r.sign_in_count),
      platformApprovedAt: r.platform_approved_at ? new Date(r.platform_approved_at).toISOString() : null };
  }
  /** At sign-in. Returns the device id, or 'refuse' for a device its user blocked. */
  async recordSignIn(userId: string, key: string, info: { name?: string | null; platform?: string | null; ip?: string | null }): Promise<{ deviceId: string; isNew: boolean; hadOtherDevices: boolean } | 'refuse'> {
    const h = hashDeviceKey(key);
    const cur: any = (await sql`select id, trust_state, trusted_until from auth_devices where user_id = ${userId}::uuid and device_key_hash = ${h}`.execute(this.db)).rows[0];
    const next = stateOnSignIn(cur ? { trustState: cur.trust_state, trustedUntilMs: cur.trusted_until ? new Date(cur.trusted_until).getTime() : null } : null, this.now());
    if (next === 'refuse') return 'refuse';
    const name = info.name ? String(info.name).slice(0, 80) : null, platform = info.platform ? String(info.platform).slice(0, 20) : null, ip = info.ip ? String(info.ip).slice(0, 64) : null;
    const r: any = await sql`insert into auth_devices (user_id, device_key_hash, name, platform, trust_state, last_ip)
        values (${userId}::uuid, ${h}, ${name}, ${platform}, ${next}, ${ip})
      on conflict (user_id, device_key_hash) do update set trust_state = ${next}, last_seen_at = now(), last_ip = excluded.last_ip,
        name = coalesce(excluded.name, auth_devices.name), platform = coalesce(excluded.platform, auth_devices.platform),
        sign_in_count = auth_devices.sign_in_count + 1,
        trusted_until = case when ${next} = 'trusted' then auth_devices.trusted_until else null end
      returning id`.execute(this.db);
    const deviceId = String(r.rows[0].id);
    // §89: "new device" = never seen for this user (a revoked device signing in again counts as new too)
    const isNew = !cur || cur.trust_state === 'revoked';
    const others: any = isNew ? (await sql`select count(*)::int as n from auth_devices where user_id = ${userId}::uuid and id <> ${deviceId}::uuid`.execute(this.db)).rows[0] : { n: 0 };
    return { deviceId, isNew, hadOtherDevices: Number(others?.n ?? 0) > 0 };
  }
  async list(userId: string): Promise<AuthDevice[]> {
    const r: any = await sql`select * from auth_devices where user_id = ${userId}::uuid and trust_state <> 'revoked' order by last_seen_at desc limit 50`.execute(this.db);
    return r.rows.map(KyselyAuthDevices.row);
  }
  /** Trust a device for TRUST_DAYS — only from a session that proved a second factor at sign-in. */
  async trust(userId: string, deviceId: string, session: { mfaAt: string | null }): Promise<AuthDevice> {
    if (!session.mfaAt) throw new DeviceError('MFA_REQUIRED', 'Trusting a device needs a sign-in that used your authenticator.', 403);
    const until = new Date(this.now() + TRUST_DAYS * 86_400_000);
    const r: any = await sql`update auth_devices set trust_state = 'trusted', trusted_until = ${until}
      where id = ${deviceId}::uuid and user_id = ${userId}::uuid and trust_state not in ('blocked', 'revoked') returning *`.execute(this.db);
    if (!r.rows[0]) throw new DeviceError('NOT_FOUND', 'That device is not on your account.', 404);
    return KyselyAuthDevices.row(r.rows[0]);
  }
  /** Revoke (sign it out and forget its trust) or block (also refuse future sign-ins). Ends its sessions + refresh tokens. */
  async revoke(userId: string, deviceId: string, how: 'revoked' | 'blocked' = 'revoked'): Promise<{ sessionsEnded: number }> {
    return this.db.transaction().execute(async (trx: any) => {
      // S-A13: a revoked / blocked device also loses its platform approval
      const r: any = await sql`update auth_devices set trust_state = ${how}, trusted_until = null, platform_approved_at = null, platform_approved_via = null where id = ${deviceId}::uuid and user_id = ${userId}::uuid returning id`.execute(trx);
      if (!r.rows[0]) throw new DeviceError('NOT_FOUND', 'That device is not on your account.', 404);
      const s: any = await sql`update sessions set revoked_at = now(), status = 'revoked' where auth_device_id = ${deviceId}::uuid and user_id = ${userId}::uuid and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')} returning id`.execute(trx);
      const ids = s.rows.map((x: any) => String(x.id));
      if (ids.length) await sql`update refresh_tokens set revoked_at = now() where session_id = any(${ids}::uuid[]) and revoked_at is null`.execute(trx);
      // BUILD_PLAN Phase 13 D (Constitution 6 §37): Face ID on that device can never open a new session again
      await sql`update device_biometric_credentials set status = 'revoked', revoked_at = now(), revoked_reason = ${'device_' + how}
                 where auth_device_id = ${deviceId}::uuid and user_id = ${userId}::uuid and ${canMoveToSql(BIOMETRIC_CREDENTIAL, 'revoked')}`.execute(trx);
      return { sessionsEnded: ids.length };
    });
  }
  async unblock(userId: string, deviceId: string): Promise<void> {
    await sql`update auth_devices set trust_state = 'revoked' where id = ${deviceId}::uuid and user_id = ${userId}::uuid and trust_state = 'blocked'`.execute(this.db);
  }
}
