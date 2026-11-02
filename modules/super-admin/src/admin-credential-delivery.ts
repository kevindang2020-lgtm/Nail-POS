// admin-credential-delivery.ts — Security Deep Scan C2 / A3 (Oct 23 2026): a password reset a Super Admin starts reaches
// ONLY the account holder.
//
// Before: POST /super-admin/tenants/:id/reset-owner-password and POST /super-admin/platform/users/:id/reset-password (and
// resend-invite) set a new password and RETURNED it to the Super Admin — a platform session could sign in as any salon
// owner outside Support Mode, or learn another platform administrator's password. Now the temporary password is minted,
// stored as a hash in the SAME temporary-password columns the system reset flow uses (users.temp_password_hash /
// temp_password_expires_at / temp_password_delivery + must_change_password — so POST /auth/temp-password-login and
// POST /auth/change-temporary-password finish the job exactly as for a self-serve reset), and SENT to the account's own
// email or phone through the platform's senders (SendGrid / Twilio via @aipowersalon/notifications). The caller learns
// only the channel and a masked destination. No usable channel → CANNOT_DELIVER and nothing changes; a failed send → the
// temporary password is withdrawn (it was never seen by anyone) and DELIVERY_FAILED.
//
// This mirrors identity's SystemPasswordResetService.issueAndSend (same columns, same senders, same channel rule); that
// service is internal to @aipowersalon/identity (not exported) and gates Super Admin callers on a permission key that no
// role holds, so it cannot be called from here. See the remediation report: export it and point this port at it.
import { randomInt } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { generateTempPassword, hashPassword } from '@aipowersalon/auth';
import { type EmailSender, type SmsSender, type TenantMessenger, platformSmsSender, smsSenderFromEnv, messagingEmailSenderFromEnv } from '@aipowersalon/notifications';
import type { DB } from '@aipowersalon/database';
import type { CredentialDeliveryResult } from '@aipowersalon/api-contracts/platform';

export type DeliveryMethod = 'auto' | 'email' | 'sms';
export interface CredentialTarget { userId: string; email: string | null; phone: string | null }
export type CredentialDeliveryOutcome =
  | CredentialDeliveryResult   // the success answer is the shared contract (admin-web reads the same type)
  | { ok: false; code: 'CANNOT_DELIVER' | 'DELIVERY_FAILED'; message: string };

/** The account-holder delivery port the Super Admin services use. Never returns the password. */
export interface CredentialDelivery {
  deliverTemporaryPassword(target: CredentialTarget, method?: DeliveryMethod, context?: 'owner_reset' | 'user_reset' | 'invite_resend'): Promise<CredentialDeliveryOutcome>;
}

/** Same rule as identity's reset-authz chooseDelivery: a named channel only if the account has it; auto prefers email. */
export function chooseChannel(method: DeliveryMethod | undefined, hasEmail: boolean, hasPhone: boolean): 'email' | 'sms' | null {
  if (method === 'email') return hasEmail ? 'email' : null;
  if (method === 'sms') return hasPhone ? 'sms' : null;
  return hasEmail ? 'email' : hasPhone ? 'sms' : null;
}
export const maskDestination = (channel: 'email' | 'sms', v: string): string =>
  channel === 'email' ? String(v).replace(/^(.).*(@.*)$/, '$1***$2') : '***' + String(v).replace(/\D/g, '').slice(-4);

export const ADMIN_RESET_TTL_MINUTES = 60;
export function adminResetMessage(tempPassword: string, context: 'owner_reset' | 'user_reset' | 'invite_resend'): { subject: string; body: string; sms: string } {
  const why = context === 'invite_resend' ? 'Your AIPowerSalon invitation was re-sent.' : 'AIPowerSalon support reset the password on your account.';
  return {
    subject: context === 'invite_resend' ? 'Your AIPowerSalon sign-in' : 'Your AIPowerSalon password was reset',
    body: `${why}\n\nYour temporary password is: ${tempPassword}\n\nIt works for ${ADMIN_RESET_TTL_MINUTES} minutes and must be changed when you sign in.\nIf you did not expect this, contact AIPowerSalon support.`,
    sms: `AIPowerSalon: ${why} Temporary password: ${tempPassword} (${ADMIN_RESET_TTL_MINUTES} min, change it at sign-in). Not you? Contact support.`,
  };
}

export interface AdminCredentialStore {
  setTemporaryPassword(userId: string, hash: string, expiresAt: Date, delivery: 'email' | 'sms'): Promise<void>;
  clearTemporaryPassword(userId: string): Promise<void>;
}

export class AccountHolderCredentialDelivery implements CredentialDelivery {
  constructor(private readonly store: AdminCredentialStore, private readonly senders: { email: EmailSender; sms: SmsSender },
              private readonly deps: { now?: () => number; rngInt?: (max: number) => number; hash?: (s: string) => Promise<string> } = {}) {}

  async deliverTemporaryPassword(target: CredentialTarget, method: DeliveryMethod = 'auto', context: 'owner_reset' | 'user_reset' | 'invite_resend' = 'user_reset'): Promise<CredentialDeliveryOutcome> {
    const channel = chooseChannel(method, !!target.email, !!target.phone);
    if (!channel) return { ok: false, code: 'CANNOT_DELIVER', message: method === 'auto'
      ? 'This account has no email address or phone number on file, so a temporary password cannot be sent to the account holder. Add one first.'
      : `This account has no ${method === 'email' ? 'email address' : 'phone number'} on file.` };
    const temp = generateTempPassword(this.deps.rngInt ?? ((m) => randomInt(0, Math.max(1, m))), 12);
    const expiresAt = new Date((this.deps.now ?? Date.now)() + ADMIN_RESET_TTL_MINUTES * 60_000);
    await this.store.setTemporaryPassword(target.userId, await (this.deps.hash ?? hashPassword)(temp), expiresAt, channel);
    const msg = adminResetMessage(temp, context);
    try {
      if (channel === 'email') await this.senders.email.send(target.email!, msg.subject, msg.body);
      else await this.senders.sms.send(target.phone!, msg.sms);
    } catch (e) {
      // nobody saw it: withdraw it so a half-finished reset leaves nothing usable behind
      await this.store.clearTemporaryPassword(target.userId);
      return { ok: false, code: 'DELIVERY_FAILED', message: `The temporary password could not be sent by ${channel === 'email' ? 'email' : 'text message'}. Nothing was changed. (${String((e as Error)?.name ?? 'error')})` };
    }
    return { ok: true, delivery: channel, sentTo: maskDestination(channel, channel === 'email' ? target.email! : target.phone!), expiresAt: expiresAt.toISOString() };
  }
}

/** The production store: the temporary-password columns identity's system reset flow reads at temp-password sign-in. */
export function kyselyCredentialStore(db: Kysely<DB>): AdminCredentialStore {
  return {
    async setTemporaryPassword(userId, hash, expiresAt, delivery) {
      await sql`update users set temp_password_hash = ${hash}, temp_password_expires_at = ${expiresAt}, temp_password_delivery = ${delivery},
                  must_change_password = true, updated_at = now() where id = ${userId}`.execute(db);
    },
    async clearTemporaryPassword(userId) {
      await sql`update users set temp_password_hash = null, temp_password_expires_at = null, updated_at = now() where id = ${userId}`.execute(db);
    },
  };
}

/** Module wiring: the same senders identity's system reset uses (platform SMS through the messenger when present, else
 *  Twilio / SendGrid from the environment — never a mock in production). No database → no delivery (resets refused). */
export function credentialDeliveryFor(db: Kysely<DB> | null | undefined, messenger?: TenantMessenger | null): CredentialDelivery | undefined {
  if (!db) return undefined;
  return new AccountHolderCredentialDelivery(kyselyCredentialStore(db), { email: messagingEmailSenderFromEnv(), sms: platformSmsSender(messenger, () => smsSenderFromEnv()) });
}
