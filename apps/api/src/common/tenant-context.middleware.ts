// tenant-context.middleware.ts — STEP 3. Resolves Ctx from the verified session/JWT and attaches it to req.
// The body/query are sanitized so a client-supplied tenantId/branchId can never be used downstream.
import { readOAuthAccessToken, KyselyOAuthAccess } from './oauth-core';
import { readApiKey, apiKeyRouteAllowed, integrationPermissions, KyselyApiKeyAuth } from './api-key-auth';
import { runWithTenant, runAcrossTenants } from '@aipowersalon/database';
import { sessionFromRequest, SESSION_LOCK_MAX_MS, AUTHORIZATION_STATE, authorizeSession, type SessionStore, type AuthorizationStateCache } from '@aipowersalon/identity';
import { PlatformLockdownGate } from './platform-lockdown';
import { CrossTenantSignal, namedForeignTenant } from "../observability/cross-tenant-signal";
import { enrichContext, type ActorType } from '@aipowersalon/observability';
import { HttpException, Inject, Injectable, NestMiddleware, Optional, UnauthorizedException } from "@nestjs/common";
import { Ctx, Role, stripClientTenantKeys, type AuthzContextState } from '@aipowersalon/permissions';
import { contextFromSession } from '@aipowersalon/tenant-context';
import { SUPPORT_SESSION_GATE, assertLiveSupportSession, type SupportSessionLookup } from './support-session-gate';   // Phase 14

// eslint-disable-next-line @typescript-eslint/no-namespace
declare global { namespace Express { interface Request { ctx?: Ctx; } } }

/** Decision 35: the only requests a locked session may make — unlock with the PIN, read who it is, sign out, re-lock. */
const SELECT_BRANCH_PATH = '/auth/select-branch';
/** exported for its spec */
export function isSelectBranchPath(req: any): boolean {
  const path = String(req?.originalUrl ?? req?.url ?? '').split('?')[0];
  return String(req?.method ?? '').toUpperCase() === 'POST' && (path === SELECT_BRANCH_PATH || path.endsWith(SELECT_BRANCH_PATH));
}
/** strip the tenant keys but keep the branch the person asked for (validated by the branch-access service) */
export function keepBranchId(body: Record<string, unknown>): Record<string, unknown> {
  const out = stripClientTenantKeys(body);
  if (typeof body.branchId === 'string') (out as any).branchId = body.branchId;
  return out;
}
// Oct 12 2026 merge (other-chat workforce audit #95): the Owner App's branch FILTER. On /owner/* a requested branchId is a
// VIEW FILTER, not a scope claim — every owner service method passes it through ensureBranch()/resolveBranch() (same
// tenant, inside the owner's allowed set, restricted roles pinned to their branch, denials audited). Until this it was
// stripped with the tenant keys below (Express 4 req.query is writable), so the branch selector and every ?branchId on
// the Owner App did nothing. Captured BEFORE the strip and re-attached for /owner only, only when shaped like an id.
// tenantId is never re-attached anywhere.
const ID_SHAPE = /^[0-9a-fA-F-]{8,64}$|^[A-Za-z0-9_]{2,64}$/;
/** '/owner' or '/owner/…' (segment boundary — not '/owners-club'); the /api/v1 alias too. */
export function isOwnerPath(url: string | undefined): boolean {
  const p = String(url || '').split('?')[0].replace(/^\/+/, '').replace(/^api\/v\d+\//, '');
  return p === 'owner' || p.startsWith('owner/');
}
/** The requested Owner-App branch filter, if it is a single id-shaped string (arrays / objects / garbage ignored). */
export function branchFilterFrom(src: unknown): string | undefined {
  const v = src && typeof src === 'object' ? (src as any).branchId : undefined;
  return typeof v === 'string' && ID_SHAPE.test(v) ? v : undefined;
}
// Oct 12 2026: + the lock-status read (the lock screen asks the server when quick PIN stops working). Pinned by
// session-lock.vitest.spec.ts — health, sign-in, refresh and logout are outside this middleware altogether.
export const LOCKED_SESSION_ALLOWLIST: readonly string[] = Object.freeze(['/auth/verify-pin', '/auth/me', '/auth/logout', '/auth/lock', '/auth/lock-status']);
export function isUnlockPath(url: string): boolean {
  const path = url.split('?')[0].replace(/\/+$/, '');
  return LOCKED_SESSION_ALLOWLIST.some((p) => path === p || path.endsWith(p));
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  // Session store. A REVOKED session is rejected here — the single chokepoint every authenticated request passes
  // through.
  //
  // It is @Optional() so the middleware still works with no database (dev/tests). But that creates the exact
  // failure mode this whole audit kept finding: a SECURITY CONTROL THAT SILENTLY DISABLES ITSELF. If the DI
  // token ever stops resolving, revocation would quietly stop working and every test would still pass. So when a
  // database IS configured, a missing store is treated as a misconfiguration and fails LOUDLY at boot rather than
  // degrading into a false sense of security.
  constructor(@Optional() @Inject('SessionStore') private readonly sessions?: SessionStore, @Optional() private readonly crossTenant?: CrossTenantSignal, @Optional() private readonly lockdown?: PlatformLockdownGate, @Optional() @Inject(KyselyApiKeyAuth) private readonly apiKeys?: KyselyApiKeyAuth | null, @Optional() @Inject(KyselyOAuthAccess) private readonly oauth?: KyselyOAuthAccess | null,
              @Optional() @Inject(AUTHORIZATION_STATE) private readonly authz?: AuthorizationStateCache | null,
              @Optional() @Inject(SUPPORT_SESSION_GATE) private readonly supportSessions?: SupportSessionLookup | null) {
    const dbConfigured = !!process.env.DATABASE_URL || process.env.REPO_DRIVER === 'postgres';
    if (dbConfigured && !this.sessions) {
      throw new Error(
        'TenantContextMiddleware: SessionStore did not resolve while a database is configured. ' +
        'Session revocation would be silently disabled — refusing to start. ' +
        "Check that AuthModule provides and exports 'SessionStore' and that AppModule imports AuthModule.",
      );
    }
  }

  async use(req: any, res: any, next: () => void) {
    // Browser CORS preflight requests carry no credentials and need no session context
    if (String(req?.method ?? '').toUpperCase() === 'OPTIONS') return next();
    // Constitution 3 §76–78 (Step 7): a tenant API key is read BEFORE the session path. It authenticates as an
    // INTEGRATION principal whose permissions are exactly the key's (allow-listed) scopes, on salon routes only.
    // Constitution 3 Step 10d: an OAuth access token is the same INTEGRATION principal, its permissions the scopes the
    // salon's owner approved (allow-listed, read-only), salon routes only.
    const oauthToken = readOAuthAccessToken(req?.headers);
    if (oauthToken) {
      const path = String(req.originalUrl ?? req.url ?? '');
      if (!apiKeyRouteAllowed(path)) throw new UnauthorizedException({ code: 'TOKEN_NOT_ALLOWED_HERE', message: 'App tokens work on salon routes only.' });
      const g = this.oauth ? await this.oauth.verify(oauthToken) : null;
      if (!g) throw new UnauthorizedException({ code: 'TOKEN_INVALID', message: 'Invalid, expired or revoked token.' });
      if (this.lockdown) await this.lockdown.assertAllowed('INTEGRATION' as any);
      req.ctx = { tenantId: g.tenantId, branchId: null, userId: g.grantId, role: 'INTEGRATION' as any, permissions: integrationPermissions(g.scopes), actorType: 'INTEGRATION', integrationId: `oauth:${g.clientId}`, oauthGrantId: g.grantId } as any;
      enrichContext({ tenantId: g.tenantId, branchId: null, actorId: g.grantId, actorType: 'integration' as any });
      for (const src of [req.body, req.query]) if (src && typeof src === 'object') { delete src.tenantId; delete src.tenant_id; delete src.branchId; delete src.branch_id; }
      return next();
    }
    const apiKey = readApiKey(req?.headers);
    if (apiKey) {
      const path = String(req.originalUrl ?? req.url ?? '');
      if (!apiKeyRouteAllowed(path)) throw new UnauthorizedException({ code: 'API_KEY_NOT_ALLOWED_HERE', message: 'API keys work on salon routes only.' });
      const k = this.apiKeys ? await this.apiKeys.verify(apiKey) : null;
      if (!k) throw new UnauthorizedException({ code: 'API_KEY_INVALID', message: 'Invalid, expired or revoked API key.' });
      if (this.lockdown) await this.lockdown.assertAllowed('INTEGRATION' as any);
      req.ctx = { tenantId: k.tenantId, branchId: null, userId: k.keyId, role: 'INTEGRATION' as any, permissions: integrationPermissions(k.scopes), actorType: 'INTEGRATION', apiKeyId: k.keyId, integrationId: `apikey:${k.keyId}` } as any;
      enrichContext({ tenantId: k.tenantId, branchId: null, actorId: k.keyId, actorType: 'integration' as any });
      for (const src of [req.body, req.query]) if (src && typeof src === 'object') { delete src.tenantId; delete src.tenant_id; delete src.branchId; delete src.branch_id; }
      void this.apiKeys!.recordUse(k, String(req.method ?? 'GET'), path, String(req.ip ?? '') || null);
      return next();
    }
    // Prefer a session already attached by an upstream layer (kept for tests/integrations); otherwise derive it from
    // the signed aps_session cookie / Bearer token. Empty secret → no token session → falls through to "No session".
    const session = req.session || req.user || sessionFromRequest(req, process.env.AUTH_SESSION_SECRET || "");
    if (!session) throw new UnauthorizedException("No session");
    // Revocation check. `sid` is absent on tokens minted before revocation support — those are accepted as before,
    // so deploying this does not sign anyone out. A revoked session is rejected on its very next request.
    if (this.sessions && (session as any).sid) {
      if (await this.sessions.isRevoked((session as any).sid)) throw new UnauthorizedException("Session revoked");
      // Decision 35: an idle-locked session reaches only the unlock path until a correct PIN; a lock older than
      // SESSION_LOCK_MAX_MS revokes it. Before this the lock lived only in the browser — a second tab skipped the PIN.
      // Oct 12 2026 (Kevin): the store ALSO answers for a POS session nobody used for the salon's auto-lock minutes (default
      // on, 60) — locked from its last activity, whatever the browser did. The 8 hours are counted on the store's clock.
      const lockedAt = this.sessions.lockedAt ? await this.sessions.lockedAt((session as any).sid) : null;
      if (lockedAt) {
        const now = (this.sessions.lockFacts ? (await this.sessions.lockFacts((session as any).sid))?.now : undefined) ?? Date.now();
        if (now - lockedAt > SESSION_LOCK_MAX_MS) {
          await this.sessions.revoke((session as any).sid);
          throw new UnauthorizedException({ code: 'SESSION_LOCK_EXPIRED', message: 'This device was locked too long. Sign in again.' });
        }
        if (!isUnlockPath(String(req.originalUrl ?? req.url ?? ''))) throw new HttpException({ code: 'SESSION_LOCKED', message: 'This device is locked. Enter your PIN.', lockedAt: new Date(lockedAt).toISOString() }, 423);
      }
    }
    // Constitution 12 M13: an active PLATFORM lockdown refuses every non-SUPER_ADMIN request (Super Admins keep access
    // to investigate and lift it). Before this, a platform lockdown was recorded as 'active' and enforced nowhere.
    if (this.lockdown) await this.lockdown.assertAllowed(session.role);
    // Constitution 13 §72: the ONE derivation of a request's context lives in @aipowersalon/tenant-context.
    const derived = contextFromSession<Role>(session);
    // BUILD_PLAN Phase 9 (Constitution 2 §versioning): what this person may do NOW. A session whose authorization versions
    // are stale is re-authorized for THIS request from the current grants (the stale claims are never used) and the
    // response says x-authorization-changed: 1; an inactive / removed / moved account loses every session; overrides
    // (incl. temporary, expiry honoured now) are applied on every request. Skipped with no database (dev / tests); a
    // lookup error fails open on the verified session, like the revocation check above.
    let role: Role = derived.role; let permissions: string[] = derived.permissions; let authz: AuthzContextState | undefined;
    if (this.authz && session.role !== 'CUSTOMER' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(session.userId ?? ''))) {
      const st = await this.authz.get(session.userId, session.tenantId ?? null, { av: (session as any).av, tv: (session as any).tv }).then((x) => ({ x }), () => null);
      if (st) {
        const a = authorizeSession({ userId: session.userId, role: session.role, tenantId: session.tenantId ?? null, branchId: session.branchId ?? null, permissions: derived.permissions, av: (session as any).av, tv: (session as any).tv }, st.x);
        if (!a.ok) {
          if (a.revoke === 'user') await this.authz.revokeUserSessions(session.userId).catch(() => 0);
          if (this.sessions && (session as any).sid) await this.sessions.revoke((session as any).sid).catch(() => undefined);
          throw new UnauthorizedException({ code: 'SESSION_ENDED', reason: a.reason, message: 'Your access changed. Sign in again.' });
        }
        role = a.role as Role; permissions = a.permissions; authz = a.authz;
        if (a.stale && typeof res?.setHeader === 'function') res.setHeader('x-authorization-changed', '1');
      }
    }
    req.ctx = { tenantId: derived.tenantId, branchId: derived.branchId, userId: derived.userId, role, permissions,
      ...(authz ? { authz } : {}),
      ...(derived.restriction ? { restriction: derived.restriction } : {}) } as Ctx;   // Constitution 7 §19: billing-only session
    // BUILD_PLAN Phase 14 (Constitution 12 "Support Mode expires"): a session that carries a support-session grant
    // (claim `ssid`) is admitted only while THAT support session is live, the caller's own and for THIS salon — fail
    // closed. req.ctx.supportSessionId is set only here, from a verified session, never from the client.
    const ssid = (session as any).ssid;
    if (ssid) {
      try {
        const live = await assertLiveSupportSession(this.supportSessions, String(ssid), String(session.userId), String(derived.tenantId ?? ''));
        (req.ctx as any).supportSessionId = live.sessionId;
      } catch (e: any) {
        throw new HttpException({ code: e?.code ?? 'support_session_required', message: e?.message ?? 'Support session required.' }, 403);
      }
    }
    // Constitution 11 §6/§276: from here on, every log line and error in this request carries the tenant and the
    // actor — without any module passing them by hand. Actor id only, never a name or email (§24–25).
    enrichContext({ tenantId: session.tenantId || undefined, branchId: session.branchId || null, actorId: session.userId, actorType: actorTypeOf(session.role), sessionId: derived.sessionId || undefined });
    // Expose the session id for LONG-LIVED connections (SSE). This middleware only runs at connect; an open
    // stream would otherwise keep pushing live tenant data after the session was revoked.
    req.sessionId = derived.sessionId;
    // Strip client-supplied tenant/branch keys so a tenant-scoped principal can never spoof scope downstream.
    // SUPER_ADMIN is the one cross-tenant role: its Overview scope selector legitimately supplies `tenantId`
    // (the route is SuperAdminGuard-protected and super admins are blocked from tenant-operational routes), so the
    // strip is skipped only for that role. Every other role still has these keys removed.
    if (req.ctx.role !== "SUPER_ADMIN") {
      // Constitution 11 §120: before stripping, NOTICE a request that named a tenant other than the caller's own.
      // The strip below still blocks it either way; this only makes it visible (and escalates when repeated).
      const named = namedForeignTenant(session.tenantId, req.body, req.query);
      if (named) this.crossTenant?.observe({ actorId: session.userId, actorType: String(session.role), sessionTenantId: session.tenantId, namedTenantId: named, method: String(req.method), path: String(req.originalUrl ?? req.url ?? '') });
      // POST /auth/select-branch is the ONE place a client legitimately names a branch: the branch-access service checks
      // it against the branches this person may enter. Stripping it there made every mid-session switch silently land
      // on the FIRST enterable branch (found by the Phase 9 live proof) — keep `branchId` on that path only.
      const ownerPath = isOwnerPath(req.originalUrl ?? req.url ?? req.path);
      const wantQ = ownerPath ? branchFilterFrom(req.query) : undefined;
      const wantB = ownerPath ? branchFilterFrom(req.body) : undefined;
      if (req.body && typeof req.body === "object") req.body = isSelectBranchPath(req) ? keepBranchId(req.body) : stripClientTenantKeys(req.body);
      if (req.query && typeof req.query === "object") req.query = stripClientTenantKeys(req.query);
      if (wantQ && req.query && typeof req.query === "object") req.query = { ...req.query, branchId: wantQ };
      if (wantB && req.body && typeof req.body === "object") req.body = { ...req.body, branchId: wantB };
    }
    // Row-level security (DB_TENANT_RLS): every query this request makes runs with ITS tenant as the database session's
    // app.tenant_id. Super Admin works across salons by design: it runs marked '*' (runAcrossTenants), which the policies
    // admit in strict mode too (DB_TENANT_RLS_STRICT=1), where a request with NO tenant ('') sees nothing.
    if (req.ctx.role === "SUPER_ADMIN") runAcrossTenants("Super Admin: the platform plane reads across salons", next);
    else runWithTenant(req.ctx.tenantId, next);
  }
}

function actorTypeOf(role: unknown): ActorType {
  const r = String(role || '');
  if (r === 'SUPER_ADMIN') return 'super_admin';
  if (r === 'CUSTOMER') return 'customer';
  if (r === 'TECHNICIAN') return 'technician';
  return r ? 'user' : 'anonymous';
}
