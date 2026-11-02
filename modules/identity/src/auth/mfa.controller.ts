import { SignedInUserGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SecurityEvents } from '@aipowersalon/security-center';
// mfa.controller.ts — TOTP enrollment for the signed-in user (req.ctx set by TenantContextMiddleware).
//   POST /auth/mfa/enroll   → generate a secret, store an UNCONFIRMED factor, return { secret, otpauthUri } (show once).
//   POST /auth/mfa/confirm  → verify a code against the pending secret; on success confirm it + set users.mfa_enabled.
//   GET  /auth/mfa/status   → { enrolled, confirmed }.
// Once a factor is confirmed, the login flow requires a real TOTP code for that user (auth-login.service).
import { Body, Controller, Get, HttpCode, HttpException, Post, Req, Inject, Optional , UseGuards } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { generateSecret, otpauthUri, verifyTotp, matchedTotpStep } from './totp';
import { RecoveryCodes, KyselyRecoveryCodeStore } from './mfa-recovery-codes';
import { KyselyAuthEvents } from './auth-events';
import { MFA_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { PostgresAttemptBudget, attemptLockoutRecorder, type AttemptBudget, type AttemptAdmission } from './auth-attempt-budget';

import { MFA_CODE_BODY, MFA_ENROLL_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
@Controller('auth/mfa')
export class MfaController {
  // Security Deep Scan C4: a code for an EXISTING authenticator (replacing it, or minting recovery codes) is a guess at the
  // account's second factor — it spends the same per-account 'mfa' budget as sign-in, so a session holder cannot
  // brute-force the current code to swap the authenticator.
  private readonly budget: AttemptBudget | null;
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase, @Inject(MFA_SECRETS) private readonly mfaSecrets: ProviderSecrets, @Optional() private readonly securityEvents?: SecurityEvents, @Optional() @Inject(KyselyAuthEvents) private readonly authEvents?: KyselyAuthEvents | null) {
    this.budget = db ? new PostgresAttemptBudget(db, { onLockout: attemptLockoutRecorder(securityEvents) }) : null;
  }
  private async admitGuess(r: any, userId: string): Promise<AttemptAdmission | null> {
    if (!this.budget) return null;
    const a = await this.budget.admit('mfa', userId, { tenantId: r?.ctx?.tenantId ?? null, ip: r?.ip ?? null, sessionId: r?.sessionId ?? null });
    if (!a.allowed) throw new HttpException({ ok: false, code: 'AUTH_ATTEMPTS_LOCKED', message: 'Too many incorrect codes. Wait a few minutes and try again.', retryAfterSeconds: Math.ceil(a.retryAfterMs / 1000) }, 429);
    return a;
  }
  private uid(r: any): string { const u = r?.ctx?.userId; if (!u) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED' }, 401); return u; }
  private need(): NonNullable<AppDatabase> { if (!this.db) throw new HttpException({ ok: false, code: 'UNAVAILABLE', message: 'MFA requires a database.' }, 503); return this.db; }

  @Post('enroll') @HttpCode(200)
  async enroll(@Req() r: any, @Body(ValidatedBody(MFA_ENROLL_BODY)) b: any) {
    const db = this.need(); const userId = this.uid(r);
    // Security Deep Scan C1 (P0): a session alone must not replace a CONFIRMED authenticator (sign-in uses the newest
    // factor, so "enroll + confirm" from a hijacked or reset-minted session silently took the account past MFA). With a
    // confirmed factor, the request carries that factor's current code (single-use per 30-second step). A lost phone goes
    // through recovery codes or the platform's audited MFA reset — never through this route.
    const current: any = await db.selectFrom('mfa_factors').select(['id', 'secret_enc']).where('user_id', '=', userId).where('type', '=', 'totp').where('confirmed', '=', true).orderBy('created_at', 'desc').executeTakeFirst();
    if (current?.secret_enc) {
      const code = String(b?.currentCode ?? '').replace(/\s+/g, '');
      const admission = code ? await this.admitGuess(r, userId) : null;
      const step = code ? matchedTotpStep(this.mfaSecrets.decrypt(current.secret_enc), code, Date.now()) : null;
      await admission?.settle(step !== null);
      if (step === null) {
        void this.securityEvents?.record({ type: 'MFA_REPLACE_REFUSED', actorType: 'user', actorId: userId, resourceType: 'mfa_factor', resourceId: String(current.id) });
        throw new HttpException({ ok: false, code: 'CURRENT_MFA_REQUIRED', message: 'Enter the current 6-digit code from your existing authenticator to replace it.' }, 403);
      }
      const used: any = await db.updateTable('mfa_factors').set({ last_used_step: step }).where('id', '=', current.id)
        .where((eb: any) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', step)])).executeTakeFirst();
      if (Number(used?.numUpdatedRows ?? 0) === 0) throw new HttpException({ ok: false, code: 'CURRENT_MFA_REQUIRED', message: 'That code was already used — wait for the next one.' }, 403);
    }
    const secret = generateSecret();
    await db.deleteFrom('mfa_factors').where('user_id', '=', userId).where('type', '=', 'totp').where('confirmed', '=', false).execute();
    await db.insertInto('mfa_factors').values({ user_id: userId, type: 'totp', secret_enc: this.mfaSecrets.encrypt(secret), confirmed: false }).execute();
    const u = await db.selectFrom('users').select(['email']).where('id', '=', userId).executeTakeFirst();
    void this.securityEvents?.record({ type: 'MFA_ENROLLED', actorType: 'user', actorId: userId, resourceType: 'mfa_factor' });
    return { ok: true, secret, otpauthUri: otpauthUri(u?.email || userId, 'AIPowerSalon', secret) };
  }

  @Post('confirm') @HttpCode(200)
  async confirm(@Req() r: any, @Body(ValidatedBody(MFA_CODE_BODY)) b: any) {
    const db = this.need(); const userId = this.uid(r);
    const f = await db.selectFrom('mfa_factors').select(['id', 'secret_enc']).where('user_id', '=', userId).where('type', '=', 'totp').where('confirmed', '=', false).where('secret_enc', 'is not', null).orderBy('created_at', 'desc').executeTakeFirst();
    if (!f?.secret_enc) throw new HttpException({ ok: false, code: 'no_pending_enrollment' }, 400);
    if (!verifyTotp(this.mfaSecrets.decrypt(f.secret_enc), String(b?.code ?? ''), Date.now())) throw new HttpException({ ok: false, code: 'invalid_code' }, 400);
    await db.updateTable('mfa_factors').set({ confirmed: true }).where('id', '=', f.id).execute();
    await db.updateTable('users').set({ mfa_enabled: true, updated_at: new Date() }).where('id', '=', userId).execute();
    void this.securityEvents?.record({ type: 'MFA_CONFIRMED', actorType: 'user', actorId: userId, resourceType: 'mfa_factor', resourceId: String(f.id) });
    return { ok: true, confirmed: true };
  }

  /** Constitution 3 §66–67: a NEW set of ten recovery codes, shown once; the old set stops working. Generating codes is
   *  a way to keep access, so it re-proves the authenticator in the request itself: a current TOTP code (single-use per
   *  30-second step, like at sign-in). Only for a confirmed factor. */
  @Post('recovery-codes') @HttpCode(200) @UseGuards(SignedInUserGuard)
  async recoveryCodes(@Req() r: any, @Body(ValidatedBody(MFA_CODE_BODY)) b: any) {
    const db = this.need(); const userId = this.uid(r);
    const f: any = await db.selectFrom('mfa_factors').select(['id', 'secret_enc']).where('user_id', '=', userId).where('type', '=', 'totp').where('confirmed', '=', true).orderBy('created_at', 'desc').executeTakeFirst();
    if (!f?.secret_enc) throw new HttpException({ ok: false, code: 'mfa_not_enrolled', message: 'Set up an authenticator first.' }, 400);
    const code = String(b?.code ?? '').replace(/\s+/g, '');
    const admission = await this.admitGuess(r, userId);
    const step = matchedTotpStep(this.mfaSecrets.decrypt(f.secret_enc), code, Date.now());
    await admission?.settle(step !== null);
    if (step === null) throw new HttpException({ ok: false, code: 'invalid_code', message: 'Enter the current 6-digit code from your authenticator.' }, 400);
    const res: any = await db.updateTable('mfa_factors').set({ last_used_step: step } as any).where('id', '=', f.id)
      .where((eb: any) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', step)])).executeTakeFirst();
    if (Number(res?.numUpdatedRows ?? 0) === 0) throw new HttpException({ ok: false, code: 'invalid_code', message: 'That code was already used — wait for the next one.' }, 400);
    const codes = await new RecoveryCodes(new KyselyRecoveryCodeStore(db)).generate(userId);
    void this.authEvents?.record({ type: 'RECOVERY_CODES_GENERATED', outcome: 'info', userId, tenantId: r?.ctx?.tenantId ?? null, sessionId: r?.sessionId ?? null });
    void this.securityEvents?.record({ type: 'MFA_RECOVERY_CODES_GENERATED', actorType: 'user', actorId: userId, resourceType: 'mfa_factor', resourceId: String(f.id) });
    return { ok: true, codes, count: codes.length, message: 'Save these codes somewhere safe. Each works once, and they are shown only now.' };
  }

  @Get('recovery-codes') @UseGuards(SignedInUserGuard)
  async recoveryCodesRemaining(@Req() r: any) {
    const db = this.need(); const userId = this.uid(r);
    return { remaining: await new RecoveryCodes(new KyselyRecoveryCodeStore(db)).remaining(userId) };
  }

  @Get('status')
  async status(@Req() r: any) {
    const db = this.need(); const userId = this.uid(r);
    const f = await db.selectFrom('mfa_factors').select(['confirmed']).where('user_id', '=', userId).where('type', '=', 'totp').orderBy('created_at', 'desc').executeTakeFirst();
    return { enrolled: !!f, confirmed: !!f?.confirmed };
  }
}
