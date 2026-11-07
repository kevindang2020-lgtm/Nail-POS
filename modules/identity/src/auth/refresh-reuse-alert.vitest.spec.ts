// refresh-reuse-alert.vitest.spec — Security Deep Scan C13: a reused refresh token (a replay or a stolen token) burns the
// session; the event now names the account and the session, and it is a HIGH security event. On the old code the
// REFRESH_REUSE_DETECTED event carried neither id and nothing reached the Security Center.
import { describe, it, expect } from 'vitest';
import { AuthController } from './auth.controller';
import { RefreshSessionService, InMemoryRefreshRepository } from './refresh-session';
import { InMemoryAuthEvents } from './auth-events';
// merged Nov 7 2026: these pin the STRICT reuse rule (any reuse burns the family) — no grace window here
process.env.REFRESH_REUSE_GRACE_SECONDS = '0';

describe('C13 — refresh-token reuse is attributed and alerted', () => {
  it('records userId + sessionId on the auth event and a HIGH security event', async () => {
    const prev = process.env.AUTH_SESSION_SECRET; process.env.AUTH_SESSION_SECRET = 'c13-secret-value-at-least-32-chars!!';
    try {
      const revoked = new Set<string>();
      const refresh = new RefreshSessionService(new InMemoryRefreshRepository(), { async revoke(id) { revoked.add(id); }, async isRevoked(id) { return revoked.has(id); } });
      const SID = 'ae000000-0000-4000-8000-0000000000c1', UID = 'ae000000-0000-4000-8000-0000000000c2';
      const { refreshToken } = await refresh.issue(SID, UID, 3600);
      await refresh.rotate(refreshToken);                                   // the legitimate rotation
      const authEvents = new InMemoryAuthEvents();
      const security: any[] = [];
      const securityEvents: any = { async record(e: any) { security.push(e); return true; } };
      const c = new AuthController({} as any, {} as any, undefined, undefined, undefined, refresh, undefined, authEvents as any, undefined, undefined, undefined, undefined, securityEvents);
      let status = 0; let body: any = null;
      const res: any = { status(s: number) { status = s; return this; }, json(b: any) { body = b; return this; } };
      await c.doRefresh({ headers: { 'user-agent': 'ua' }, ip: '203.0.113.5' }, { refreshToken }, res);   // the OLD token again
      await new Promise((r) => setImmediate(r));
      expect(status).toBe(401);
      expect(body.code).toBe('TOKEN_REUSE_DETECTED');
      expect(revoked.has(SID)).toBe(true);
      expect(authEvents.events.find((e) => e.type === 'REFRESH_REUSE_DETECTED')).toMatchObject({ userId: UID, sessionId: SID });
      expect(security).toHaveLength(1);
      expect(security[0]).toMatchObject({ severity: 'HIGH', actorId: UID, resourceType: 'session', resourceId: SID });
    } finally { if (prev === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = prev; }
  });

  it('M6-6 §49 / §69: the reuse is also an AUDIT row naming the burned family', async () => {
    const prev = process.env.AUTH_SESSION_SECRET; process.env.AUTH_SESSION_SECRET = 'c13-secret-value-at-least-32-chars!!';
    try {
      const refresh = new RefreshSessionService(new InMemoryRefreshRepository(), { async revoke() {}, async isRevoked() { return false; } });
      const { refreshToken, familyId } = await refresh.issue('ae000000-0000-4000-8000-0000000000d1', 'ae000000-0000-4000-8000-0000000000d2', 3600);
      await refresh.rotate(refreshToken);
      const audited: any[] = []; const platform: any[] = [];
      const audit: any = { async record(ctx: any, input: any) { audited.push({ ctx, input }); }, async recordPlatform(i: any) { platform.push(i); } };
      const c = new AuthController({} as any, {} as any, undefined, undefined, undefined, refresh, undefined, undefined, undefined, undefined, audit, undefined, { async record() { return true; } } as any);
      let body: any = null; const res: any = { status() { return this; }, json(b: any) { body = b; return this; } };
      await c.doRefresh({ headers: {} }, { refreshToken }, res);
      await new Promise((r) => setImmediate(r));
      expect(body.code).toBe('TOKEN_REUSE_DETECTED');
      // no database → the session's salon is unknown → a platform-level audit row (never silently dropped)
      expect(platform).toHaveLength(1);
      expect(platform[0]).toMatchObject({ action: 'token_reuse_detected', resourceType: 'session', metadata: { familyId } });
    } finally { if (prev === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = prev; }
  });
  it('M6-6 §61: refresh from a revoked payment phone answers DEVICE_REVOKED (401); suspended answers DEVICE_SUSPENDED (403)', async () => {
    const prev = process.env.AUTH_SESSION_SECRET; process.env.AUTH_SESSION_SECRET = 'c13-secret-value-at-least-32-chars!!';
    try {
      for (const [block, status, code] of [[{ code: 'DEVICE_REVOKED', endSession: true }, 401, 'DEVICE_REVOKED'], [{ code: 'DEVICE_SUSPENDED', endSession: false }, 403, 'DEVICE_SUSPENDED']] as const) {
        const repo = new InMemoryRefreshRepository(); repo.sessionDevices.set('sidX', { tenantId: 't1', deviceId: 'dev-1' });
        const refresh = new RefreshSessionService(repo, { async revoke() {}, async isRevoked() { return false; } }, undefined, () => ({ refreshBlock: async () => block }));
        const { refreshToken } = await refresh.issue('sidX', 'u1', 3600);
        const c = new AuthController({} as any, {} as any, undefined, undefined, undefined, refresh);
        let st = 0; let body: any = null; const res: any = { status(x: number) { st = x; return this; }, json(b: any) { body = b; return this; } };
        await c.doRefresh({ headers: {} }, { refreshToken }, res);
        expect(st).toBe(status); expect(body.code).toBe(code);
      }
    } finally { if (prev === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = prev; }
  });
});
