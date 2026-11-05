import { describe, it, expect, beforeEach } from 'vitest';
import { SessionRevokeService, RevokeError } from './session-revoke.service';
import { InMemorySessionRevokeRepository } from './session-revoke.repository';

let repo: InMemorySessionRevokeRepository; let svc: SessionRevokeService;
const actor = { userId: 'admin1', role: 'SUPER_ADMIN', name: 'Admin', ip: '10.0.0.1' };
beforeEach(() => {
  repo = new InMemorySessionRevokeRepository();
  repo.sessions = [
    { id: 's1', userId: 'u1', tenantId: 't1', role: 'MANAGER', status: 'active' },
    { id: 's2', userId: 'u1', tenantId: 't1', role: 'MANAGER', status: 'active' },
    { id: 's3', userId: 'u2', tenantId: 't1', role: 'STAFF', status: 'revoked' },
    { id: 'cur', userId: 'admin1', tenantId: 't1', role: 'SUPER_ADMIN', status: 'active' },
  ];
  repo.tokens = [{ id: 'rt1', sessionId: 's1', revoked: false }, { id: 'rt2', sessionId: 's2', revoked: false }, { id: 'rt3', sessionId: 's3', revoked: true }];
  svc = new SessionRevokeService(repo);
});

describe('SessionRevokeService', () => {
  it('revokes a single session AND its refresh token (closes the legacy gap)', async () => {
    const r = await svc.revoke({ scope: 'session', target: 's1' }, actor);
    expect(r.revokedSessions).toBe(1);
    expect(r.revokedRefreshTokens).toBe(1);
    expect(repo.sessions.find((s) => s.id === 's1')!.status).toBe('revoked');
    expect(repo.tokens.find((t) => t.id === 'rt1')!.revoked).toBe(true);
  });

  it('revokes all sessions for a user + their tokens; requires a reason for broad scope', async () => {
    await expect(svc.revoke({ scope: 'user', target: 'u1' }, actor)).rejects.toBeInstanceOf(RevokeError);
    const r = await svc.revoke({ scope: 'user', target: 'u1', reason: 'compromised' }, actor);
    expect(r.revokedSessions).toBe(2);
    expect(r.revokedRefreshTokens).toBe(2);
  });

  it('is idempotent — already-revoked sessions are skipped, not double-counted', async () => {
    const r = await svc.revoke({ scope: 'user', target: 'u2', reason: 'x' }, actor);
    expect(r.revokedSessions).toBe(0); // s3 already revoked
    expect(r.revokedRefreshTokens).toBe(0);
  });

  it('never locks out the acting admin: current session preserved unless includeCurrent', async () => {
    const r = await svc.revoke({ scope: 'tenant', target: 't1', reason: 'breach', currentSessionId: 'cur' }, actor);
    expect(repo.sessions.find((s) => s.id === 'cur')!.status).toBe('active'); // preserved
    expect(r.revokedSessions).toBe(2); // s1,s2 (s3 already revoked, cur protected)
    expect(r.protectedSession).toBe(true);
  });

  it('preview reports impact without mutating anything', async () => {
    const p = await svc.preview({ scope: 'user', target: 'u1', reason: 'x' });
    expect(p.sessionsToRevoke).toBe(2);
    expect(p.refreshTokensToRevoke).toBe(2);
    expect(repo.sessions.find((s) => s.id === 's1')!.status).toBe('active'); // unchanged
  });

  it('writes a security audit event with counts + scope (no tokens)', async () => {
    await svc.revoke({ scope: 'session', target: 's1' }, actor);
    expect(repo.audits[0]).toMatchObject({ module: 'security', action: 'session_revoked', scope: 'session', revokedSessions: 1 });
  });

  it('rejects an unknown scope', async () => {
    await expect(svc.revoke({ scope: 'galaxy', target: 'x', reason: 'r' }, actor)).rejects.toMatchObject({ code: 'invalid' });
  });
});
