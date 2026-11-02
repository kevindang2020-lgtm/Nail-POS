// mfa-recovery.controller.ts — Constitution 7 §24: re-enrol an authenticator after a platform administrator reset MFA.
//
//   POST /public/mfa-recovery/start    { token, password } → a NEW unconfirmed TOTP factor; returns { secret, otpauthUri }
//   POST /public/mfa-recovery/confirm  { token, code }     → confirms it with a live code; the token is then spent
//
// Sessionless by necessity (the user cannot sign in without an authenticator). Two factors guard it: possession of the
// single-use token (hash stored, 24 h) AND the account's own password. Every failure counts; the fifth burns the token.
// Answers never say which of token / password was wrong.
import { Body, Controller, HttpCode, HttpException, Inject, Optional, Post } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { MFA_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { verifyPassword } from '@aipowersalon/auth';
import { generateSecret, otpauthUri, verifyTotp } from './totp';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { MFA_RECOVERY_CONFIRM_BODY, MFA_RECOVERY_START_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
export const MAX_RECOVERY_ATTEMPTS = 5;
const REFUSED = { ok: false, code: 'recovery_refused', message: 'That recovery link or password is not valid. Ask a platform administrator for a new link.' };

@Controller('public/mfa-recovery')
export class MfaRecoveryController {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase, @Inject(MFA_SECRETS) private readonly mfaSecrets: ProviderSecrets) {}

  private async live(token: string): Promise<any | null> {
    if (!this.db || !token) return null;
    const hash = createHash('sha256').update(String(token)).digest('hex');
    const r: any = await sql`select t.id, t.user_id, t.started_at, t.failed_attempts, u.password_hash, u.email from mfa_recovery_tokens t join users u on u.id = t.user_id
                             where t.token_hash = ${hash} and t.used_at is null and t.expires_at > now() and t.failed_attempts < ${MAX_RECOVERY_ATTEMPTS} limit 1`.execute(this.db as any);
    return r.rows[0] ?? null;
  }
  private async fail(id: string) {
    await sql`update mfa_recovery_tokens set failed_attempts = failed_attempts + 1,
              used_at = case when failed_attempts + 1 >= ${MAX_RECOVERY_ATTEMPTS} then now() else used_at end where id = ${id}`.execute(this.db as any);
  }

  @Post('start') @HttpCode(200)
  async start(@Body(ValidatedBody(MFA_RECOVERY_START_BODY, { strict: true })) b: { token?: string; password?: string }) {
    const t = await this.live(String(b?.token ?? ''));
    if (!t) throw new HttpException(REFUSED, 400);
    const ok = !!t.password_hash && await verifyPassword(String(b?.password ?? ''), String(t.password_hash)).catch(() => false);
    if (!ok) { await this.fail(t.id); throw new HttpException(REFUSED, 400); }
    const secret = generateSecret();
    await (this.db as any).transaction().execute(async (trx: any) => {
      await sql`delete from mfa_factors where user_id = ${t.user_id} and type = 'totp' and confirmed = false`.execute(trx);
      await sql`insert into mfa_factors (user_id, type, secret_enc, confirmed) values (${t.user_id}, 'totp', ${this.mfaSecrets.encrypt(secret)}, false)`.execute(trx);
      await sql`update mfa_recovery_tokens set started_at = coalesce(started_at, now()) where id = ${t.id}`.execute(trx);
    });
    return { ok: true, secret, otpauthUri: otpauthUri(t.email || String(t.user_id), 'AIPowerSalon', secret) };
  }

  @Post('confirm') @HttpCode(200)
  async confirm(@Body(ValidatedBody(MFA_RECOVERY_CONFIRM_BODY, { strict: true })) b: { token?: string; code?: string }) {
    const t = await this.live(String(b?.token ?? ''));
    if (!t || !t.started_at) throw new HttpException(REFUSED, 400);
    const f: any = (await sql`select id, secret_enc from mfa_factors where user_id = ${t.user_id} and type = 'totp' and confirmed = false and secret_enc is not null order by created_at desc limit 1`.execute(this.db as any)).rows[0];
    if (!f || !verifyTotp(this.mfaSecrets.decrypt(String(f.secret_enc)), String(b?.code ?? '').replace(/\s+/g, ''), Date.now())) {
      await this.fail(t.id);
      throw new HttpException({ ok: false, code: 'invalid_code', message: 'That code is not correct. Check the time on your phone and try the next code.' }, 400);
    }
    await (this.db as any).transaction().execute(async (trx: any) => {
      await sql`update mfa_factors set confirmed = true where id = ${f.id}`.execute(trx);
      await sql`update users set mfa_enabled = true, updated_at = now() where id = ${t.user_id}`.execute(trx);
      await sql`update mfa_recovery_tokens set used_at = now() where id = ${t.id}`.execute(trx);
      await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${t.user_id}, 'SUPER_ADMIN', 'platform_user_mfa_reenrolled', 'platform_user', ${t.user_id}, '{}'::jsonb)`.execute(trx);
    });
    return { ok: true, confirmed: true };
  }
}
