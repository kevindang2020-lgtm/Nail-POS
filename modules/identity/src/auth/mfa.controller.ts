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

import { MFA_CODE_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
@Controller('auth/mfa')
export class MfaController {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase, @Inject(MFA_SECRETS) private readonly mfaSecrets: ProviderSecrets, @Optional() private readonly securityEvents?: SecurityEvents, @Optional() @Inject(KyselyAuthEvents) private readonly authEvents?: KyselyAuthEvents | null) {}
  private uid(r: any): string { const u = r?.ctx?.userId; if (!u) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED' }, 401); return u; }
  private need(): NonNullable<AppDatabase> { if (!this.db) throw new HttpException({ ok: false, code: 'UNAVAILABLE', message: 'MFA requires a database.' }, 503); return this.db; }

  @Post('enroll') @HttpCode(200)
  async enroll(@Req() r: any) {
    const db = this.need(); const userId = this.uid(r);
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
    const step = matchedTotpStep(this.mfaSecrets.decrypt(f.secret_enc), code, Date.now());
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
