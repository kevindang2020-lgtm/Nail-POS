import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SuperAdminOtpChallenge, SuperAdminOtpStore } from './super-admin-login-otp';

/*
 * Postgres store for the Super Admin login OTP (migration 383). One live challenge per Super Admin (user_id PK),
 * so issuing replaces the previous row. Raw sql keeps the new table out of the generated Kysely types — the same
 * approach the auth repo uses for findOwnerForLogin. Every statement is keyed by the caller's own user_id.
 */
export class KyselySuperAdminOtpStore implements SuperAdminOtpStore {
  constructor(private readonly db: Kysely<DB>) {}

  async put(userId: string, codeHash: string, expiresAt: number, createdAt: number): Promise<void> {
    const exp = new Date(expiresAt).toISOString();
    const created = new Date(createdAt).toISOString();
    await sql`
      insert into super_admin_login_otp (user_id, code_hash, expires_at, attempts, consumed_at, created_at, updated_at)
      values (${userId}, ${codeHash}, ${exp}, 0, null, ${created}, now())
      on conflict (user_id) do update set
        code_hash = excluded.code_hash, expires_at = excluded.expires_at,
        attempts = 0, consumed_at = null, created_at = excluded.created_at, updated_at = now()
    `.execute(this.db);
  }

  async getActive(userId: string, now: number): Promise<SuperAdminOtpChallenge | null> {
    const nowIso = new Date(now).toISOString();
    const res: any = await sql`
      select code_hash, expires_at, attempts, created_at from super_admin_login_otp
      where user_id = ${userId} and consumed_at is null and expires_at > ${nowIso} limit 1
    `.execute(this.db);
    const r = res?.rows?.[0];
    if (!r) return null;
    return { codeHash: r.code_hash, expiresAt: new Date(r.expires_at).getTime(), attempts: Number(r.attempts), createdAt: new Date(r.created_at).getTime() };
  }

  async incrementAttempts(userId: string): Promise<number> {
    const res: any = await sql`update super_admin_login_otp set attempts = attempts + 1, updated_at = now() where user_id = ${userId} returning attempts`.execute(this.db);
    return Number(res?.rows?.[0]?.attempts ?? 0);
  }

  async consume(userId: string, now: number): Promise<void> {
    const nowIso = new Date(now).toISOString();
    await sql`update super_admin_login_otp set consumed_at = ${nowIso}, updated_at = now() where user_id = ${userId}`.execute(this.db);
  }

  /** One statement: the row-level lock serializes concurrent claimers; each re-checks the limit after the other commits. */
  async claimAttempt(userId: string, now: number, max: number): Promise<{ codeHash: string } | null> {
    const nowIso = new Date(now).toISOString();
    const res: any = await sql`update super_admin_login_otp set attempts = attempts + 1, updated_at = now()
      where user_id = ${userId} and consumed_at is null and expires_at > ${nowIso} and attempts < ${max}
      returning code_hash`.execute(this.db);
    const r = res?.rows?.[0]; return r ? { codeHash: r.code_hash } : null;
  }

  async consumeOnce(userId: string, now: number): Promise<boolean> {
    const nowIso = new Date(now).toISOString();
    const res: any = await sql`update super_admin_login_otp set consumed_at = ${nowIso}, updated_at = now()
      where user_id = ${userId} and consumed_at is null returning user_id`.execute(this.db);
    return (res?.rows?.length ?? 0) === 1;
  }
}
