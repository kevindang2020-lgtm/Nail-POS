// customer-identity-phone.kysely.ts — drivers for the LOGIN-credential phone change.
// CROSS-TENANT BY DESIGN: customer_identities is the CENTRAL identity — one person, many salons. It has no tenant_id by definition.

import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from '@aipowersalon/identity';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { verifyPassword } from '@aipowersalon/auth';
import type { IdentityStore, AuthPort, SecurityNotifier } from './customer-identity-phone.service';

export class KyselyIdentityStore implements IdentityStore {
  constructor(private readonly db: AppDatabase | null) {}

  async identityFor(userId: string) {
    if (!this.db) return null;
    // The identity behind this SESSION's user. Keyed off the session -- never off a request parameter, because the
    // thing being moved is a login credential.
    const r: any = await sql`
      SELECT i.id, i.normalized_phone, i.password_hash
      FROM customer_identities i
      JOIN customer_identity_links l ON l.identity_id = i.id
      WHERE l.user_id = ${userId}
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const row = r.rows?.[0];
    return row
      ? { identityId: String(row.id), normalizedPhone: String(row.normalized_phone), passwordHash: row.password_hash ?? null }
      : null;
  }

  async phoneTakenByAnother(identityId: string, e164: string): Promise<boolean> {
    if (!this.db) return true;   // FAIL CLOSED: if we cannot tell, we do not move a login credential.
    const r: any = await sql`
      SELECT 1 FROM customer_identities
      WHERE normalized_phone = ${e164} AND id <> ${identityId}
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [{ ok: 1 }] }));
    return (r.rows?.length ?? 0) > 0;
  }

  async provenRecently(userId: string, phoneHash: string, withinMinutes: number): Promise<boolean> {
    return provenRecentlyQuery(this.db, userId, phoneHash, withinMinutes);
  }

  async setIdentityPhone(identityId: string, e164: string): Promise<boolean> {
    if (!this.db) return false;
    // The UNIQUE constraint is the real guard. If two people race for the same number, the database refuses one of
    // them -- and it must, because two accounts on one login is an ambiguous login.
    const r: any = await sql`
      UPDATE customer_identities
      SET normalized_phone = ${e164}, phone_verified_at = now(), updated_at = now()
      WHERE id = ${identityId}
      RETURNING id`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows?.length ?? 0) > 0;
  }
}

export async function provenRecentlyQuery(db: AppDatabase | null, userId: string, phoneHash: string, withinMinutes: number): Promise<boolean> {
  if (!db || !userId) return false;   // fail closed
  // A session of THIS user's customer record(s), in the APP flow (the customer, not staff), SMS-proven (a customer
  // cannot manually confirm), for this exact number, recent. Any of the customer's salons: the login is central.
  const r: any = await sql`
    SELECT 1 FROM customer_phone_update_sessions s
      JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
     WHERE (c.user_id = ${userId}
            OR s.customer_id IN (SELECT l2.customer_id FROM customer_identity_links l1
                                   JOIN customer_identity_links l2 ON l2.identity_id = l1.identity_id
                                  WHERE l1.user_id = ${userId} AND l2.customer_id IS NOT NULL))
       AND s.update_source = 'customer_app'
       AND s.proposed_phone_hash = ${phoneHash}
       AND s.state IN ('phone_activated', 'synchronization_failed', 'customer_records_synchronized')
       AND s.updated_at > now() - ${`${Math.max(1, withinMinutes)} minutes`}::interval
     LIMIT 1`.execute(db).catch(() => ({ rows: [] }));
  return (r.rows?.length ?? 0) > 0;
}

export class KyselyAuthPort implements AuthPort {
  constructor(private readonly db: AppDatabase | null) {}

  // The platform's OWN password verifier. Not a second one -- a second password check is a second place to get a
  // timing-safe comparison wrong.
  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return verifyPassword(password, hash).catch(() => false);
  }

  async revokeAllSessions(userId: string): Promise<void> {
    if (!this.db) return;
    // Mirrors the platform's existing password-reset revocation. If an attacker was riding a session, it ends here.
    await sql`
      UPDATE sessions SET status = 'revoked', revoked_at = now()
      WHERE user_id = ${userId} AND status = 'active' AND ${canMoveToSql(SESSION, 'revoked')}`.execute(this.db).catch(() => undefined);
    // Their refresh tokens die with them: migration 499's trigger burns a session's refresh tokens when it is revoked.
  }
}

/**
 * The security warning to the OLD number.
 *
 * Sent on the TENANT's own Twilio, through the existing sender -- there is no separate credential and no shared
 * platform account.
 */
export class SmsSecurityNotifier implements SecurityNotifier {
  /** `send` returns what the sender knows: sent, and whether it was simulated (no real provider). */
  constructor(private readonly send: (toE164: string, body: string, tenantId: string | null) => Promise<{ sent: boolean; simulated?: boolean } | unknown>) {}

  async loginPhoneChanged(i: { userId: string; tenantId?: string | null; maskedOld: string; maskedNew: string; oldPhoneE164: string }): Promise<{ sent: boolean; simulated?: boolean }> {
    // Says THAT it changed, and to a masked number. Telling a victim the attacker's number hands them a target;
    // telling an attacker the victim's number hands them a victim.
    //
    // And it tells them what to DO. A warning with no next step is a warning that gets ignored -- which makes it
    // worse than none, because it looks like the system is watching when nobody is.
    const body =
      `AI PowerSalon: the phone number used to sign in to your account was changed to ${i.maskedNew}. ` +
      `If this was not you, contact the salon immediately \u2014 your account may have been taken.`;
    const r: any = await this.send(i.oldPhoneE164, body, i.tenantId ?? null);
    return r && typeof r === 'object' && 'sent' in r ? { sent: !!r.sent, simulated: !!r.simulated } : { sent: true };
  }
}
