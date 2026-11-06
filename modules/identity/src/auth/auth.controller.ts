import { SecurityNotifications } from './security-notifications';
import { AuditService, auditSinkFor } from '@aipowersalon/audit';
import { KyselyTenantAuthPolicy } from './tenant-auth-policy';
import { StaffSessionGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { MFA_ATTEMPT_LIMITER, type KeyedRateLimiter } from '@aipowersalon/security';
import { clientIp } from '@aipowersalon/security';
import { sessionTtlSeconds } from '@aipowersalon/auth';
import { posClientType, sessionLockState, AUTO_LOCK_DEFAULT, LOCKED_FULL_SIGN_IN_HOURS, SESSION_LOCK_MAX_MS, PIN_UNLOCK_MAX_FAILURES, type SessionLockStatus, type SessionActivityResponse } from '@aipowersalon/api-contracts';
/**
 * auth.controller.ts — HTTP endpoints for authentication. Thin by design: it calls LoginService.attempt and applies the
 * pure auth.http response spec (status + body + cookie) to the Express response. No business/security logic lives here.
 * `login` is public (no session required). When the tenant-context middleware is later applied globally, /auth/login and
 * the super-admin login must be excluded from it.
 */
import { Body, Controller, Get, Inject, Optional, Post, Req, Res, Header, UseGuards, HttpCode, UnauthorizedException } from '@nestjs/common';
import type { SessionStore } from './session-store';
import { LoginService, type LoginInput } from './auth-login.service';
import { loginResponse, logoutResponse, selectBranchResponse, accessTtlSeconds, refreshCookieNameFor, REFRESH_COOKIE_PATH, type HttpResponseSpec } from './auth.http';
import { RefreshSessionService } from './refresh-session';
import { KyselyAuthDevices, validDeviceKey, newWebDeviceKey, WEB_DEVICE_COOKIE } from './auth-devices';
import { KyselyAuthEvents, maskIdentifier, type AuthEvent } from './auth-events';
import { looksLikeRecoveryCode } from './mfa-recovery-codes';
function readCookie(req: any, name: string): string | null {
  const raw = String(req?.headers?.cookie ?? '');
  for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); } } }
  return null;
}
export function isSecure(req?: any): boolean {
  if (process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true') return true;
  if (!req) return false;
  if (req.secure) return true;
  const proto = String(req.headers?.['x-forwarded-proto'] ?? '').toLowerCase();
  if (proto === 'https') return true;
  const origin = String(req.headers?.origin ?? '');
  if (origin.startsWith('https://')) return true;
  const referer = String(req.headers?.referer ?? '');
  if (referer.startsWith('https://')) return true;
  return false;
}
/** A readable label for a browser device ("Chrome on Windows"); display only. */
function deviceLabelFromUa(ua: string): string {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'device';
  return `${b} on ${os}`;
}
import { verifySession, signSession, type SessionClaims } from './auth-session-token';
import { readSessionToken, ALL_REALM_COOKIES, cookieNameFor } from './session-from-request';
import { shouldReturnToken } from './native-client';
import { BranchSelectionService, BranchError, type BranchSessionInput } from './branch-access';
import { BRANCH_SWITCH_GUARD, type BranchSwitchGuardPort } from './branch-switch-guard';
import { ModuleRef } from '@nestjs/core';
import { sessionFromRequest } from './session-from-request';
import { DATABASE, canMoveToSql, type AppDatabase } from '@aipowersalon/database';
import { buildMediaUrl } from '@aipowersalon/media';

import { LOGIN_BODY, PIN_BODY, REFRESH_BODY, SELECT_BRANCH_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
import { sql } from 'kysely';
import { SESSION } from './identity-lifecycles';
/** /auth/set-pin: failed re-authentications per user inside the window before the route answers 429 (Oct 12 2026 merge). */
export const PIN_SET_FAIL_LIMIT = 5;
export const PIN_SET_WINDOW_MS = 10 * 60_000;
@Controller('auth')
export class AuthController {
  constructor(
    private readonly login: LoginService,
    private readonly branches: BranchSelectionService,
    @Optional() @Inject('SessionStore') private readonly sessions?: SessionStore,
    @Optional() @Inject(DATABASE) private readonly db?: AppDatabase,
    @Optional() @Inject(MFA_ATTEMPT_LIMITER) private readonly pinLimiter?: KeyedRateLimiter,
    @Optional() @Inject(RefreshSessionService) private readonly refresh?: RefreshSessionService,
    @Optional() @Inject(KyselyAuthDevices) private readonly devices?: KyselyAuthDevices,
    @Optional() @Inject(KyselyAuthEvents) private readonly authEvents?: KyselyAuthEvents | null,
    @Optional() @Inject(KyselyTenantAuthPolicy) private readonly policy?: KyselyTenantAuthPolicy | null,
    @Optional() @Inject(SecurityNotifications) private readonly notifier?: SecurityNotifications | null,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService | null,   // Oct 12 2026 merge: the PIN-set audit (AuditModule is @Global)
    @Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef,   // mandate §120: finds the BRANCH_SWITCH_GUARD another module provides (identity never imports it)
  ) {}
  /** Mandate §120: the guard a payment-taking module registered, or null when this deployment has none. */
  private branchSwitchGuard(): BranchSwitchGuardPort | null {
    try { return (this.moduleRef?.get<BranchSwitchGuardPort>(BRANCH_SWITCH_GUARD as any, { strict: false }) as BranchSwitchGuardPort) ?? null; } catch { return null; }
  }
  private ev(req: any, e: Omit<AuthEvent, 'ip' | 'userAgent'>): void {
    void this.authEvents?.record({ ...e, ip: clientIp(req) ?? null, userAgent: String(req?.headers?.['user-agent'] ?? '') || null });
  }

  private apply(res: any, spec: HttpResponseSpec, req?: any) {
    const sec = isSecure(req);
    const sameSiteOverride = (process.env.COOKIE_SAMESITE as 'lax' | 'none' | undefined) ?? (sec ? 'none' : undefined);
    for (const c of [...(spec.cookie ? [spec.cookie] : []), ...(spec.cookies ?? [])]) {
      const cookieSecure = c.secure || sec;
      const sameSite = sameSiteOverride ?? (cookieSecure ? 'none' : c.sameSite);
      res.cookie(c.name, c.value, { httpOnly: c.httpOnly, sameSite, secure: cookieSecure, maxAge: c.maxAge, path: c.path });
    }
    if (spec.clearCookie) {
      const sameSite = sameSiteOverride ?? (sec ? 'none' : 'lax');
      res.clearCookie(spec.clearCookie.name, { path: spec.clearCookie.path, secure: sec, sameSite });
    }
    for (const c of spec.clearCookies ?? []) {
      const sameSite = sameSiteOverride ?? (sec ? 'none' : 'lax');
      res.clearCookie(c.name, { path: c.path, secure: sec, sameSite });
    }
    res.status(spec.status).json(spec.body);
  }

  @Post('login')
  async doLogin(@Req() req: any, @Body(ValidatedBody(LOGIN_BODY)) b: any, @Res() res: any) {
    const secret = process.env.AUTH_SESSION_SECRET || '';
    if (!secret) { res.status(500).json({ ok: false, error: 'AUTH_SESSION_SECRET is not configured' }); return; }
    const input: LoginInput = {
      portal: (b?.portal === 'super-admin' || b?.portal === 'owner' || b?.portal === 'customer') ? b.portal : 'tenant',
      salonCode: b?.salonCode,
      identifier: b?.identifier ?? b?.email ?? b?.phone ?? '',
      password: b?.password ?? '',
      mfaCode: b?.mfaCode,
      ownerAccessCode: typeof b?.ownerAccessCode === 'string' ? b.ownerAccessCode : undefined,
      rememberMe: b?.rememberMe === true,
      // Constitution 12 §58: the throttle was built to key on the caller's IP and was never given one — it locked per
      // ACCOUNT only, so anyone could lock an owner out from everywhere. The proxy-aware address, never a body field.
      ip: clientIp(req) ?? undefined,
      // Step 10b: the device key is a RISK signal only (never an authorization input)
      deviceKey: (shouldReturnToken(req) && validDeviceKey(b?.device?.id) ? b.device.id : null) ?? readCookie(req, WEB_DEVICE_COOKIE),
    };
    const result = await this.login.attempt(input);
    let sid: string | undefined;
    let newDeviceInfo: { authDeviceId: string; isNew: boolean; hadOtherDevices: boolean; name: string } | null = null;   // Step 10a
    const sec = isSecure(req);
    if (this.sessions && result.principal && (result.outcome === 'SUCCESS' || result.outcome === 'BRANCH_SELECTION_REQUIRED')) {
      const p: any = result.principal;
      // Constitution 3 §21–24: which device is this? Native sends its per-install id; a browser carries an httpOnly
      // `aps_device` cookie (minted on its first sign-in). A device its user BLOCKED is refused before any session exists.
      let authDeviceId: string | null = null; let newDevice: { isNew: boolean; hadOtherDevices: boolean; name: string } | null = null;
      if (this.devices) {
        const nativeKey = shouldReturnToken(req) && validDeviceKey(b?.device?.id) ? b.device.id : null;
        let webKey = !nativeKey ? readCookie(req, WEB_DEVICE_COOKIE) : null;
        if (!nativeKey && !validDeviceKey(webKey)) {
          webKey = newWebDeviceKey();
          const devSameSite = (process.env.COOKIE_SAMESITE as any) ?? (sec ? 'none' : 'lax');
          res.cookie(WEB_DEVICE_COOKIE, webKey, { httpOnly: true, sameSite: devSameSite, secure: sec, maxAge: 400 * 86_400_000, path: '/' });
        }
        try {
          const d = await this.devices.recordSignIn(p.userId, (nativeKey ?? webKey)!, { name: typeof b?.device?.name === 'string' ? b.device.name : deviceLabelFromUa(String(req?.headers?.['user-agent'] ?? '')), platform: typeof b?.device?.platform === 'string' ? b.device.platform : (nativeKey ? 'native' : 'web'), ip: clientIp(req) });
          if (d === 'refuse') { this.ev(req, { type: 'DEVICE_BLOCKED_SIGNIN', outcome: 'failure', userId: p.userId, tenantId: p.tenantId ?? null, reason: 'device_blocked' }); res.status(403).json({ ok: false, outcome: 'DEVICE_BLOCKED', code: 'DEVICE_BLOCKED', message: 'Sign-in from this device was blocked on your account. Unblock it from another device under Security → Devices.' }); return; }
          authDeviceId = d.deviceId;
          newDevice = { isNew: d.isNew, hadOtherDevices: d.hadOtherDevices, name: typeof b?.device?.name === 'string' ? b.device.name : deviceLabelFromUa(String(req?.headers?.['user-agent'] ?? '')) };
        } catch { /* the device ledger never blocks a sign-in on its own failure */ }
      }
      sid = (await this.sessions.create({
        authDeviceId, mfaVerified: !!result.mfaVerified,
        userId: p.userId, tenantId: p.tenantId ?? null, branchId: result.outcome === 'SUCCESS' ? (p.branchId ?? null) : null,
        ip: clientIp(req),
        // Constitution 12 §144–146: the User-Agent from the REQUEST (not the body), and the device label the native
        // app supplies. Labels identify a device to its OWNER in the sessions list; no authorization rests on them.
        userAgent: String(req?.headers?.['user-agent'] ?? '') || null,
        deviceId: typeof b?.device?.id === 'string' ? b.device.id : null,
        deviceName: typeof b?.device?.name === 'string' ? b.device.name : null,
        platform: ['ios', 'android', 'web'].includes(b?.device?.platform) ? b.device.platform : (shouldReturnToken(req) ? 'native' : 'web'),
        // Oct 12 2026 (Kevin's POS auto-lock): the POS web app says so (X-Client-Type: pos) → the server idle-locks this session.
        clientApp: posClientType(req?.headers),
        ttlSeconds: sessionTtlSeconds(result.principal?.role, !!input.rememberMe),
      })) ?? undefined;
      if (authDeviceId && newDevice) newDeviceInfo = { authDeviceId, ...newDevice };
    }
    // Constitution 3 §88 / §147: what just happened, in the auth event log (never the credential itself).
    if (result.principal && (result.outcome === 'SUCCESS' || result.outcome === 'BRANCH_SELECTION_REQUIRED')) {
      const p: any = result.principal;
      this.ev(req, { type: 'LOGIN_SUCCEEDED', outcome: 'success', userId: p.userId, tenantId: p.tenantId ?? null, sessionId: sid ?? null, metadata: { portal: input.portal, mfa: !!result.mfaVerified } });
      // Constitution 3 Step 10a: a device this account has never used → email the account holder (never delays the sign-in)
      if (this.notifier && newDeviceInfo?.authDeviceId && newDeviceInfo.isNew) void this.notifier.onSignIn({ userId: p.userId, tenantId: p.tenantId ?? null, deviceId: newDeviceInfo.authDeviceId, isNew: true, hadOtherDevices: newDeviceInfo.hadOtherDevices, deviceName: newDeviceInfo.name, ip: clientIp(req) ?? null })
        .then((sent) => { if (sent) this.ev(req, { type: 'NEW_DEVICE_ALERT_SENT', outcome: 'info', userId: p.userId, tenantId: p.tenantId ?? null, sessionId: sid ?? null }); }).catch(() => undefined);
      if (result.mfaVerified && looksLikeRecoveryCode(String(input.mfaCode ?? ''))) this.ev(req, { type: 'RECOVERY_CODE_USED', outcome: 'info', userId: p.userId, tenantId: p.tenantId ?? null, sessionId: sid ?? null });
    }
    if (result.risk?.level === 'elevated' && result.principal) this.ev(req, { type: 'RISK_ELEVATED', outcome: 'info', userId: (result.principal as any).userId, tenantId: (result.principal as any).tenantId ?? null, sessionId: sid ?? null, metadata: { ...result.risk.signals, outcome: result.outcome } });
    if (result.outcome === 'RATE_LIMITED' && /network/.test(result.message)) this.ev(req, { type: 'STUFFING_BLOCKED', outcome: 'failure', reason: 'distinct_account_burst', metadata: { portal: input.portal, identifier: maskIdentifier(input.identifier) } });
    if (result.principal && (result.outcome === 'SUCCESS' || result.outcome === 'BRANCH_SELECTION_REQUIRED')) { /* logged above */ }
    else if (result.outcome === 'MFA_REQUIRED' && input.mfaCode) {
      this.ev(req, { type: 'MFA_FAILED', outcome: 'failure', reason: 'wrong_code', metadata: { portal: input.portal, identifier: maskIdentifier(input.identifier) } });
    } else if (result.outcome !== 'MFA_REQUIRED') {
      this.ev(req, { type: 'LOGIN_FAILED', outcome: 'failure', reason: String(result.outcome).toLowerCase(), metadata: { portal: input.portal, identifier: maskIdentifier(input.identifier) } });
    }
    // "Remember me" selects the platform's EXTENDED session policy — the duration is decided here on the server
    // (never sent by the client). The cookie stays httpOnly + SameSite + secure-in-production either way.
    // One policy for the session row AND the cookie (Constitution 12 §23/§152): by role; SUPER_ADMIN is capped and
    // "Remember me" never extends it.
    const ttlSeconds = sessionTtlSeconds(result.principal?.role, !!input.rememberMe);
    // The token goes in the BODY only for the native app, which cannot use the cookie. The decision comes from
    // the unforgeable `Origin` header — a browser (and therefore any XSS in it) can never claim to be native, so
    // the web app keeps the httpOnly-cookie protection it has today.
    const includeToken = shouldReturnToken(req);
    // Constitution 3 §7–12: a 15-minute access token plus an opaque refresh token living as long as the session.
    let refreshToken: string | undefined;
    if (this.refresh && sid && result.principal) { try { refreshToken = (await this.refresh.issue(sid, (result.principal as any).userId, ttlSeconds)).refreshToken; } catch { /* a session without a refresh token simply expires with its access token */ } }
    this.apply(res, loginResponse(result, { secret, ttlSeconds, accessTtlSeconds: refreshToken ? accessTtlSeconds() : undefined, refreshToken, secure: sec, sid, includeToken }), req);
  }

  /** Constitution 3 §7–12 / §170: rotate the refresh token and mint a new access token for the SAME session. The web
   *  sends the refresh cookie (scoped to this path) plus the expired access cookie; native sends refreshToken in the body
   *  and the expired access token as Bearer. A reused refresh token burns the whole session (§170). */
  @Post('refresh')
  async doRefresh(@Req() req: any, @Body(ValidatedBody(REFRESH_BODY)) b: any, @Res() res: any) {
    const secret = process.env.AUTH_SESSION_SECRET || '';
    if (!secret || !this.refresh) { res.status(503).json({ ok: false, code: 'REFRESH_UNAVAILABLE' }); return; }
    const cookieHeader = String(req?.headers?.cookie ?? '');
    const fromCookie = ALL_REALM_COOKIES.map((n) => n + '_refresh').map((n) => cookieHeader.split(';').map((p: string) => p.trim()).find((p: string) => p.startsWith(n + '='))?.slice(n.length + 1)).find(Boolean);
    const raw = typeof b?.refreshToken === 'string' ? b.refreshToken : fromCookie ? decodeURIComponent(fromCookie) : '';
    const rotated = await this.refresh.rotate(raw);
    if (!rotated.ok && rotated.reason === 'reused') this.ev(req, { type: 'REFRESH_REUSE_DETECTED', outcome: 'failure', reason: 'refresh_token_reused' });
    if (!rotated.ok) { res.status(401).json({ ok: false, code: rotated.reason === 'reused' ? 'TOKEN_REUSE_DETECTED' : 'REFRESH_INVALID', reason: rotated.reason }); return; }
    // The expired access token names the session's claims; it must be THIS session's, signed by us.
    const access = readSessionToken(req?.headers, '/auth/refresh');
    const v = access ? verifySession(access, { secret, allowExpired: true }) : null;
    if (!v?.valid || v.payload.sid !== rotated.sessionId || v.payload.userId !== rotated.userId) {
      await this.refresh.revokeSession(rotated.sessionId);   // a refresh token without its session's access token: treat as theft
      res.status(401).json({ ok: false, code: 'REFRESH_INVALID', reason: 'session_mismatch' }); return;
    }
    const { iat: _i, exp: _e, aud: _a, iss: _s, typ: _t, actorType: _at, av: _av, tv: _tv, ...claims } = v.payload as any;
    // The new token carries what the account may do NOW, not what it could do at sign-in (Oct 6 2026).
    let now: Awaited<ReturnType<LoginService['currentAuthorization']>> = null;
    // BUILD_PLAN Phase 9: and the CURRENT authorization versions — read before the permissions (a change in between leaves
    // the old version in the token, so the next request re-authorizes; never the reverse).
    let versions: { av: number; tv: number | null } | null = null;
    try { versions = await this.login.authorizationVersions(claims); now = await this.login.currentAuthorization(claims); }
    catch { res.status(503).json({ ok: false, code: 'REFRESH_UNAVAILABLE' }); return; }   // never re-sign blind on a DB error
    if (now && !now.ok) {
      await this.refresh.revokeSession(rotated.sessionId);
      if (this.sessions) { try { await this.sessions.revoke(rotated.sessionId); } catch { /* refresh tokens are already gone */ } }
      this.ev(req, { type: 'SESSION_ENDED_ACCESS_CHANGED', outcome: 'info', userId: claims.userId ?? null, tenantId: claims.tenantId ?? null, sessionId: rotated.sessionId, reason: now.reason });
      res.status(401).json({ ok: false, code: 'SESSION_ENDED', reason: now.reason }); return;
    }
    if (now?.ok) claims.permissions = now.permissions;
    if (versions) { claims.av = versions.av; claims.tv = versions.tv; }
    const accessTtl = accessTtlSeconds(); const cookieTtl = Math.max(60, Math.floor((rotated.expiresAtMs - Date.now()) / 1000));
    const token = signSession(claims as SessionClaims, { secret, ttlSeconds: accessTtl });
    const secure = isSecure(req);
    const includeToken = shouldReturnToken(req);
    const spec: HttpResponseSpec = {
      status: 200,
      body: { ok: true, expiresIn: accessTtl, ...(includeToken ? { accessToken: token, refreshToken: rotated.refreshToken } : {}) },
      cookie: { name: cookieNameFor(claims.role), value: token, maxAge: cookieTtl * 1000, httpOnly: true, sameSite: 'lax', secure, path: '/' },
      cookies: [{ name: refreshCookieNameFor(claims.role), value: rotated.refreshToken, maxAge: cookieTtl * 1000, httpOnly: true, sameSite: 'lax', secure, path: REFRESH_COOKIE_PATH }],
    };
    this.apply(res, spec, req);
  }

  @Post('logout')
  async doLogout(@Req() req: any, @Res() res: any) {
    const payload = sessionFromRequest(req, process.env.AUTH_SESSION_SECRET || '');
    const sid = (payload as any)?.sid;
    // Nov 5 2026 (Kevin; changes Constitution 6 §37): a normal sign-out on the phone KEEPS Face ID on it, so the person signs
    // back in with Face ID. Migration 705's trigger ends Face ID whenever a session is revoked for any OTHER reason (sign
    // out other devices, Super Admin, theft, access change, …); this revoke sets the transaction-local flag that exempts it.
    // Turning Face ID off at sign-out is the app's explicit choice: it calls POST /auth/biometric/revoke first.
    if (this.db && sid) {
      try {
        await this.db.transaction().execute(async (trx: any) => {
          await sql`select set_config('aps.keep_face_id', 'on', true)`.execute(trx);
          await sql`update sessions set status = 'revoked', revoked_at = now() where id = ${sid} and ${canMoveToSql(SESSION, 'revoked')}`.execute(trx);
        });
      } catch { /* the session store revoke below still ends the session */ }
    }
    if (this.sessions && sid) { try { await this.sessions.revoke(sid); } catch { /* still clear the cookie */ } }
    if (this.refresh && sid) { try { await this.refresh.revokeSession(sid); } catch { /* the session is already revoked */ } }   // §7–12: no refresh after sign-out
    if (sid) this.ev(req, { type: 'LOGOUT', outcome: 'info', userId: req?.ctx?.userId ?? null, tenantId: req?.ctx?.tenantId ?? null, sessionId: sid });
    this.apply(res, logoutResponse(), req);
  }

  @Get('branches')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async listBranches(@Req() req: any, @Res() res: any) {
    const secret = process.env.AUTH_SESSION_SECRET || '';
    if (!secret) { res.status(500).json({ ok: false, error: 'AUTH_SESSION_SECRET is not configured' }); return; }
    const payload = sessionFromRequest(req, secret);
    const session: BranchSessionInput | null = payload
      ? { userId: payload.userId, tenantId: payload.tenantId, branchId: payload.branchId, role: payload.role, permissions: payload.permissions, subscriptionStatus: payload.subscriptionStatus, sid: (payload as any).sid }
      : null;
    try {
      const branches = await this.branches.list(session);
      res.status(200).json({ ok: true, branches });
    } catch (e) {
      if (e instanceof BranchError) {
        const status = e.code === 'not_authenticated' ? 401 : 400;
        res.status(status).json({ ok: false, code: e.code, message: e.message });
        return;
      }
      throw e;
    }
  }

  @Post('select-branch')
  async selectBranch(@Body(ValidatedBody(SELECT_BRANCH_BODY)) b: any, @Req() req: any, @Res() res: any) {
    const secret = process.env.AUTH_SESSION_SECRET || '';
    if (!secret) { res.status(500).json({ ok: false, error: 'AUTH_SESSION_SECRET is not configured' }); return; }
    const payload = sessionFromRequest(req, secret);
    const session: BranchSessionInput | null = payload
      ? { userId: payload.userId, tenantId: payload.tenantId, branchId: payload.branchId, role: payload.role, permissions: payload.permissions, subscriptionStatus: payload.subscriptionStatus, sid: (payload as any).sid, av: payload.av, tv: payload.tv }
      : null;
    try {
      let targetBranchId = String(b?.branchId ?? b?.id ?? b?.branch_id ?? b?.selectedBranchId ?? (typeof b === 'string' ? b : '') ?? '').trim();
      if (!targetBranchId && session?.tenantId) {
        try {
          const accessible = await this.branches.list(session);
          const active = accessible.filter((x) => x.isActive);
          if (active.length > 0) targetBranchId = active[0].id;
        } catch { /* fallback to default validator handling */ }
      }
      const claims = await this.branches.selectBranch(session, targetBranchId);   // §121: only a branch this person may enter
      // Mandate §120: a MOVE from one branch to another waits while a payment is active in the branch being left (the first
      // pick after sign-in, or re-picking the same branch, moves nothing). A guard that cannot answer fails closed.
      const fromBranchId = session?.branchId || null;
      const moving = !!fromBranchId && fromBranchId !== claims.branchId;
      const deviceId = typeof b?.deviceId === 'string' && b.deviceId.trim() ? b.deviceId.trim().slice(0, 128) : null;
      if (moving) {
        const guard = this.branchSwitchGuard();
        if (guard) {
          let block: { code: string; message: string } | null = null;
          try { block = await guard.blockReason({ tenantId: String(session!.tenantId), branchId: fromBranchId!, userId: session!.userId, deviceId, targetBranchId: String(claims.branchId) }); }
          catch { res.status(503).json({ ok: false, code: 'BRANCH_SWITCH_CHECK_UNAVAILABLE', message: 'Could not confirm that no payment is active. Try again in a moment.' }); return; }
          if (block) { res.status(409).json({ ok: false, code: block.code, message: block.message }); return; }
        }
      }
      const sec = isSecure(req);
      const ttlSeconds = Number(process.env.AUTH_SESSION_TTL) || undefined;
      this.apply(res, selectBranchResponse(claims, { secret, ttlSeconds, secure: sec, includeToken: shouldReturnToken(req) }), req);
      // §141 "branch switched": who moved from where to where (and from which payment phone, when the app named it)
      if (moving) void Promise.resolve(this.audit?.record({ tenantId: String(claims.tenantId), branchId: claims.branchId, userId: claims.userId, role: String(claims.role) } as any, { module: 'auth', action: 'branch_switched', resourceType: 'branch', resourceId: claims.branchId, summary: 'Switched location', metadata: { fromBranchId, toBranchId: claims.branchId, deviceId } })).catch(() => { /* audit never breaks the switch */ });
    } catch (e) {
      if (e instanceof BranchError) {
        const status = e.code === 'not_authenticated' ? 401 : e.code === 'branch_not_found' ? 404 : e.code === 'branch_inactive' ? 403 : 400;
        res.status(status).json({ ok: false, code: e.code, message: e.message });
        return;
      }
      throw e;
    }
  }

  @Get('me')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async me(@Req() req: any) {
    const ctx = req?.ctx ?? null;
    if (!ctx || !ctx.userId) return null;
    if (this.db) {
      const u = await this.db.selectFrom('users').select(['avatar_url', 'full_name']).where('id', '=', ctx.userId).executeTakeFirst().catch(() => null);
      if (u) {
        return {
          ...ctx,
          fullName: u.full_name || ctx.fullName,
          avatarUrl: u.avatar_url ? buildMediaUrl(u.avatar_url) : ctx.avatarUrl ?? null,
        };
      }
    }
    return ctx;
  }

  @UseGuards(StaffSessionGuard)   // own row only (Constitution 12 §27)
  @Post('verify-pin')
  async verifyPin(@Req() req: any, @Body(ValidatedBody(PIN_BODY)) b: any, @Res() res: any) {
    const ctx = req?.ctx;
    if (!ctx || !ctx.userId) { res.status(403).json({ success: false, message: 'Session context missing' }); return; }
    if (!this.db) { res.status(500).json({ success: false }); return; }
    // Constitution 3 Step 9: a salon that switched PIN unlock off needs a full sign-in — answered like an unset PIN so
    // the POS lock screen already knows what to do.
    if (ctx.tenantId && this.policy && (await this.policy.get(ctx.tenantId)).pinLogin === false) {
      res.status(403).json({ success: false, code: 'pin_login_disabled', message: 'Your salon requires your password to unlock. Sign in again.' }); return;
    }
    const u = await this.db.selectFrom('users').select(['pin_hash']).where('id', '=', ctx.userId).executeTakeFirst();
    if (!u) { res.status(403).json({ success: false }); return; }

    const providedPin = String(b?.pin ?? '');
    // Sep 2026 merge (the developer's POS lock screen): no default PIN — an unset PIN means a full sign-in (their
    // 'allow 1234 if no PIN is set' would have unlocked ANY idle POS for any user). Wrong guesses are budgeted per user on
    // the same keyed limiter as TOTP guesses; when the budget is spent the client is told to sign in fully.
    if (!u.pin_hash) { res.status(403).json({ success: false, code: 'pin_not_set', message: 'Set a PIN in your profile, or sign in with your password.' }); return; }
    const key = `pin:${ctx.userId}`;
    const sid: string | null = req.sessionId ?? null;
    // an ended session (too many wrong PINs, locked > 8 h) never comes back with a PIN — the middleware already refuses it;
    // this keeps the rule true for any other caller of this handler
    if (sid && this.sessions && await this.sessions.isRevoked(sid)) { res.status(401).json({ success: false, code: 'SESSION_ENDED', message: 'Sign in again.' }); return; }
    const tooMany = () => res.status(429).json({ success: false, code: 'too_many_attempts', message: 'Too many wrong PINs. Sign in with your password.' });
    if (this.pinLimiter && await this.pinLimiter.isBlocked(key)) {
      this.ev(req, { type: 'PIN_UNLOCK_FAILED', outcome: 'failure', userId: ctx.userId, tenantId: ctx.tenantId ?? null, sessionId: sid, reason: 'rate_limited' });
      tooMany(); return;
    }
    const { verifyPassword } = await import('@aipowersalon/auth');
    const valid = await verifyPassword(providedPin, u.pin_hash);
    if (!valid) {
      if (this.pinLimiter) await this.pinLimiter.hit(key);
      // Oct 12 2026: every wrong PIN is audited, and counted on the SESSION row — the per-user limiter above is a no-op where
      // Redis is not configured, so this is the limit that always holds: the PIN_UNLOCK_MAX_FAILURES-th wrong PIN ends the session.
      const failures = sid && this.sessions?.recordPinFailure ? await this.sessions.recordPinFailure(sid).catch(() => 0) : 0;
      const ended = failures >= PIN_UNLOCK_MAX_FAILURES;
      this.ev(req, { type: 'PIN_UNLOCK_FAILED', outcome: 'failure', userId: ctx.userId, tenantId: ctx.tenantId ?? null, sessionId: sid, reason: ended ? 'session_ended' : 'wrong_pin', metadata: { failures } });
      if (ended && sid) {
        await this.sessions?.revoke(sid).catch(() => undefined);
        if (this.refresh) await this.refresh.revokeSession(sid).catch(() => undefined);
        tooMany(); return;
      }
      res.status(403).json({ success: false }); return;
    }
    // Decision 35: a correct PIN unlocks the session server-side too (the middleware refuses a locked session), resets the
    // wrong-PIN count and restarts the idle clock.
    if (this.sessions?.unlock && sid) await this.sessions.unlock(sid);
    res.status(200).json({ success: true });
  }

  // Oct 12 2026 (Kevin): "POS auto-lock is on by default at 60 minutes, also locked on the server, with a full sign-in after 8
  // hours locked." What the server knows about THIS session's lock — readable while locked (the middleware's allowlist), so the
  // lock screen shows the server's times and the settings show the salon's value. Never counts as activity.
  @UseGuards(StaffSessionGuard)
  @Get('lock-status')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async lockStatus(@Req() req: any): Promise<SessionLockStatus> {
    if (!req?.ctx?.userId) throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Sign in again.' });
    const sid: string | null = req.sessionId ?? null;
    if (sid && this.sessions?.lockedAt) await this.sessions.lockedAt(sid);   // an idle lock that is due is written first
    const lf = sid && this.sessions?.lockFacts ? await this.sessions.lockFacts(sid) : null;
    const now = lf?.now ?? Date.now();
    const facts = lf?.facts ?? null;
    const policy = lf?.policy ?? AUTO_LOCK_DEFAULT;
    const st = facts ? sessionLockState(facts, policy, now) : { state: 'unlocked' as const, lockedAt: null };
    const posSession = facts?.clientApp === 'pos' && !!facts?.tenantId;
    const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
    const body: SessionLockStatus = {
      posSession, salon: { enabled: policy.enabled, minutes: policy.minutes },
      locked: st.state !== 'unlocked', lockedAt: iso(st.lockedAt), fullSignInAt: iso(st.lockedAt ? st.lockedAt + SESSION_LOCK_MAX_MS : null),
      idleLockAt: posSession && policy.enabled && st.state === 'unlocked' && facts?.lastActivityAt ? iso(facts.lastActivityAt + policy.minutes * 60_000) : null,
      fullSignInAfterHours: LOCKED_FULL_SIGN_IN_HOURS,
    };
    return body;
  }

  // Oct 12 2026: a person is using the POS (sent at most once a minute while someone touches the screen). The ONLY thing that
  // moves the server's idle clock besides sign-in and a correct PIN. A locked session never gets here (423 in the middleware).
  @UseGuards(StaffSessionGuard)
  @Post('session-activity')
  @HttpCode(200)
  async sessionActivity(@Req() req: any): Promise<SessionActivityResponse> {
    if (!req?.ctx?.userId) throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Sign in again.' });
    const sid: string | null = req.sessionId ?? null;
    if (sid && this.sessions?.touchActivity) await this.sessions.touchActivity(sid);
    const lf = sid && this.sessions?.lockFacts ? await this.sessions.lockFacts(sid) : null;
    const f = lf?.facts;
    const idle = f && f.clientApp === 'pos' && f.tenantId && !f.lockedAt && lf!.policy.enabled && f.lastActivityAt ? new Date(f.lastActivityAt + lf!.policy.minutes * 60_000).toISOString() : null;
    return { ok: true, idleLockAt: idle };
  }

  // Decision 35: the POS idle lock locks the SESSION, not just the screen — until /auth/verify-pin succeeds, the API
  // answers this session's other requests with 423 (every tab, any device holding the cookie).
  @UseGuards(StaffSessionGuard)
  @Post('lock')
  async lock(@Req() req: any, @Res() res: any) {
    if (!req?.ctx?.userId) { res.status(401).json({ success: false }); return; }
    if (this.sessions?.lock && req.sessionId) await this.sessions.lock(req.sessionId);
    res.status(200).json({ success: true, locked: !!(this.sessions?.lock && req.sessionId) });
  }

  /**
   * Set / change the POS quick-unlock PIN. Oct 12 2026 merge (other-chat workforce audit P0 #6): re-authentication is
   * REQUIRED — the current password always works; once a PIN exists the current PIN is accepted instead. Before this
   * any open POS tab could silently replace the PIN with a bare { pin }. Failed re-authentications are counted per user
   * in auth_events (PIN_SET_FAILED), fleet-wide, so neither the password nor the old PIN can be guessed through this
   * route (PIN_SET_FAIL_LIMIT / PIN_SET_WINDOW_MS). The new PIN is 4–8 digits, hashed with the password hasher, audited
   * (audit_logs user_pin_set) and never logged.
   */
  @UseGuards(StaffSessionGuard)   // own row only (Constitution 12 §27)
  @Post('set-pin')
  async setPin(@Req() req: any, @Body(ValidatedBody(PIN_BODY)) b: any, @Res() res: any) {
    const ctx = req?.ctx;
    if (!ctx || !ctx.userId) { res.status(401).json({ success: false }); return; }
    if (!this.db) { res.status(500).json({ success: false }); return; }
    const uid = String(ctx.userId);
    if (await this.pinSetFailuresInWindow(uid) >= PIN_SET_FAIL_LIMIT) {
      res.status(429).json({ success: false, code: 'too_many_attempts', message: 'Too many PIN changes. Try again later.' }); return;
    }

    const newPin = typeof b?.pin === 'string' ? b.pin : '';
    if (!/^\d{4,8}$/.test(newPin)) {
      res.status(400).json({ success: false, code: 'invalid_pin', message: 'PIN must be 4–8 digits' });
      return;
    }
    const u = await this.db.selectFrom('users').select(['pin_hash', 'password_hash']).where('id', '=', ctx.userId).executeTakeFirst();
    if (!u) { res.status(403).json({ success: false }); return; }

    const { hashPassword, verifyPassword } = await import('@aipowersalon/auth');
    const currentPassword = typeof b?.currentPassword === 'string' ? b.currentPassword : '';
    const currentPin = typeof b?.currentPin === 'string' ? b.currentPin : '';
    let reauth: 'password' | 'pin' | null = null;
    if (currentPassword && u.password_hash && await verifyPassword(currentPassword, u.password_hash)) reauth = 'password';
    if (!reauth && currentPin && u.pin_hash && await verifyPassword(currentPin, u.pin_hash)) reauth = 'pin';
    if (!reauth) {
      // awaited (not fire-and-forget like ev()): the next attempt's window count must see this failure
      await this.authEvents?.record({ type: 'PIN_SET_FAILED', outcome: 'failure', userId: uid, tenantId: ctx.tenantId ?? null, sessionId: req.sessionId ?? null, reason: currentPassword || currentPin ? 'wrong_credential' : 'missing_credential', ip: clientIp(req) ?? null, userAgent: String(req?.headers?.['user-agent'] ?? '') || null }).catch(() => undefined);
      res.status(403).json({ success: false, code: 'STEP_UP_REQUIRED', message: u.pin_hash ? 'Enter your current PIN or password to change your PIN.' : 'Enter your password to set a PIN.' });
      return;
    }

    const hash = await hashPassword(newPin);
    await this.db.updateTable('users')
      .set({ pin_hash: hash })
      .where('id', '=', ctx.userId)
      .execute();
    this.ev(req, { type: 'PIN_SET', outcome: 'success', userId: uid, tenantId: ctx.tenantId ?? null, sessionId: req.sessionId ?? null, reason: reauth, metadata: { hadPin: !!u.pin_hash } });
    // through modules/audit (audit_events for a salon session, audit_logs for a platform one) — never the PIN itself
    if (this.audit) await auditSinkFor(this.audit).record({ tenantId: ctx.tenantId || null, branchId: ctx.branchId || null, userId: uid, role: ctx.role || null, module: 'auth', action: 'user_pin_set', resourceType: 'user', resourceId: uid, summary: 'PIN set', metadata: { reauth, hadPin: !!u.pin_hash } });

    res.status(200).json({ success: true });
  }

  /** Failed set-pin re-authentications for this user inside the window, read from the shared auth_events table so every
   *  instance counts the same attempts. A read error counts as "over the limit" (fail closed: this route changes a credential). */
  private async pinSetFailuresInWindow(userId: string): Promise<number> {
    if (!this.db) return 0;
    try {
      const r: any = await sql`select count(*)::int as n from auth_events where event_type = 'PIN_SET_FAILED' and user_id = ${userId}::uuid and occurred_at > now() - make_interval(secs => ${PIN_SET_WINDOW_MS / 1000})`.execute(this.db);
      return Number(r?.rows?.[0]?.n ?? 0);
    } catch { return PIN_SET_FAIL_LIMIT; }
  }
}
