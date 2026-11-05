// step-up.ts — Constitution 7 §8: critical platform actions require recent strong authentication.
//
//  • POST /auth/step-up { password, code } re-proves the password AND a TOTP code for the CURRENT session and stamps
//    sessions.last_step_up_at. No new session, no new token. A platform (SUPER_ADMIN) account must have a confirmed TOTP
//    factor — "password + MFA" is the rule, so without one the step-up is refused, not downgraded.
//  • StepUpGuard (global): a handler marked @RequireStepUp(n) runs only if this session stepped up within n seconds;
//    otherwise 403 { code: 'STEP_UP_REQUIRED' } — the Super Admin app answers that by asking for the password + code and
//    retrying. No database, no session id, or no stamp → refused (fail closed).
//  • A TOTP code is single-use per 30-second step (last_used_step advances atomically), so a captured code cannot be
//    replayed for a second step-up.
import { SignedInUserGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { BadRequestException, Body, CanActivate, ConflictException, Controller, ExecutionContext, ForbiddenException, Inject, Injectable, Optional, Post, Req, UnauthorizedException , UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { STEP_UP_META, STEP_UP_DEFAULT_SECONDS } from '@aipowersalon/permissions/guards';
import { MFA_SECRETS } from '@aipowersalon/security';
import { verifyPassword } from '@aipowersalon/auth';
import { verifyTotp, KyselyAuthEvents } from '@aipowersalon/identity';
import { STEP_UP_BODY } from './request-schemas';

export const STEP_UP_REQUIRED = { code: 'STEP_UP_REQUIRED', message: 'This action needs you to confirm your password and authentication code.' };

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Optional() @Inject(DATABASE) private readonly db: any) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const maxAge = this.reflector.get<number>(STEP_UP_META, context.getHandler());
    if (!maxAge) return true;
    const req = context.switchToHttp().getRequest();
    const sid = req?.sessionId ?? req?.ctx?.sessionId ?? null;
    const userId = req?.ctx?.userId ?? null;
    if (!this.db || !sid || !userId) throw new ForbiddenException(STEP_UP_REQUIRED);
    const r = await sql<{ fresh: boolean }>`select (last_step_up_at is not null and last_step_up_at > now() - (${maxAge} * interval '1 second')) as fresh
                                              from sessions where id = ${sid} and user_id = ${userId} and revoked_at is null limit 1`.execute(this.db);
    if (!r.rows[0]?.fresh) throw new ForbiddenException(STEP_UP_REQUIRED);
    return true;
  }
}

// Constitution 3 §55–57 (Step 5, Oct 3 2026): step-up is open to EVERY realm (it was Super Admin only — Constitution 7
// §8). The proof scales with the account: one with a confirmed authenticator re-proves password AND code; a salon or
// customer account without one re-proves the password; a SUPER_ADMIN without an authenticator is still refused. The
// strength is recorded on the session (step_up_strength), and every attempt goes to the auth event log.
@UseGuards(SignedInUserGuard)   // §27: the caller's own account — any signed-in person, never an integration
@Controller('auth/step-up')
export class StepUpController {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any, @Optional() @Inject(MFA_SECRETS) private readonly mfa?: { decrypt(sealed: string): string },
              @Optional() @Inject(KyselyAuthEvents) private readonly authEvents?: KyselyAuthEvents | null) {}
  private ev(req: any, ok: boolean, reason?: string, strength?: string): void {
    void this.authEvents?.record({ type: ok ? 'STEP_UP_SUCCEEDED' : 'STEP_UP_FAILED', outcome: ok ? 'success' : 'failure', userId: req?.ctx?.userId ?? null, tenantId: req?.ctx?.tenantId ?? null,
      sessionId: req?.sessionId ?? req?.ctx?.sessionId ?? null, ip: req?.ip ?? null, userAgent: String(req?.headers?.['user-agent'] ?? '') || null, reason: reason ?? null, metadata: strength ? { strength } : {} });
  }

  @Post()
  async stepUp(@Body(ValidatedBody(STEP_UP_BODY)) b: { password?: string; code?: string }, @Req() req: any, now: () => number = Date.now) {
    const sid = req?.sessionId ?? req?.ctx?.sessionId ?? null;
    const userId = req?.ctx?.userId ?? null;
    if (!sid || !userId) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in first.' });
    if (!this.db) throw new ConflictException({ code: 'UNAVAILABLE', message: 'Step-up needs a database.' });
    const password = String(b?.password ?? ''); const code = String(b?.code ?? '').replace(/\s+/g, '');
    const u: any = (await sql`select password_hash, role from users where id = ${userId} limit 1`.execute(this.db)).rows[0];
    const f: any = (await sql`select secret_enc from mfa_factors where user_id = ${userId} and type = 'totp' and confirmed = true and secret_enc is not null order by created_at desc limit 1`.execute(this.db)).rows[0];
    const hasFactor = !!f?.secret_enc && !!this.mfa;
    // A platform account must have an authenticator: "password + MFA" is the rule there, never downgraded.
    if (!hasFactor && isPlatformPrincipal(String(u?.role ?? ''))) { this.ev(req, false, 'mfa_not_enrolled'); throw new ConflictException({ code: 'MFA_NOT_ENROLLED', message: 'Set up an authenticator app before performing critical actions.' }); }
    if (!password || (hasFactor && !/^\d{6}$/.test(code))) throw new BadRequestException({ code: 'INVALID', message: hasFactor ? 'Enter your password and the 6-digit code from your authenticator.' : 'Enter your password.' });
    const at = now();
    const okPassword = !!u?.password_hash && await verifyPassword(password, String(u.password_hash));
    const okCode = !hasFactor || (okPassword && verifyTotp(this.mfa!.decrypt(String(f.secret_enc)), code, at));
    // 403, not 401: a wrong password here must not look like an ended session (the apps sign out on 401)
    if (!okPassword || !okCode) { this.ev(req, false, okPassword ? 'wrong_code' : 'wrong_password'); throw new ForbiddenException({ code: 'STEP_UP_FAILED', message: hasFactor ? 'Password or code is not correct.' : 'Password is not correct.' }); }
    const strength = hasFactor ? 'password_mfa' : 'password';
    // single use per 30-second step: a replayed code updates nothing and is refused
    const step = Math.floor(at / 30_000);
    const used: any = !hasFactor ? { numAffectedRows: 1 } : await sql`update mfa_factors set last_used_step = ${step}
                                 where user_id = ${userId} and type = 'totp' and confirmed = true and (last_used_step is null or last_used_step < ${step})`.execute(this.db);
    if (Number(used?.numAffectedRows ?? used?.numUpdatedRows ?? 0) === 0) throw new ForbiddenException({ code: 'STEP_UP_FAILED', message: 'That code was already used. Wait for the next one.' });
    const r: any = await sql`update sessions set last_step_up_at = now(), step_up_strength = ${strength}, last_primary_auth_at = now()
                               where id = ${sid} and user_id = ${userId} and revoked_at is null`.execute(this.db);
    if (Number(r?.numAffectedRows ?? r?.numUpdatedRows ?? 0) === 0) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'This session has ended. Sign in again.' });
    this.ev(req, true, undefined, strength);
    return { ok: true, validForSeconds: STEP_UP_DEFAULT_SECONDS, strength };
  }
}

import { Module } from '@nestjs/common';
import { isPlatformPrincipal } from '@aipowersalon/permissions';
/** POST /auth/step-up. The guard itself is registered as a global APP_GUARD in AppModule. */
@Module({ controllers: [StepUpController],
  providers: [{ provide: KyselyAuthEvents, useFactory: (db: any) => (db ? new KyselyAuthEvents(db) : null), inject: [DATABASE] }] })
export class StepUpModule {}
