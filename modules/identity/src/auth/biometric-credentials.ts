// biometric-credentials.ts — BUILD_PLAN Phase 13 D (Constitution 6 §37–39, audit bug 2): the biometric DEVICE CREDENTIAL.
//
// Face ID / Touch ID unlocks a long-lived, single-device, revocable secret kept in the biometric-guarded Keychain /
// Keystore item (packages/mobile-sdk native-faceid.ts). The server keeps only its SHA-256 hash (migration 559). Using it:
//   • the device id must match the one it was enrolled on (a copied secret alone is not enough);
//   • it must be active, unexpired, enrolled AFTER the last password change, on a device that is not revoked / blocked,
//     for an account that is still active;
//   • every use ROTATES the secret; the spent one is remembered, and presenting it again is treated as theft — the
//     credential is revoked and the person signs in with the password (exactly as a reused refresh token burns a session).
// It never mints authority by itself: the controller recomputes the person's permissions the way a token refresh does and
// opens a NEW session. Face ID only proves who holds the phone; the SERVER decides whether that still means a session.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { BIOMETRIC_CREDENTIAL } from './identity-lifecycles';
import { hashDeviceKey } from './auth-devices';
import { BIOMETRIC_CREDENTIAL_DAYS } from '@aipowersalon/api-contracts';

export const hashBiometricSecret = (s: string) => createHash('sha256').update(String(s)).digest('hex');
export const newBiometricSecret = () => randomBytes(32).toString('base64url');   // 43 chars, 256 bits
function sameHash(a: string | null | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** The session scope captured at enrolment. Never a token, a password or a permission list. */
export interface BiometricClaims {
  userId: string; tenantId: string | null; branchId: string | null; role: string;
  subscriptionStatus?: string; platformRole?: string; restriction?: string; fullName?: string | null;
}
export type VerifyFailure = 'invalid' | 'reused' | 'expired' | 'password_changed' | 'device_revoked' | 'account_inactive';
export type VerifyResult =
  | { ok: true; credentialId: string; userId: string; tenantId: string | null; authDeviceId: string | null; claims: BiometricClaims; nextSecret: string; expiresAt: string }
  | { ok: false; reason: VerifyFailure };

export class KyselyBiometricCredentials {
  constructor(private readonly db: any, private readonly now: () => number = () => Date.now()) {}
  private expiry(): Date { return new Date(this.now() + BIOMETRIC_CREDENTIAL_DAYS * 86_400_000); }

  /** Enrol (or re-enrol) this device for this person. The previous active credential on the device is revoked. */
  async enroll(input: { userId: string; tenantId: string | null; authDeviceId: string | null; deviceKey: string; platform: 'ios' | 'android' | null; deviceName: string | null; claims: BiometricClaims }):
    Promise<{ credentialId: string; secret: string; expiresAt: string }> {
    const secret = newBiometricSecret(); const expiresAt = this.expiry();
    const dk = hashDeviceKey(input.deviceKey);
    const id = await this.db.transaction().execute(async (trx: any) => {
      await sql`update device_biometric_credentials set status = 'revoked', revoked_at = now(), revoked_reason = 'replaced'
                 where user_id = ${input.userId}::uuid and device_key_hash = ${dk} and ${canMoveToSql(BIOMETRIC_CREDENTIAL, 'revoked')}`.execute(trx);
      const r: any = await sql`insert into device_biometric_credentials (user_id, tenant_id, auth_device_id, device_key_hash, secret_hash, platform, device_name, claims, expires_at)
        values (${input.userId}::uuid, ${input.tenantId}, ${input.authDeviceId}, ${dk}, ${hashBiometricSecret(secret)}, ${input.platform}, ${input.deviceName ? String(input.deviceName).slice(0, 80) : null},
                ${JSON.stringify(input.claims)}::jsonb, ${expiresAt}) returning id`.execute(trx);
      return String(r.rows[0].id);
    });
    return { credentialId: id, secret, expiresAt: expiresAt.toISOString() };
  }

  /** Check the credential presented with a biometric unlock, and rotate its secret. */
  async verifyAndRotate(input: { credentialId: string; deviceKey: string; secret: string }): Promise<VerifyResult> {
    if (!/^[0-9a-f-]{36}$/i.test(String(input.credentialId ?? ''))) return { ok: false, reason: 'invalid' };
    const presented = hashBiometricSecret(input.secret);
    return this.db.transaction().execute(async (trx: any): Promise<VerifyResult> => {
      const row: any = (await sql`select c.id, c.user_id, c.tenant_id, c.auth_device_id, c.device_key_hash, c.secret_hash, c.previous_secret_hash, c.claims, c.status, c.created_at, c.expires_at, u.status as user_status, u.password_changed_at, d.trust_state
          from device_biometric_credentials c
          join users u on u.id = c.user_id
          left join auth_devices d on d.id = c.auth_device_id
         where c.id = ${input.credentialId}::uuid for update of c`.execute(trx)).rows[0];
      if (!row || !sameHash(row.device_key_hash, hashDeviceKey(input.deviceKey))) return { ok: false, reason: 'invalid' };
      if (row.status !== 'active') return { ok: false, reason: 'invalid' };
      const revoke = async (why: string) => { await sql`update device_biometric_credentials set status = 'revoked', revoked_at = now(), revoked_reason = ${why} where id = ${row.id}::uuid and ${canMoveToSql(BIOMETRIC_CREDENTIAL, 'revoked')}`.execute(trx); };
      if (sameHash(row.previous_secret_hash, presented)) { await revoke('reused'); return { ok: false, reason: 'reused' }; }
      if (!sameHash(row.secret_hash, presented)) return { ok: false, reason: 'invalid' };
      if (new Date(row.expires_at).getTime() <= this.now()) { await revoke('expired'); return { ok: false, reason: 'expired' }; }
      if (row.password_changed_at && new Date(row.password_changed_at).getTime() > new Date(row.created_at).getTime()) { await revoke('password_changed'); return { ok: false, reason: 'password_changed' }; }
      if (row.trust_state === 'revoked' || row.trust_state === 'blocked') { await revoke('device_revoked'); return { ok: false, reason: 'device_revoked' }; }
      if (row.user_status !== 'active') return { ok: false, reason: 'account_inactive' };
      const next = newBiometricSecret(); const expiresAt = this.expiry();
      await sql`update device_biometric_credentials set previous_secret_hash = secret_hash, secret_hash = ${hashBiometricSecret(next)},
                  last_used_at = now(), use_count = use_count + 1, expires_at = ${expiresAt} where id = ${row.id}::uuid`.execute(trx);
      const claims = (typeof row.claims === 'string' ? JSON.parse(row.claims) : row.claims) as BiometricClaims;
      return { ok: true, credentialId: String(row.id), userId: String(row.user_id), tenantId: row.tenant_id ?? null, authDeviceId: row.auth_device_id ?? null, claims, nextSecret: next, expiresAt: expiresAt.toISOString() };
    });
  }

  async revokeById(credentialId: string, why: string): Promise<void> {
    await sql`update device_biometric_credentials set status = 'revoked', revoked_at = now(), revoked_reason = ${why} where id = ${credentialId}::uuid and ${canMoveToSql(BIOMETRIC_CREDENTIAL, 'revoked')}`.execute(this.db);
  }
  /** Sign-out from a device / "turn Face ID off" on it. */
  async revokeForDevice(userId: string, deviceKey: string, why: string): Promise<number> {
    const r: any = await sql`update device_biometric_credentials set status = 'revoked', revoked_at = now(), revoked_reason = ${why}
      where user_id = ${userId}::uuid and device_key_hash = ${hashDeviceKey(deviceKey)} and ${canMoveToSql(BIOMETRIC_CREDENTIAL, 'revoked')}`.execute(this.db);
    return Number(r?.numAffectedRows ?? r?.numUpdatedRows ?? 0);
  }
  /** A device revoked / blocked from Security → Devices. */
  async revokeForAuthDevice(authDeviceId: string, why: string, trx?: any): Promise<void> {
    await sql`update device_biometric_credentials set status = 'revoked', revoked_at = now(), revoked_reason = ${why}
      where auth_device_id = ${authDeviceId}::uuid and ${canMoveToSql(BIOMETRIC_CREDENTIAL, 'revoked')}`.execute(trx ?? this.db);
  }
  async revokeAllForUser(userId: string, why: string): Promise<void> {
    await sql`update device_biometric_credentials set status = 'revoked', revoked_at = now(), revoked_reason = ${why} where user_id = ${userId}::uuid and ${canMoveToSql(BIOMETRIC_CREDENTIAL, 'revoked')}`.execute(this.db);
  }
}
