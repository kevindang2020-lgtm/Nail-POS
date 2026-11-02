// platform-device-trust.ts — Security Deep Scan §29 / §136 (S-A13, Oct 27 2026): platform (Super Admin) accounts sign in
// only from a device APPROVED for platform use.
//
// The device is the one the sign-in already identifies (auth-devices.ts: the native per-install id, or the httpOnly
// `aps_device` browser cookie). After the password AND the second factor succeed, a platform sign-in from a device that is
// not approved is refused with 403 DEVICE_APPROVAL_REQUIRED and no session is created. The device becomes approved by:
//   • first_device — the account has no approved device at all (a new platform account's first sign-in; bootstrap);
//   • email        — a one-time link (30 min, single use, sha256 stored) emailed to the account holder, opened in the admin
//                    portal page /approve-device, which POSTs the token (a GET never approves: mail scanners pre-fetch links);
//   • device       — from a session on an already-approved device of the same account, with step-up
//                    (POST /auth/devices/:id/approve-platform);
//   • migration    — devices platform accounts were already using when migration 698 ran.
// Revoking or blocking a device clears its approval (a later sign-in from it needs approval again).
//
// Mode SUPER_ADMIN_DEVICE_POLICY: enforce (refuse) · report (record, refuse nothing) · off (break-glass, no evaluation).
// Default: enforce when NODE_ENV=production, report elsewhere (local / CI runs sign in from fresh HTTP clients).
// Break-glass is documented in docs/security/SUPER_ADMIN_NETWORK_POLICY.md ("Trusted device").
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { EmailSender } from '@aipowersalon/notifications';
import { portalUrl } from '@aipowersalon/config';

export type PlatformDeviceMode = 'enforce' | 'report' | 'off';
export type PlatformApprovalVia = 'first_device' | 'email' | 'device' | 'migration';
export const APPROVAL_TTL_MINUTES = 30;
/** At most this many approval emails per account per hour (a stolen password + code cannot mail-bomb the holder). */
export const APPROVAL_EMAILS_PER_HOUR = 5;

export function platformDeviceMode(env: NodeJS.ProcessEnv = process.env): PlatformDeviceMode {
  const v = String(env.SUPER_ADMIN_DEVICE_POLICY ?? '').trim().toLowerCase();
  if (v === 'enforce' || v === 'report' || v === 'off') return v;
  return env.NODE_ENV === 'production' ? 'enforce' : 'report';
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** The admin portal base the approval link points at (the page lives in apps/admin-web). */
export function adminPortalBase(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(env.ADMIN_BASE_URL ?? env.SUPER_ADMIN_BASE_URL ?? '').trim();
  return (explicit || portalUrl(env)).replace(/\/+$/, '');
}

export function platformDeviceApprovalEmail(p: { deviceName: string; ip: string | null; whenIso: string; approveUrl: string }): { subject: string; body: string } {
  return {
    subject: 'Approve a new device for Super Admin',
    body: [
      'Someone signed in to your AIPowerSalon Super Admin account with the right password and authenticator code,',
      'from a device that is not yet approved for platform administration. The sign-in was stopped.', '',
      `Device: ${p.deviceName}`, `Time: ${new Date(p.whenIso).toUTCString()}`, ...(p.ip ? [`Network address: ${p.ip}`] : []), '',
      'If this was you, open this link on any device and press Approve, then sign in again:', p.approveUrl, '',
      `The link works once, for ${APPROVAL_TTL_MINUTES} minutes.`, '',
      'If this was NOT you, do not open the link. Your password and authenticator are known to someone else:',
      'change your password now and tell the other platform administrators.',
    ].join('\n'),
  };
}

export type PlatformDeviceDecision = { status: 'approved' } | { status: 'bootstrap' } | { status: 'approval_required' };

export class PlatformDeviceTrust {
  constructor(private readonly db: any, private readonly email: EmailSender | null, private readonly env: NodeJS.ProcessEnv = process.env) {}
  mode(): PlatformDeviceMode { return platformDeviceMode(this.env); }

  /** Is this device approved for the account? An account with NO approved device approves its first one (bootstrap) —
   *  serialized per account so two parallel first sign-ins cannot both bootstrap. */
  async decide(userId: string, deviceId: string): Promise<PlatformDeviceDecision> {
    return this.db.transaction().execute(async (trx: any) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'platform-device:' + userId}))`.execute(trx);
      const d: any = (await sql`select platform_approved_at, trust_state from auth_devices where id = ${deviceId}::uuid and user_id = ${userId}::uuid`.execute(trx)).rows[0];
      if (!d || d.trust_state === 'blocked' || d.trust_state === 'revoked') return { status: 'approval_required' } as const;
      if (d.platform_approved_at) return { status: 'approved' } as const;
      const any: any = (await sql`select 1 from auth_devices where user_id = ${userId}::uuid and platform_approved_at is not null limit 1`.execute(trx)).rows[0];
      if (any) return { status: 'approval_required' } as const;
      await sql`update auth_devices set platform_approved_at = now(), platform_approved_via = 'first_device' where id = ${deviceId}::uuid and user_id = ${userId}::uuid`.execute(trx);
      return { status: 'bootstrap' } as const;
    });
  }

  /** Mint a one-time approval link and email it to the account holder. Returns whether a message was sent; never throws
   *  for a delivery problem (the refusal stands either way — the in-session approval path still works). */
  async requestApproval(userId: string, deviceId: string, info: { deviceName: string; ip: string | null }): Promise<{ emailed: boolean; reason?: 'no_email_sender' | 'no_address' | 'throttled' }> {
    if (!this.email) return { emailed: false, reason: 'no_email_sender' };
    const recent: any = (await sql`select count(*)::int as n from platform_device_approvals where user_id = ${userId}::uuid and created_at > now() - interval '1 hour'`.execute(this.db)).rows[0];
    if (Number(recent?.n ?? 0) >= APPROVAL_EMAILS_PER_HOUR) return { emailed: false, reason: 'throttled' };
    const u: any = (await sql`select email from users where id = ${userId}::uuid`.execute(this.db)).rows[0];
    if (!u?.email) return { emailed: false, reason: 'no_address' };
    const token = 'pda_' + randomBytes(24).toString('base64url');
    await sql`insert into platform_device_approvals (user_id, device_id, token_hash, ip, expires_at)
              values (${userId}::uuid, ${deviceId}::uuid, ${hash(token)}, ${info.ip ? String(info.ip).slice(0, 64) : null}, now() + make_interval(mins => ${APPROVAL_TTL_MINUTES}))`.execute(this.db);
    const approveUrl = `${adminPortalBase(this.env)}/approve-device?token=${encodeURIComponent(token)}`;
    const m = platformDeviceApprovalEmail({ deviceName: info.deviceName, ip: info.ip, whenIso: new Date().toISOString(), approveUrl });
    try { await this.email.send(String(u.email), m.subject, m.body); } catch { return { emailed: false, reason: 'no_email_sender' }; }
    return { emailed: true };
  }

  /** The emailed link (POSTed by the admin portal page). Single use; the device must still be a live device of the account. */
  async approveByToken(token: string): Promise<{ ok: true; userId: string; deviceId: string } | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'device_gone' }> {
    if (typeof token !== 'string' || !token.startsWith('pda_')) return { ok: false, reason: 'invalid' };
    return this.db.transaction().execute(async (trx: any) => {
      const t: any = (await sql`select id, user_id, device_id, expires_at, used_at from platform_device_approvals where token_hash = ${hash(token)} for update`.execute(trx)).rows[0];
      if (!t) return { ok: false, reason: 'invalid' } as const;
      if (t.used_at) return { ok: false, reason: 'used' } as const;
      if (new Date(t.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' } as const;
      await sql`update platform_device_approvals set used_at = now() where id = ${t.id}::uuid`.execute(trx);
      const r: any = await sql`update auth_devices set platform_approved_at = now(), platform_approved_via = 'email'
                               where id = ${t.device_id}::uuid and user_id = ${t.user_id}::uuid and trust_state not in ('blocked', 'revoked') returning id`.execute(trx);
      if (!r.rows[0]) return { ok: false, reason: 'device_gone' } as const;
      return { ok: true, userId: String(t.user_id), deviceId: String(t.device_id) } as const;
    });
  }

  /** Approve another device of the SAME account from a session whose own device is approved. */
  async approveFromDevice(userId: string, approverDeviceId: string | null, targetDeviceId: string): Promise<{ ok: true } | { ok: false; reason: 'approver_not_approved' | 'not_found' }> {
    if (!approverDeviceId) return { ok: false, reason: 'approver_not_approved' };
    const a: any = (await sql`select platform_approved_at from auth_devices where id = ${approverDeviceId}::uuid and user_id = ${userId}::uuid and trust_state not in ('blocked', 'revoked')`.execute(this.db)).rows[0];
    if (!a?.platform_approved_at) return { ok: false, reason: 'approver_not_approved' };
    const r: any = await sql`update auth_devices set platform_approved_at = coalesce(platform_approved_at, now()), platform_approved_via = coalesce(platform_approved_via, 'device')
                             where id = ${targetDeviceId}::uuid and user_id = ${userId}::uuid and trust_state not in ('blocked', 'revoked') returning id`.execute(this.db);
    return r.rows[0] ? { ok: true } : { ok: false, reason: 'not_found' };
  }

  /** Remove the platform approval of a device (also done by revoke / block in auth-devices.ts). */
  async withdraw(userId: string, deviceId: string): Promise<boolean> {
    const r: any = await sql`update auth_devices set platform_approved_at = null, platform_approved_via = null where id = ${deviceId}::uuid and user_id = ${userId}::uuid and platform_approved_at is not null returning id`.execute(this.db);
    return !!r.rows[0];
  }
}
