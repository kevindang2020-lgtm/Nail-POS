import { describe, it, expect, beforeEach } from 'vitest';
import { GrantService, GrantError } from './grant.service';
import { InMemoryGrantRepository } from './grant.repository';

let repo: InMemoryGrantRepository; let svc: GrantService;
const requester = { userId: 'req1', role: 'SUPER_ADMIN', name: 'Requester', ip: '10.0.0.1' };
const approver = { userId: 'appr1', role: 'SUPER_ADMIN', name: 'Approver', ip: '10.0.0.2' };
const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
beforeEach(() => { repo = new InMemoryGrantRepository(); svc = new GrantService(repo); });

describe('GrantService — time-boxed privileged access', () => {
  it('requests a valid time-boxed grant (pending) with normalized privilege', async () => {
    const g = await svc.request({ userId: 'u1', privilege: 'Security Admin', scope: 'platform', reason: 'incident response', expiresAt: inDays(7) }, requester);
    expect(g.status).toBe('pending'); expect(g.privilege).toBe('security_admin'); expect(g.grantRef).toMatch(/^PAG-\d{4}-\d{3}$/);
  });

  it('rejects a grant with no expiry (must be time-boxed) or an over-window expiry', async () => {
    await expect(svc.request({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: null as any }, requester)).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.request({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: inDays(200) }, requester)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('ENFORCES separation of duties — the requester cannot approve their own grant', async () => {
    const g = await svc.request({ userId: 'u1', privilege: 'owner', scope: 'tenant', target: 't1', reason: 'x', expiresAt: inDays(5) }, requester);
    await expect(svc.approve(g.id, requester)).rejects.toMatchObject({ code: 'forbidden' });
    const a = await svc.approve(g.id, approver);
    expect(a!.status).toBe('active'); expect(a!.approvedBy).toBe('appr1'); expect(a!.grantedAt).toBeTruthy();
  });

  it('marks an active grant currently-elevated only within its window', async () => {
    const g = await svc.request({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: inDays(5) }, requester);
    await svc.approve(g.id, approver);
    const got = await svc.get(g.id);
    expect(got.currentlyElevated).toBe(true);
  });

  it('the expire sweep expires past-window active grants (idempotent)', async () => {
    const g = await svc.request({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: inDays(5) }, requester);
    await svc.approve(g.id, approver);
    // force the window into the past
    repo.rows.find((r) => r.id === g.id)!.expiresAt = inDays(-1);
    const first = await svc.expireSweep(approver); expect(first.expired).toBe(1);
    const second = await svc.expireSweep(approver); expect(second.expired).toBe(0); // idempotent
    expect((await svc.get(g.id)).status).toBe('expired');
  });

  it('revokes an active grant (reason required) and 404s unknown', async () => {
    const g = await svc.request({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: inDays(5) }, requester);
    await svc.approve(g.id, approver);
    await expect(svc.revoke(g.id, '', approver)).rejects.toMatchObject({ code: 'invalid' });
    const r = await svc.revoke(g.id, 'no longer needed', approver);
    expect(r!.status).toBe('revoked'); expect(r!.revokedAt).toBeTruthy();
    await expect(svc.get('ghost')).rejects.toBeInstanceOf(GrantError);
  });

  it('cannot approve an already-revoked grant (no invalid transition)', async () => {
    const g = await svc.request({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: inDays(5) }, requester);
    await svc.approve(g.id, approver);
    await svc.revoke(g.id, 'done', approver);
    await expect(svc.approve(g.id, approver)).rejects.toMatchObject({ code: 'conflict' });
  });
});
