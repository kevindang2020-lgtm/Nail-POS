import { describe, it, expect, beforeEach } from 'vitest';
import { LockdownService, LockdownError } from './lockdown.service';
import { InMemoryLockdownRepository } from './lockdown.repository';
import { SessionRevokeService } from './session-revoke.service';
import { InMemorySessionRevokeRepository } from './session-revoke.repository';

let repo: InMemoryLockdownRepository; let revokeRepo: InMemorySessionRevokeRepository; let svc: LockdownService;
const actor = { userId: 'admin1', role: 'SUPER_ADMIN', name: 'Admin', ip: '10.0.0.1', sessionId: 'cur' };
beforeEach(() => {
  repo = new InMemoryLockdownRepository();
  revokeRepo = new InMemorySessionRevokeRepository();
  revokeRepo.sessions = [
    { id: 's1', userId: 'u1', tenantId: 't1', role: 'MANAGER', status: 'active' },
    { id: 's2', userId: 'u1', tenantId: 't1', role: 'STAFF', status: 'active' },
    { id: 'cur', userId: 'admin1', tenantId: 't1', role: 'SUPER_ADMIN', status: 'active' },
  ];
  revokeRepo.tokens = [{ id: 'rt1', sessionId: 's1', revoked: false }, { id: 'rt2', sessionId: 's2', revoked: false }];
  svc = new LockdownService(repo, new SessionRevokeService(revokeRepo));
});

describe('LockdownService — deliberate multi-step workflow', () => {
  it('proposes with a validated scope + reason and returns the confirmation phrase', async () => {
    const p = await svc.propose({ scope: 'account', target: 'u1', reason: 'compromised credentials' }, actor);
    expect(p.lockdown.status).toBe('proposed');
    expect(p.confirmationPhrase).toBe('LOCKDOWN ACCOUNT');
  });

  it('REFUSES to lock out the initiator (self-preservation)', async () => {
    await expect(svc.propose({ scope: 'account', target: 'admin1', reason: 'x' }, actor)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('requires BOTH step-up and the exact phrase to confirm; is never one-click', async () => {
    const p = await svc.propose({ scope: 'account', target: 'u1', reason: 'x' }, actor);
    await expect(svc.confirm(p.lockdown.id, 'LOCKDOWN ACCOUNT', false, actor)).rejects.toMatchObject({ code: 'forbidden' }); // no step-up
    await expect(svc.confirm(p.lockdown.id, 'wrong', true, actor)).rejects.toMatchObject({ code: 'forbidden' }); // wrong phrase
    const c = await svc.confirm(p.lockdown.id, 'LOCKDOWN ACCOUNT', true, actor);
    expect(c!.status).toBe('confirmed');
  });

  it('cannot execute before confirmation (no skipping)', async () => {
    const p = await svc.propose({ scope: 'account', target: 'u1', reason: 'x' }, actor);
    await expect(svc.execute(p.lockdown.id, actor)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('executes an account lockdown by revoking the target user sessions, preserving the initiator', async () => {
    const p = await svc.propose({ scope: 'account', target: 'u1', reason: 'x' }, actor);
    await svc.confirm(p.lockdown.id, 'LOCKDOWN ACCOUNT', true, actor);
    const a = await svc.execute(p.lockdown.id, actor);
    expect(a!.status).toBe('active');
    expect(a!.affectedSessions).toBe(2); // s1, s2 revoked
    expect(revokeRepo.sessions.find((s) => s.id === 'cur')!.status).toBe('active'); // initiator preserved
  });

  it('is reversible — an active lockdown can be lifted (with a reason)', async () => {
    const p = await svc.propose({ scope: 'tenant', target: 't1', reason: 'breach' }, actor);
    await svc.confirm(p.lockdown.id, 'LOCKDOWN TENANT', true, actor);
    await svc.execute(p.lockdown.id, actor);
    await expect(svc.lift(p.lockdown.id, '', actor)).rejects.toMatchObject({ code: 'invalid' });
    const lifted = await svc.lift(p.lockdown.id, 'threat contained', actor);
    expect(lifted!.status).toBe('lifted');
  });

  it('can be cancelled before activation but not after; 404 on unknown', async () => {
    const p = await svc.propose({ scope: 'platform', reason: 'active attack' }, actor);
    const cancelled = await svc.cancel(p.lockdown.id, actor);
    expect(cancelled!.status).toBe('cancelled');
    await expect(svc.get('ghost')).rejects.toBeInstanceOf(LockdownError);
  });

  // Constitution 12 M13. This test used to assert a platform lockdown activated with ZERO effect — "platform relies on
  // the auth gate" — and the auth gate never read it. It passed only because nothing checked that claim. Now:
  it('a platform lockdown REVOKES every non-Super-Admin session (keeping the initiator\'s) and invalidates the gate', async () => {
    const calls: Array<{ reason: string; keep: string | null }> = []; let invalidated = 0;
    const s2 = new LockdownService(repo, new SessionRevokeService(revokeRepo), { revokeAllNonSuperAdmin: async (reason, keep) => { calls.push({ reason, keep }); return 42; }, invalidate: () => { invalidated++; } });
    const p = await s2.propose({ scope: 'platform', reason: 'active attack' }, actor);
    await s2.confirm(p.lockdown.id, 'LOCKDOWN PLATFORM', true, actor);
    const a = await s2.execute(p.lockdown.id, actor);
    expect(a!.status).toBe('active'); expect(a!.affectedSessions).toBe(42);
    expect(calls).toHaveLength(1); expect(calls[0].keep).toBe((actor as any).sessionId ?? null);
    expect(invalidated).toBe(1);
  });
  it('WITHOUT enforcement wired, a platform lockdown REFUSES to activate — it never reports a lock that locks nothing', async () => {
    const p = await svc.propose({ scope: 'platform', reason: 'active attack' }, actor);
    await svc.confirm(p.lockdown.id, 'LOCKDOWN PLATFORM', true, actor);
    await expect(svc.execute(p.lockdown.id, actor)).rejects.toThrow(/not wired.*refusing/);
  });
});
