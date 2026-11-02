// biometric.controller.ts — BUILD_PLAN Phase 13 D (Constitution 6 §37–39, audit bug 2): Face ID / Touch ID in the four
// mobile apps, as a biometric-protected device credential (biometric-auth.ts). Status + login are PRE-AUTH (excluded from
// the session middleware in app.module.ts — you cannot require a session to create one); enroll + revoke need the
// caller's own signed-in session (SignedInUserGuard, never an integration).
import { AnonRateLimit } from '@aipowersalon/security/nest';   // Security Deep Scan §28/§43/§44: per-IP limit on public routes
import { Body, Controller, Get, HttpException, Inject, Optional, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SignedInUserGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { clientIp } from '@aipowersalon/security';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { BIOMETRIC_ENROLL_BODY, BIOMETRIC_LOGIN_BODY, BIOMETRIC_REVOKE_BODY } from '../request-schemas';
import { BiometricAuth, BiometricHttpError, faceIdEnabled } from './biometric-auth';
import { KyselyBiometricCredentials } from './biometric-credentials';
import { LoginService } from './auth-login.service';
import { RefreshSessionService } from './refresh-session';
import { KyselyTenantAuthPolicy } from './tenant-auth-policy';
import { KyselyAuthEvents } from './auth-events';
import { sessionFromRequest } from './session-from-request';
import { shouldReturnToken } from './native-client';
import type { SessionStore } from './session-store';
import type { BiometricStatusResponse, BiometricEnrollBody, BiometricEnrollResponse, BiometricLoginBody, BiometricRevokeBody, BiometricRevokeResponse } from '@aipowersalon/api-contracts';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

@Controller('auth/biometric')
export class BiometricController {
  private readonly core: BiometricAuth | null;
  constructor(
    private readonly login: LoginService,
    @Optional() @Inject(DATABASE) db?: AppDatabase,
    @Optional() @Inject('SessionStore') sessions?: SessionStore,
    @Optional() @Inject(RefreshSessionService) refresh?: RefreshSessionService,
    @Optional() @Inject(KyselyTenantAuthPolicy) policy?: KyselyTenantAuthPolicy | null,
    @Optional() @Inject(KyselyAuthEvents) events?: KyselyAuthEvents | null,
  ) {
    this.core = db ? new BiometricAuth({
      db, creds: new KyselyBiometricCredentials(db), login, sessions: sessions ?? null, refresh: refresh ?? null,
      passkeysOff: async (tenantId) => !!tenantId && !!policy && (await policy.get(tenantId)).passkeyEnabled === false,
      event: (e) => { void events?.record({ ...e, type: e.type as any, ip: null, userAgent: null } as any); },
    }) : null;
  }
  private need(): BiometricAuth {
    if (!faceIdEnabled()) throw withCode(new HttpException({ ok: false, message: 'Not found' }, 404), 'RESOURCE_NOT_FOUND');   // off: as if it did not exist
    if (!this.core) throw new HttpException({ ok: false, code: 'UNAVAILABLE', message: 'Face ID needs a database.' }, 503);
    return this.core;
  }
  private fail(e: unknown): never {
    if (e instanceof BiometricHttpError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.status);
    throw e;
  }

  /** Public: should the app offer Face ID at all? Reveals nothing beyond the feature switch. */
  @Get('status') @AnonRateLimit(300, 5 * 60_000)
  status(): BiometricStatusResponse { return { ok: true, enabled: faceIdEnabled() && !!this.core }; }

  @UseGuards(SignedInUserGuard)
  @Post('enroll')
  async enroll(@Req() req: any, @Body(ValidatedBody(BIOMETRIC_ENROLL_BODY, { strict: true })) b: BiometricEnrollBody): Promise<BiometricEnrollResponse> {
    const core = this.need();
    const p: any = sessionFromRequest(req, process.env.AUTH_SESSION_SECRET || '');
    if (!p?.userId || p.userId !== req?.ctx?.userId) throw new HttpException({ ok: false, code: 'AUTH_REQUIRED', message: 'Please sign in again.' }, 401);
    try {
      return await core.enroll({ sid: p.sid ?? null, userId: p.userId, tenantId: p.tenantId ?? null, branchId: p.branchId ?? null, role: String(p.role), subscriptionStatus: p.subscriptionStatus, platformRole: p.platformRole, restriction: p.restriction },
        b ?? {}, shouldReturnToken(req));
    } catch (e) { this.fail(e); }
  }

  /** Public (pre-auth): device credential → a fresh session. */
  @Post('login') @AnonRateLimit(120, 5 * 60_000, { bucket: 'auth-biometric-login' })   // §28
  async doLogin(@Req() req: any, @Body(ValidatedBody(BIOMETRIC_LOGIN_BODY, { strict: true })) b: BiometricLoginBody, @Res() res: any): Promise<void> {   // body: the login body + BiometricLoginResponse
    const core = this.need();
    const secret = process.env.AUTH_SESSION_SECRET || '';
    if (!secret) { res.status(500).json({ ok: false, error: 'AUTH_SESSION_SECRET is not configured' }); return; }
    let spec;
    try { spec = await core.login(b ?? {}, { ip: clientIp(req) ?? null, userAgent: String(req?.headers?.['user-agent'] ?? '') || null, native: shouldReturnToken(req), secret, secure: process.env.NODE_ENV === 'production' }); }
    catch (e) { this.fail(e); }
    for (const c of [...(spec.cookie ? [spec.cookie] : []), ...(spec.cookies ?? [])]) res.cookie(c.name, c.value, { httpOnly: c.httpOnly, sameSite: c.sameSite, secure: c.secure, maxAge: c.maxAge, path: c.path });
    res.status(spec.status).json(spec.body);
  }

  /** Turn Face ID off on this device (the app also deletes its Keychain item). */
  @UseGuards(SignedInUserGuard)
  @Post('revoke')
  async revoke(@Req() req: any, @Body(ValidatedBody(BIOMETRIC_REVOKE_BODY, { strict: true })) b: BiometricRevokeBody): Promise<BiometricRevokeResponse> {
    const core = this.need();
    return core.revoke(String(req.ctx.userId), b?.deviceId);
  }
}
