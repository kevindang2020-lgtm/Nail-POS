// refresh-session.vitest.spec.ts — Constitution 3 §7–12 / §170 (Step 2): rotation, replay detection, family burn,
// expiry, revoked sessions. In-memory here; the same on real Postgres in refresh-session.postgres.vitest.spec.ts.
import { describe, it, expect } from 'vitest';
import { RefreshSessionService, InMemoryRefreshRepository, hashRefreshToken, refreshReuseGraceMs } from './refresh-session';
import { accessTtlSeconds } from './auth.http';

const sessions = () => { const revoked = new Set<string>(); return { revoked, store: { revoke: async (id: string) => { revoked.add(id); }, isRevoked: async (id: string) => revoked.has(id) } }; };
const mk = (nowMs = 1_000_000, graceMs = 30_000) => { const s = sessions(); let t = nowMs; const repo = new InMemoryRefreshRepository(() => t); const svc = new RefreshSessionService(repo, s.store, () => t, graceMs); return { repo, s, svc, tick: (ms: number) => { t += ms; } }; };

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
    const { repo, s, svc, tick } = mk();
    const { refreshToken } = await svc.issue('sid1', 'u1', 3600);
    const r1 = await svc.rotate(refreshToken);
    tick(31_000);   // past the 30 s grace window (Nov 6 2026): no longer "the same device racing itself"
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

// Nov 6 2026 — busy-day sign-outs: two POS tabs share one cookie and renew at the same moment, and a reply lost on salon
// Wi-Fi leaves the device holding the old token. Within the grace window that is the same device racing itself.
describe('refresh reuse grace window', () => {
  it('two tabs renewing at once: the second gets a fresh token, the session lives, and the fresh token works', async () => {
    const { s, svc, tick } = mk();
    const { refreshToken } = await svc.issue('sid1', 'u1', 3600);
    const tabA = await svc.rotate(refreshToken);
    tick(2_000);
    const tabB = await svc.rotate(refreshToken);   // tab B sent the cookie it had
    expect(tabB).toMatchObject({ ok: true, sessionId: 'sid1', userId: 'u1' });
    expect((tabB as any).refreshToken).not.toBe((tabA as any).refreshToken);
    expect(s.revoked.has('sid1')).toBe(false);
    // whichever reply the browser keeps last, the cookie renews later — even long after the grace window
    tick(15 * 60_000);
    expect((await svc.rotate((tabB as any).refreshToken)).ok).toBe(true);
    expect((await svc.rotate((tabA as any).refreshToken)).ok).toBe(true);
  });
  it('a lost reply: the device retries with its old token a moment later and stays signed in', async () => {
    const { svc, tick } = mk();
    const { refreshToken } = await svc.issue('sid1', 'u1', 3600);
    await svc.rotate(refreshToken);   // the server rotated; the reply never arrived
    tick(10_000);
    expect((await svc.rotate(refreshToken)).ok).toBe(true);
  });
  it('outside the window it is still theft; grace 0 restores the strict rule; an expired session gets no grace', async () => {
    const late = mk();
    const t1 = (await late.svc.issue('sid1', 'u1', 3600)).refreshToken;
    await late.svc.rotate(t1); late.tick(30_001);
    expect(await late.svc.rotate(t1)).toEqual({ ok: false, reason: 'reused' });
    expect(late.s.revoked.has('sid1')).toBe(true);
    const strict = mk(1_000_000, 0);
    const t2 = (await strict.svc.issue('sid2', 'u1', 3600)).refreshToken;
    await strict.svc.rotate(t2);
    expect(await strict.svc.rotate(t2)).toEqual({ ok: false, reason: 'reused' });
    const revoked = mk();
    const t3 = (await revoked.svc.issue('sid3', 'u1', 3600)).refreshToken;
    await revoked.svc.rotate(t3); revoked.s.revoked.add('sid3');
    expect(await revoked.svc.rotate(t3)).toEqual({ ok: false, reason: 'reused' });
  });
  it('REFRESH_REUSE_GRACE_SECONDS: default 30 s, 0 turns it off, capped at 120 s, junk falls back', () => {
    expect(refreshReuseGraceMs({})).toBe(30_000);
    expect(refreshReuseGraceMs({ REFRESH_REUSE_GRACE_SECONDS: '0' })).toBe(0);
    expect(refreshReuseGraceMs({ REFRESH_REUSE_GRACE_SECONDS: '600' })).toBe(120_000);
    expect(refreshReuseGraceMs({ REFRESH_REUSE_GRACE_SECONDS: 'soon' })).toBe(30_000);
  });
});
