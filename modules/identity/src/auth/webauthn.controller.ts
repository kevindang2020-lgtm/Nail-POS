// webauthn.controller.ts — mounts Face ID / Touch ID.
//
// The service and its tables existed and were well tested; they were simply never registered in a module, so
// there was no route. This is that route.
//
// Enrollment REQUIRES an authenticated session (spec: "Face ID enrollment must require a valid authenticated
// session first") — you may only enroll a biometric for yourself, and the user id comes from the verified session,
// never from the request body. Authentication is public by necessity (you have no session yet).
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { WEBAUTHN_AUTH_BEGIN_BODY, WEBAUTHN_AUTH_FINISH_BODY, WEBAUTHN_REGISTER_FINISH_BODY } from '../request-schemas';
import { KyselyTenantAuthPolicy } from './tenant-auth-policy';
import { verifySession } from './auth-session-token';
import { sql } from 'kysely';
import { Body, Controller, Get, HttpException, Inject, Module, Optional, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { WebAuthnService } from './webauthn.service';
import { makeWebAuthnPorts } from './webauthn.kysely';
import { AuthModule } from './auth.module';
import { withRequestOrigin, WebAuthnOriginError } from './webauthn-config';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { cookieNameFor } from './session-from-request';
import { isSecure } from './auth.controller';
import type { SessionStore } from './session-store';

const TTL = Number(process.env.AUTH_SESSION_TTL) || 60 * 60 * 12;

/**
 * Face ID is OFF unless explicitly enabled.
 *
 * The verifier is real and fails closed, and 8 tests prove it REJECTS forged ceremonies. What could not be proven
 * here is the opposite direction — that it ACCEPTS a genuine one — because that needs a physical Face ID device.
 * An authentication path whose success case has never been executed must not be reachable in production by
 * default: if a wiring detail were wrong, the failure would be a customer who cannot sign in, or worse, a path
 * nobody has exercised.
 *
 * So: enable it deliberately, after one real enrolment on staging.
 *
 *   FACE_ID_ENABLED=1
 *
 * Off, the routes 404 as if they did not exist — they do not hint that a disabled feature is hiding behind them.
 */
function faceIdEnabled(): boolean {
  return process.env.FACE_ID_ENABLED === '1' || process.env.FACE_ID_ENABLED === 'true';
}

function assertFaceIdEnabled(): void {
  if (!faceIdEnabled()) {
    throw new HttpException({ ok: false, message: 'Not found' }, 404);
  }
}

@Controller('auth/webauthn')
export class WebAuthnController {
  constructor(@Inject(WebAuthnService) private readonly svc: WebAuthnService,
              @Optional() @Inject(KyselyTenantAuthPolicy) private readonly policy?: KyselyTenantAuthPolicy | null,
              @Optional() @Inject('SessionStore') private readonly sessions?: { revoke(id: string): Promise<void> } | null,
              @Optional() @Inject(DATABASE) private readonly db?: any) {}
  /** Constitution 3 Step 9: has this salon switched passkeys / Face ID off? */
  private async passkeysOff(tenantId: string | null | undefined): Promise<boolean> {
    return !!tenantId && !!this.policy && (await this.policy.get(tenantId)).passkeyEnabled === false;
  }

  /**
   * Run a ceremony with the browser's own Origin bound, so the expected origin/RP ID cannot disagree with the
   * browser. If the origin is not on the trusted allowlist, that is a CONFIGURATION problem, not a customer
   * problem — log it precisely (this is the failure that otherwise costs an afternoon) and return a safe message.
   */
  private async ceremony<T>(req: any, fn: () => Promise<T>, failMessage: string): Promise<T> {
    const origin = req?.headers?.origin ?? req?.headers?.Origin;
    try {
      return await withRequestOrigin(origin, fn);
    } catch (e: any) {
      if (e instanceof WebAuthnOriginError) {
        // Precise, server-side only. The customer sees nothing about our configuration.
        // eslint-disable-next-line no-console
        console.error('[webauthn] ' + e.message);
        throw new HttpException({ ok: false, message: failMessage }, 400);
      }
      throw new HttpException({ ok: false, message: e?.message || failMessage }, 400);
    }
  }

  /** Is Face ID switched on? Public: the app needs to know whether to show the button at all, and a button that
   *  404s is worse than no button. Reveals nothing beyond a feature flag. */
  @Get('status')
  status() { return { ok: true, enabled: faceIdEnabled() }; }

  /** Begin enrollment. The user is taken from the VERIFIED session — never from the body, or anyone could enroll
   *  a biometric against someone else's account. */
  @Post('register/begin')
  async beginRegister(@Req() req: any) {
    assertFaceIdEnabled();
    const userId = req?.ctx?.userId;
    if (!userId) throw new UnauthorizedException('Sign in first');
    if (await this.passkeysOff(req?.ctx?.tenantId)) throw new HttpException({ ok: false, code: 'POLICY_PASSKEYS_OFF', message: 'Your salon has turned Face ID sign-in off.' }, 403);
    return this.ceremony(req, () => this.svc.beginRegistration({ userId } as any), 'Could not start Face ID setup.');
  }

  @Post('register/finish')
  async finishRegister(@Req() req: any, @Body(ValidatedBody(WEBAUTHN_REGISTER_FINISH_BODY)) b: any) {
    assertFaceIdEnabled();
    if (!req?.ctx?.userId) throw new UnauthorizedException('Sign in first');
    return this.ceremony(req, () => this.svc.finishRegistration(b ?? {}), 'Could not complete Face ID setup.');
  }

  /** Public — a biometric sign-in has no session yet. */
  @Post('authenticate/begin')
  async beginAuth(@Req() req: any, @Body(ValidatedBody(WEBAUTHN_AUTH_BEGIN_BODY)) b: any) {
    assertFaceIdEnabled();
    return this.ceremony(req, () => this.svc.beginAuthentication(b ?? {}), 'Unable to start biometric sign-in.');
  }

  @Post('authenticate/finish')
  async finishAuth(@Req() req: any, @Body(ValidatedBody(WEBAUTHN_AUTH_FINISH_BODY)) b: any, @Res() res: any) {
    assertFaceIdEnabled();
    let out: any;
    try { out = await this.ceremony(req, () => this.svc.finishAuthentication(b ?? {}), 'Unable to sign in with Face ID.'); }
    catch (e: any) { throw e instanceof HttpException ? e : new HttpException({ ok: false, message: 'Unable to sign in with Face ID.' }, 401); }

    // Constitution 3 Step 9: the user's salon may have switched passkeys off — the service already minted a session, so
    // it is revoked on the spot and nothing is set.
    if (this.db && out?.userId) {
      const t: any = (await sql`select tenant_id from users where id = ${out.userId}::uuid`.execute(this.db).catch(() => ({ rows: [] }))).rows[0];
      if (await this.passkeysOff(t?.tenant_id)) {
        const sid = out?.accessToken ? (verifySession(String(out.accessToken), { secret: process.env.AUTH_SESSION_SECRET || '' }) as any)?.payload?.sid : null;
        if (sid && this.sessions) await this.sessions.revoke(sid).catch(() => undefined);
        throw new HttpException({ ok: false, code: 'POLICY_PASSKEYS_OFF', message: 'Your salon has turned Face ID sign-in off. Sign in with your password.' }, 403);
      }
    }
    // The service mints the session; set it as the platform's normal httpOnly cookie. The token is never
    // returned in the body.
    const token = out?.accessToken;
    if (token) {
      const sec = isSecure(req);
      const sameSite = (process.env.COOKIE_SAMESITE as any) ?? (sec ? 'none' : 'lax');
      res.cookie(cookieNameFor(String(out?.role ?? '')), token, {   // §1–6: the cookie of the signed-in role's realm
        httpOnly: true, sameSite, secure: sec, maxAge: TTL * 1000, path: '/',
      });
    }
    res.status(200).json({ ok: true });
  }
}

@Module({
  // AuthModule exports 'SessionStore' — without this import the optional inject silently resolved to undefined and
  // the boot guard (correctly) refused to start whenever a database was configured. Found by REAL `dist/main.js`
  // boot under the browser harness; no static gate models Nest's module-scoped token resolution.
  imports: [AuthModule],
  controllers: [WebAuthnController],
  providers: [
    {
      provide: WebAuthnService,
      useFactory: (db: AppDatabase, sessions?: SessionStore) => new WebAuthnService(makeWebAuthnPorts(db, sessions)),
      inject: [DATABASE, { token: 'SessionStore', optional: true } as any],
    },
  ],
  exports: [WebAuthnService],
})
export class WebAuthnModule {}
