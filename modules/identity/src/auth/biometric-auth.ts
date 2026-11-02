// biometric-auth.ts — BUILD_PLAN Phase 13 D (Constitution 6 §37–39, audit bug 2): enrol / sign in / revoke with the
// biometric device credential (biometric-credentials.ts). Framework-free so the whole flow runs in a pgtest; the
// controller (biometric.controller.ts) only maps HTTP onto it.
import { sql } from 'kysely';
import { sessionTtlSeconds } from '@aipowersalon/auth';
import { BIOMETRIC_ENROLL_FRESH_SECONDS, BIOMETRIC_ERRORS, isBiometricSecret, withCode } from '@aipowersalon/api-contracts';
import { KyselyBiometricCredentials, type BiometricClaims } from './biometric-credentials';
import { validDeviceKey } from './auth-devices';
import { loginResponse, accessTtlSeconds, type HttpResponseSpec } from './auth.http';
import type { LoginResult, LoginPrincipal } from './auth-login.service';
import type { SessionStore } from './session-store';

export interface BiometricDeps {
  db: any;
  creds: KyselyBiometricCredentials;
  login: { authorizeResume(c: { userId: string; role: string; tenantId?: string | null; branchId?: string | null }): Promise<{ ok: true; permissions: string[]; av?: number; tv?: number | null } | { ok: false; reason: string }> };
  sessions?: SessionStore | null;
  refresh?: { issue(sid: string, userId: string, ttlSeconds: number): Promise<{ refreshToken: string }> } | null;
  passkeysOff?: (tenantId: string | null) => Promise<boolean>;
  event?: (e: { type: string; outcome: 'success' | 'failure' | 'info'; userId?: string | null; tenantId?: string | null; sessionId?: string | null; reason?: string | null }) => void;
}
export class BiometricHttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

/** Face ID ships OFF until one real-device check on staging (FACE_ID_ENABLED=1) — the same switch as the WebAuthn path. */
export function faceIdEnabled(env: NodeJS.ProcessEnv = process.env): boolean { return env.FACE_ID_ENABLED === '1' || env.FACE_ID_ENABLED === 'true'; }

export class BiometricAuth {
  constructor(private readonly d: BiometricDeps) {}

  /** Signed in (the caller's verified session claims), native only, and a PASSWORD sign-in / step-up in the last 10 min
   *  (a session that was itself opened by Face ID does not count — Face ID never re-arms Face ID). */
  async enroll(session: { sid: string | null; userId: string; tenantId: string | null; branchId: string | null; role: string; subscriptionStatus?: string; platformRole?: string; restriction?: string },
               body: { deviceId?: unknown; deviceName?: unknown; platform?: unknown }, native: boolean) {
    if (!native) throw new BiometricHttpError(403, 'PERMISSION_DENIED', 'Face ID sign-in is set up from the mobile app.');
    if (session.role === 'SUPER_ADMIN') throw new BiometricHttpError(403, 'PERMISSION_DENIED', 'Platform accounts sign in with password and authenticator.');
    if (!validDeviceKey(body.deviceId)) throw new BiometricHttpError(400, 'VALIDATION_FAILED', 'A device id is required.');
    if (this.d.passkeysOff && await this.d.passkeysOff(session.tenantId)) throw withCode(new BiometricHttpError(403, BIOMETRIC_ERRORS.POLICY_OFF, 'Your salon has turned Face ID sign-in off.'), 'FACE_ID_TURNED_OFF');
    if (!session.sid) throw withCode(new BiometricHttpError(403, BIOMETRIC_ERRORS.RECENT_AUTH, 'Confirm your password to turn on Face ID.'), 'BIOMETRIC_RECENT_AUTH_REQUIRED');
    const s: any = (await sql`select auth_device_id,
          ((coalesce(auth_strength, 'password') <> 'biometric' and coalesce(last_primary_auth_at, created_at) > now() - (${BIOMETRIC_ENROLL_FRESH_SECONDS} * interval '1 second'))
           or (last_step_up_at is not null and last_step_up_at > now() - (${BIOMETRIC_ENROLL_FRESH_SECONDS} * interval '1 second'))) as fresh
        from sessions where id = ${session.sid}::uuid and user_id = ${session.userId}::uuid and revoked_at is null`.execute(this.d.db)).rows[0];
    if (!s) throw new BiometricHttpError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    if (!s.fresh) throw withCode(new BiometricHttpError(403, BIOMETRIC_ERRORS.RECENT_AUTH, 'Confirm your password to turn on Face ID.'), 'BIOMETRIC_RECENT_AUTH_REQUIRED');
    const claims: BiometricClaims = {
      userId: session.userId, tenantId: session.tenantId ?? null, branchId: session.branchId ?? null, role: session.role,
      ...(session.subscriptionStatus ? { subscriptionStatus: session.subscriptionStatus } : {}),
      ...(session.restriction ? { restriction: session.restriction } : {}),
    };
    const platform = body.platform === 'ios' || body.platform === 'android' ? body.platform : null;
    const out = await this.d.creds.enroll({ userId: session.userId, tenantId: session.tenantId ?? null, authDeviceId: s.auth_device_id ?? null, deviceKey: String(body.deviceId), platform, deviceName: typeof body.deviceName === 'string' ? body.deviceName : null, claims });
    this.d.event?.({ type: 'BIOMETRIC_ENROLLED', outcome: 'info', userId: session.userId, tenantId: session.tenantId ?? null, sessionId: session.sid });
    return { ok: true as const, ...out };
  }

  /** Public. A valid credential + device → a NEW session (re-authorized now) and the rotated secret. */
  async login(body: { credentialId?: unknown; deviceId?: unknown; secret?: unknown }, req: { ip?: string | null; userAgent?: string | null; native: boolean; secret: string; secure: boolean }): Promise<HttpResponseSpec> {
    const bad = (code: string = BIOMETRIC_ERRORS.INVALID) => new BiometricHttpError(401, code, 'Sign in with your password to turn Face ID back on.');
    if (!req.native) throw new BiometricHttpError(403, 'PERMISSION_DENIED', 'Face ID sign-in works in the mobile app.');
    if (typeof body.credentialId !== 'string' || !validDeviceKey(body.deviceId) || !isBiometricSecret(body.secret)) throw bad();
    const v = await this.d.creds.verifyAndRotate({ credentialId: body.credentialId, deviceKey: String(body.deviceId), secret: String(body.secret) });
    if (!v.ok) {
      this.d.event?.({ type: v.reason === 'reused' ? 'BIOMETRIC_REUSE_DETECTED' : 'BIOMETRIC_LOGIN_FAILED', outcome: 'failure', reason: v.reason });
      throw bad(v.reason === 'reused' ? BIOMETRIC_ERRORS.REUSED : BIOMETRIC_ERRORS.INVALID);
    }
    const c = v.claims;
    if (this.d.passkeysOff && await this.d.passkeysOff(c.tenantId ?? null)) {
      await this.d.creds.revokeById(v.credentialId, 'policy_off');
      throw withCode(new BiometricHttpError(403, BIOMETRIC_ERRORS.POLICY_OFF, 'Your salon has turned Face ID sign-in off. Sign in with your password.'), 'FACE_ID_TURNED_OFF');
    }
    const authz = await this.d.login.authorizeResume({ userId: v.userId, role: c.role, tenantId: c.tenantId, branchId: c.branchId });
    if (!authz.ok) {
      await this.d.creds.revokeById(v.credentialId, `access_changed:${authz.reason}`);
      this.d.event?.({ type: 'BIOMETRIC_LOGIN_FAILED', outcome: 'failure', userId: v.userId, tenantId: c.tenantId ?? null, reason: authz.reason });
      throw new BiometricHttpError(401, 'SESSION_ENDED', 'Your access changed. Please sign in again.');
    }
    const u: any = (await sql`select full_name from users where id = ${v.userId}::uuid`.execute(this.d.db)).rows[0];
    const needsBranch = c.role !== 'CUSTOMER' && c.role !== 'OWNER' && !c.branchId;
    const principal: LoginPrincipal = {
      userId: v.userId, tenantId: c.tenantId ?? null, branchId: needsBranch ? null : (c.branchId ?? null), role: c.role as any,
      permissions: authz.permissions, subscriptionStatus: (c.subscriptionStatus ?? 'active') as any, needsBranchSelection: needsBranch,
      fullName: u?.full_name ?? null, ...(c.restriction ? { restriction: c.restriction as any } : {}),
      ...(typeof authz.av === 'number' ? { av: authz.av, tv: authz.tv ?? null } : {}),
    };
    const ttlSeconds = sessionTtlSeconds(c.role, false);
    const sid = this.d.sessions ? (await this.d.sessions.create({
      authDeviceId: v.authDeviceId, mfaVerified: false, userId: v.userId, tenantId: principal.tenantId, branchId: principal.branchId,
      ip: req.ip ?? undefined, userAgent: req.userAgent ?? null, deviceId: String(body.deviceId), deviceName: null, platform: 'native', authStrength: 'biometric', ttlSeconds,
    })) ?? undefined : undefined;
    let refreshToken: string | undefined;
    if (this.d.refresh && sid) { try { refreshToken = (await this.d.refresh.issue(sid, v.userId, ttlSeconds)).refreshToken; } catch { /* the session then expires with its access token */ } }
    const result: LoginResult = { outcome: needsBranch ? 'BRANCH_SELECTION_REQUIRED' : 'SUCCESS', message: needsBranch ? 'Select the branch you want to work in.' : 'Signed in.', principal };
    const spec = loginResponse(result, { secret: req.secret, ttlSeconds, accessTtlSeconds: refreshToken ? accessTtlSeconds() : undefined, refreshToken, secure: req.secure, sid, includeToken: true });
    this.d.event?.({ type: 'BIOMETRIC_LOGIN_SUCCEEDED', outcome: 'success', userId: v.userId, tenantId: c.tenantId ?? null, sessionId: sid ?? null });
    return { ...spec, body: { ...spec.body, nextSecret: v.nextSecret, credentialExpiresAt: v.expiresAt } };
  }

  /** The signed-in person turns Face ID off on this device (or signs out of it). */
  async revoke(userId: string, deviceId: unknown, why = 'user_disabled'): Promise<{ ok: true; revoked: number }> {
    if (!validDeviceKey(deviceId)) return { ok: true, revoked: 0 };
    return { ok: true, revoked: await this.d.creds.revokeForDevice(userId, String(deviceId), why) };
  }
}
