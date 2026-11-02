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
    const fam = repo.rows[0].familyId;
    expect(await svc.rotate(refreshToken)).toEqual({ ok: false, reason: 'reused', sessionId: 'sid1', userId: 'u1', familyId: fam });   // the OLD token again — C13: naming the burned session, its account and (M6-6) the family
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

// Secure Tap to Pay M6-6 (§2 / §14 / §16 / §61 / §69): a named refresh family, and a session opened on a payment phone is
// extended only while the phone is in good standing (REFRESH_DEVICE_GUARD, answered by the payment module).
describe('M6-6 — refresh family + payment-device binding', () => {
  const withGuard = (answer: (q: any) => Promise<any>) => {
    const repo = new InMemoryRefreshRepository(); const s = sessions(); const asked: any[] = [];
    const svc = new RefreshSessionService(repo, s.store, () => 1_000_000, () => ({ refreshBlock: async (q) => { asked.push(q); return answer(q); } }));
    return { repo, s, svc, asked };
  };
  it('login issues a family root; every rotation inherits it; two logins are two families', async () => {
    const { repo, svc } = mk();
    const a = await svc.issue('sid1', 'u1', 3600); const b = await svc.issue('sid2', 'u1', 3600);
    expect(a.familyId).not.toBe(b.familyId);
    const r1: any = await svc.rotate(a.refreshToken); await svc.rotate(r1.refreshToken);
    expect(repo.rows.filter((r) => r.sessionId === 'sid1').map((r) => r.familyId)).toEqual([a.familyId, a.familyId, a.familyId]);
  });
  it('§69: reuse of a rotated token revokes the WHOLE family (every generation) and names it', async () => {
    const { repo, svc } = mk();
    const a = await svc.issue('sid1', 'u1', 3600); const other = await svc.issue('sid2', 'u1', 3600);
    const r1: any = await svc.rotate(a.refreshToken); const r2: any = await svc.rotate(r1.refreshToken);
    const reuse: any = await svc.rotate(r1.refreshToken);
    expect(reuse).toMatchObject({ ok: false, reason: 'reused', familyId: a.familyId });
    expect(repo.rows.filter((r) => r.familyId === a.familyId).every((r) => r.revokedAt)).toBe(true);
    expect(await svc.rotate(r2.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    expect((await svc.rotate(other.refreshToken)).ok).toBe(true);   // another sign-in's family is untouched
  });
  it('a session NOT opened on a device is never asked about', async () => {
    const { svc, asked } = withGuard(async () => ({ code: 'DEVICE_REVOKED', endSession: true }));
    const a = await svc.issue('sid1', 'u1', 3600);
    expect((await svc.rotate(a.refreshToken)).ok).toBe(true);
    expect(asked).toHaveLength(0);
  });
  it('§16 / §61: a revoked payment phone — refresh refused, session and family END', async () => {
    const { repo, s, svc, asked } = withGuard(async () => ({ code: 'DEVICE_REVOKED', endSession: true }));
    repo.sessionDevices.set('sid1', { tenantId: 't1', deviceId: 'dev-1' });
    const a = await svc.issue('sid1', 'u1', 3600);
    expect(await svc.rotate(a.refreshToken)).toEqual({ ok: false, reason: 'device_revoked', sessionId: 'sid1', userId: 'u1', tenantId: 't1', deviceId: 'dev-1' });
    expect(asked[0]).toEqual({ tenantId: 't1', userId: 'u1', deviceId: 'dev-1', sessionId: 'sid1' });
    expect(s.revoked.has('sid1')).toBe(true);
    expect(repo.rows.every((r) => r.revokedAt)).toBe(true);
  });
  it('a SUSPENDED phone — this refresh refused, the session kept (the owner can re-activate)', async () => {
    let block: any = { code: 'DEVICE_SUSPENDED', endSession: false };
    const { repo, s, svc } = withGuard(async () => block);
    repo.sessionDevices.set('sid1', { tenantId: 't1', deviceId: 'dev-1' });
    const a = await svc.issue('sid1', 'u1', 3600);
    expect(await svc.rotate(a.refreshToken)).toMatchObject({ ok: false, reason: 'device_suspended' });
    expect(s.revoked.has('sid1')).toBe(false); expect(repo.rows[0].revokedAt).toBeNull(); expect(repo.rows[0].supersededById).toBeNull();
    block = null;   // re-activated
    expect((await svc.rotate(a.refreshToken)).ok).toBe(true);
  });
  it('a device registry that cannot answer fails the refresh CLOSED (no new token, nothing burned)', async () => {
    const { repo, s, svc } = withGuard(async () => { throw new Error('db down'); });
    repo.sessionDevices.set('sid1', { tenantId: 't1', deviceId: 'dev-1' });
    const a = await svc.issue('sid1', 'u1', 3600);
    expect(await svc.rotate(a.refreshToken)).toMatchObject({ ok: false, reason: 'device_check_failed' });
    expect(repo.rows).toHaveLength(1); expect(s.revoked.size).toBe(0);
  });
  it('an active phone rotates normally', async () => {
    const { repo, svc } = withGuard(async () => null);
    repo.sessionDevices.set('sid1', { tenantId: 't1', deviceId: 'dev-1' });
    const a = await svc.issue('sid1', 'u1', 3600);
    expect((await svc.rotate(a.refreshToken)).ok).toBe(true);
  });
});
