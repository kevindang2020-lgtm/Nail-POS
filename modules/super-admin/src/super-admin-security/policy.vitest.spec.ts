import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyService, PolicyError } from './policy.service';
import { InMemoryPolicyRepository } from './policy.repository';

let repo: InMemoryPolicyRepository; let svc: PolicyService;
const actor = { userId: 'admin1', role: 'SUPER_ADMIN', name: 'Admin', ip: '10.0.0.1' };
beforeEach(() => { repo = new InMemoryPolicyRepository(); svc = new PolicyService(repo); });

describe('PolicyService', () => {
  it('reports no active policy honestly before configuration', async () => {
    const p = await svc.get('password');
    expect(p.available).toBe(false);
  });

  it('saves a compliant password policy (versioned + audited) and reflects compliance', async () => {
    const r = await svc.update('password', { minLength: 14, maxLength: 64, compromisedCheck: true, commonRejection: true, lockoutThreshold: 5, historyCount: 5 }, actor);
    expect(r.version).toBe(1); expect(r.compliant).toBe(true);
    const p = await svc.get('password'); expect(p.available && p.compliant).toBe(true);
    expect(repo.audits[0]).toMatchObject({ action: 'password_policy_changed', compliant: true });
  });

  it('flags a weak policy as Review (non-compliant) with reasons but still saves it', async () => {
    const r = await svc.update('password', { minLength: 8, maxLength: 64, compromisedCheck: false, lockoutThreshold: 20 }, actor);
    expect(r.compliant).toBe(false);
    expect(r.complianceFailing.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects an invalid policy (bad numbers) without saving', async () => {
    await expect(svc.update('password', { minLength: 4 }, actor)).rejects.toBeInstanceOf(PolicyError);
    await expect(svc.update('session', { idleMinutes: 0, absoluteHours: 8, refreshDays: 7, privilegedIdleMinutes: 10 }, actor)).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.rows).toHaveLength(0);
  });

  it('versions each update and archives the prior active version', async () => {
    await svc.update('session', { idleMinutes: 30, absoluteHours: 12, refreshDays: 7, privilegedIdleMinutes: 15, concurrentLimit: 3, reauthForSensitive: true }, actor);
    const r2 = await svc.update('session', { idleMinutes: 15, absoluteHours: 8, refreshDays: 7, privilegedIdleMinutes: 10, concurrentLimit: 3, reauthForSensitive: true }, actor);
    expect(r2.version).toBe(2);
    expect(repo.rows.filter((x) => x.kind === 'session' && x.status === 'active')).toHaveLength(1);
    expect(repo.rows.filter((x) => x.kind === 'session' && x.status === 'archived')).toHaveLength(1);
  });

  it('mfa policy compliance requires privileged roles', async () => {
    const weak = await svc.update('mfa', { requiredRoles: ['STAFF'], methods: ['sms'], graceDays: 7 }, actor);
    expect(weak.compliant).toBe(false);
    const strong = await svc.update('mfa', { requiredRoles: ['SUPER_ADMIN', 'OWNER'], methods: ['authenticator', 'passkey'], graceDays: 7 }, actor);
    expect(strong.compliant).toBe(true);
    expect(await repo.activeCompliance()).toMatchObject({ mfa: true });
  });
});
