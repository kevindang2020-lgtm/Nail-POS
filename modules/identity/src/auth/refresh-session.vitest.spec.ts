// refresh-session.vitest.spec.ts — Constitution 3 §7–12 / §170 (Step 2): rotation, replay detection, family burn,
// expiry, revoked sessions. In-memory here; the same on real Postgres in refresh-session.postgres.vitest.spec.ts.
import { describe, it, expect } from 'vitest';
import { RefreshSessionService, InMemoryRefreshRepository, hashRefreshToken } from './refresh-session';
import { accessTtlSeconds } from './auth.http';

const sessions = () => { const revoked = new Set<string>(); return { revoked, store: { revoke: async (id: string) => { revoked.add(id); }, isRevoked: async (id: string) => revoked.has(id) } }; };
const mk = (nowMs = 1_000_000) => { const repo = new InMemoryRefreshRepository(); const s = sessions(); let t = nowMs; const svc = new RefreshSessionService(repo, s.store, () => t); return { repo, s, svc, tick: (ms: number) => { t += ms; } }; };

describe('refresh rotation', () => {
  it('issues an opaque token, stores only its hash, and rotates it: the old one is superseded, the new one works', async () => {
    const { repo, svc } = mk();
    const { refreshToken } = await svc.issue('sid1', 'u1', 3600);
    expect(refreshToken.startsWith('rt_')).toBe(true);
    expect(repo.rows[0].tokenHash).toBe(hashRefreshToken(refreshToken)); expect(JSON.stringify(repo.rows)).not.toContain(refreshToken);
    const r1 = await svc.rotate(refreshToken);
    expect(r1).toMatchObject({ ok: true, sessionId: 'sid1', userId: 'u1' });
    expect(repo.rows[0].supersededById).toBe(repo.rows[1].id);
    const r2 = await svc.rotate((r1 as any).refreshToken);
    expect(r2.ok).toBe(true);
  });
  it('§170: presenting an already-rotated token burns the family — every token revoked and the session too', async () => {
    const { repo, s, svc } = mk();
    const { refreshToken } = await svc.issue('sid1', 'u1', 3600);
    const r1 = await svc.rotate(refreshToken);
    expect(await svc.rotate(refreshToken)).toEqual({ ok: false, reason: 'reused' });   // the OLD token again
    expect(s.revoked.has('sid1')).toBe(true);
    expect(repo.rows.every((r) => r.revokedAt)).toBe(true);
    expect(await svc.rotate((r1 as any).refreshToken)).toEqual({ ok: false, reason: 'invalid' });   // the current one died with the family
  });
  it('an expired token, an unknown token and a revoked session are refused; expiry is the session life', async () => {
    const { s, svc, tick } = mk();
    const { refreshToken } = await svc.issue('sid1', 'u1', 60);
    expect(await svc.rotate('rt_nope_nope_nope_nope_nope')).toEqual({ ok: false, reason: 'invalid' });
    expect(await svc.rotate('')).toEqual({ ok: false, reason: 'invalid' });
    s.revoked.add('sid1');
    expect(await svc.rotate(refreshToken)).toEqual({ ok: false, reason: 'session_revoked' });
    s.revoked.delete('sid1'); tick(61_000);
    expect(await svc.rotate(refreshToken)).toEqual({ ok: false, reason: 'expired' });
  });
  it('AUTH_ACCESS_TTL: default 15 minutes; out-of-range or missing values fall back, never to "no expiry"', () => {
    expect(accessTtlSeconds({})).toBe(900);
    expect(accessTtlSeconds({ AUTH_ACCESS_TTL: '300' })).toBe(300);
    expect(accessTtlSeconds({ AUTH_ACCESS_TTL: 'forever' })).toBe(900);
    expect(accessTtlSeconds({ AUTH_ACCESS_TTL: '5' })).toBe(900);
    expect(accessTtlSeconds({ AUTH_ACCESS_TTL: String(60 * 60 * 24 * 30) })).toBe(900);
  });
});
