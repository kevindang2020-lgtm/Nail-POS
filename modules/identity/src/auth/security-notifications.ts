// security-notifications.ts — Constitution 3 §89–90 (Step 10a, Oct 3 2026): "A new device signed in to your account".
// The login-alert preferences (user_login_alert_prefs, migration 138 — enabled / new_device, default ON) existed with
// nothing behind them. Now a sign-in from a device the account has never used — except the account's very first device —
// emails the account holder, with a one-time "This wasn't me" link. Following it: the device is BLOCKED, every session
// of the account ends (their refresh tokens with them, migration 499), and the person is sent to reset their password.
// Sending never blocks or slows the sign-in (fire-and-forget; failures are swallowed).
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from './identity-lifecycles';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { EmailSender } from '@aipowersalon/notifications';
import { portalUrl } from '@aipowersalon/config';

export const NOT_ME_TTL_DAYS = 7;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
export function newDeviceEmail(p: { deviceName: string; ip: string | null; whenIso: string; notMeUrl: string }): { subject: string; body: string } {
  const when = new Date(p.whenIso).toUTCString();
  return {
    subject: 'New sign-in to your AIPowerSalon account',
    body: [
      'Your account was just signed in to from a device it has not used before.', '',
      `Device: ${p.deviceName}`, `Time: ${when}`, ...(p.ip ? [`Network address: ${p.ip}`] : []), '',
      'If this was you, there is nothing to do.', '',
      'If this was NOT you, open this link. It signs out every device on your account and blocks this one, then you can choose a new password:',
      p.notMeUrl, '', 'The link works once, for 7 days.',
    ].join('\n'),
  };
}

export class SecurityNotifications {
  constructor(private readonly db: any, private readonly email: EmailSender | null, private readonly env: NodeJS.ProcessEnv = process.env) {}

  private async alertsOn(tenantId: string | null, userId: string): Promise<boolean> {
    const r: any = (await sql`select enabled, new_device from user_login_alert_prefs where user_id = ${userId} and tenant_id = ${tenantId ?? ''} limit 1`.execute(this.db).catch(() => ({ rows: [] }))).rows[0];
    return !r || (r.enabled !== false && r.new_device !== false);   // no row = the defaults (on)
  }

  /** Called after a successful sign-in. Returns whether an alert was sent (for the event log and tests). */
  async onSignIn(p: { userId: string; tenantId: string | null; deviceId: string; isNew: boolean; hadOtherDevices: boolean; deviceName: string; ip: string | null }): Promise<boolean> {
    if (!p.isNew || !p.hadOtherDevices || !this.email) return false;
    if (!(await this.alertsOn(p.tenantId, p.userId))) return false;
    const u: any = (await sql`select email from users where id = ${p.userId}::uuid`.execute(this.db)).rows[0];
    if (!u?.email) return false;
    const token = 'nm_' + randomBytes(24).toString('base64url');
    await sql`insert into security_not_me_tokens (user_id, device_id, token_hash, expires_at) values (${p.userId}::uuid, ${p.deviceId}::uuid, ${hash(token)}, now() + make_interval(days => ${NOT_ME_TTL_DAYS}))`.execute(this.db);
    const notMeUrl = `${portalUrl(this.env)}/security/not-me?token=${encodeURIComponent(token)}`;
    const m = newDeviceEmail({ deviceName: p.deviceName, ip: p.ip, whenIso: new Date().toISOString(), notMeUrl });
    await this.email.send(String(u.email), m.subject, m.body);
    return true;
  }

  /** The "This wasn't me" link. One use. Blocks the device, ends EVERY session of the account. */
  async notMe(token: string): Promise<{ ok: true; userId: string; sessionsEnded: number } | { ok: false; reason: 'invalid' | 'expired' | 'used' }> {
    if (typeof token !== 'string' || !token.startsWith('nm_')) return { ok: false, reason: 'invalid' };
    return this.db.transaction().execute(async (trx: any) => {
      const t: any = (await sql`select id, user_id, device_id, expires_at, used_at from security_not_me_tokens where token_hash = ${hash(token)} for update`.execute(trx)).rows[0];
      if (!t) return { ok: false, reason: 'invalid' } as const;
      if (t.used_at) return { ok: false, reason: 'used' } as const;
      if (new Date(t.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' } as const;
      await sql`update security_not_me_tokens set used_at = now() where id = ${t.id}::uuid`.execute(trx);
      if (t.device_id) await sql`update auth_devices set trust_state = 'blocked', trusted_until = null where id = ${t.device_id}::uuid and user_id = ${t.user_id}::uuid`.execute(trx);
      const s: any = await sql`update sessions set revoked_at = now(), status = 'revoked' where user_id = ${t.user_id}::uuid and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')} returning id`.execute(trx);
      return { ok: true, userId: String(t.user_id), sessionsEnded: s.rows.length } as const;
    });
  }
}
