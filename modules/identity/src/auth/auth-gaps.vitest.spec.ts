// auth-gaps.vitest.spec.ts — regression tests for two real gaps found while auditing the login build against
// the spec:
//   1. §6 "Branch is active" was NEVER checked. A session could be issued scoped to a suspended/closed branch.
//   2. §6/§11 "Audit event is created" — nothing wrote to `login_attempts`, even though the Super Admin Security
//      dashboard READS it (failed logins today / 7-day trend / per-user counts). Those metrics were always zero.
import { describe, it, expect, beforeEach } from 'vitest';
import { decideLogin, type LoginFacts } from './auth-flow';
import { LoginService } from './auth-login.service';
import { InMemoryLoginAttemptSink } from './login-attempt-sink';
import { InMemoryAuthUserRepository } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';

const base: LoginFacts = {
  tenantFound: true, tenantStatus: 'active', userFound: true, passwordValid: true, userStatus: 'active',
  subscriptionStatus: 'active', mfaRequired: false, mfaSatisfied: true, branchCount: 1,
};

describe('§6 branch-active enforcement (was missing)', () => {
  it('refuses to sign in when the assigned branch is NOT active', () => {
    const d = decideLogin({ ...base, assignedBranchActive: false });
    expect(d.outcome).toBe('BRANCH_INACTIVE');
    expect(d.message).toMatch(/not currently active/i);
    // safe message: never names another tenant or reveals internals
    expect(d.message).not.toMatch(/tenant|branch id|uuid/i);
  });

  it('signs in normally when the assigned branch IS active', () => {
    expect(decideLogin({ ...base, assignedBranchActive: true }).outcome).toBe('SUCCESS');
  });

  it('a user with no assigned branch is unaffected (undefined ≠ inactive)', () => {
    expect(decideLogin({ ...base, assignedBranchActive: undefined }).outcome).toBe('SUCCESS');
  });

  it('an inactive branch does not bypass the earlier tenant/user checks', () => {
    expect(decideLogin({ ...base, tenantStatus: 'suspended', assignedBranchActive: false }).outcome).toBe('TENANT_SUSPENDED');
    expect(decideLogin({ ...base, passwordValid: false, assignedBranchActive: false }).outcome).toBe('INVALID_CREDENTIALS');
  });

  it('multi-branch selection still takes precedence', () => {
    expect(decideLogin({ ...base, branchCount: 3, assignedBranchActive: false }).outcome).toBe('BRANCH_SELECTION_REQUIRED');
  });
});

describe('§6/§11 login attempts are audited (table was never written)', () => {
  let sink: InMemoryLoginAttemptSink;
  let svc: LoginService;
  const TENANT = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    const hash = await hashPassword('correct-horse');
    const repo = new InMemoryAuthUserRepository({
      tenants: [{ id: TENANT, tenantCode: 'MERCH01', status: 'active' }],
      users: [{
        userId: 'u1', tenantId: TENANT, role: 'RECEPTIONIST', branchId: null, status: 'active',
        passwordHash: hash, mfaEnabled: false, fullName: null, email: 'staff@salon.com', normalizedPhone: null,
      } as any],
      subscriptions: [{ tenantId: TENANT, status: 'active' }],
      branches: [{ tenantId: TENANT }],
    } as any);
    sink = new InMemoryLoginAttemptSink();
    svc = new LoginService(repo, undefined, sink);
  });

  it('records a SUCCESSFUL sign-in', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'MERCH01', identifier: 'staff@salon.com', password: 'correct-horse', ip: '1.2.3.4' });
    expect(r.outcome).toBe('SUCCESS');
    expect(sink.attempts).toHaveLength(1);
    expect(sink.attempts[0]).toMatchObject({ success: true, reason: 'SUCCESS', tenantId: TENANT, ip: '1.2.3.4' });
  });

  it('records a FAILED sign-in — this is what the Security dashboard counts', async () => {
    await svc.attempt({ portal: 'tenant', salonCode: 'MERCH01', identifier: 'staff@salon.com', password: 'wrong', ip: '9.9.9.9' });
    expect(sink.attempts).toHaveLength(1);
    expect(sink.attempts[0]).toMatchObject({ success: false, reason: 'INVALID_CREDENTIALS' });
  });

  it('NEVER records the password', async () => {
    await svc.attempt({ portal: 'tenant', salonCode: 'MERCH01', identifier: 'staff@salon.com', password: 'sup3rsecret', ip: null as any });
    expect(JSON.stringify(sink.attempts)).not.toContain('sup3rsecret');
  });

  it('an unknown store code records NO tenant — the log cannot be used to enumerate tenants', async () => {
    await svc.attempt({ portal: 'tenant', salonCode: 'NOPE', identifier: 'staff@salon.com', password: 'x' });
    expect(sink.attempts).toHaveLength(1);
    expect(sink.attempts[0].tenantId).toBeNull();
    expect(sink.attempts[0].success).toBe(false);
  });

  it('auditing never breaks a sign-in when the sink throws', async () => {
    const brokenRepoSvc = new LoginService(
      (svc as any).repo,
      undefined,
      { async record() { throw new Error('audit db down'); } },
    );
    const r = await brokenRepoSvc.attempt({ portal: 'tenant', salonCode: 'MERCH01', identifier: 'staff@salon.com', password: 'correct-horse' });
    expect(r.outcome).toBe('SUCCESS');   // login still succeeds
  });

});

describe('phone works as the login identifier (phone = username)', () => {
  const TENANT2 = '22222222-2222-2222-2222-222222222222';
  let svc2: LoginService;
  let sink2: InMemoryLoginAttemptSink;

  beforeEach(async () => {
    const hash = await hashPassword('correct-horse');
    const repo = new InMemoryAuthUserRepository({
      tenants: [{ id: TENANT2, tenantCode: 'MERCH01', status: 'active' }],
      users: [{
        userId: 'u2', tenantId: TENANT2, role: 'RECEPTIONIST', branchId: null, status: 'active',
        passwordHash: hash, mfaEnabled: false, fullName: null,
        email: null, normalizedPhone: '+18565551234',      // phone-only staff account — no email at all
      } as any],
      subscriptions: [{ tenantId: TENANT2, status: 'active' }],
      branches: [{ tenantId: TENANT2 }],
    } as any);
    sink2 = new InMemoryLoginAttemptSink();
    svc2 = new LoginService(repo, undefined, sink2);
  });

  // Every format a receptionist might realistically type must reach the same account.
  for (const typed of ['(856) 555-1234', '856-555-1234', '8565551234', '+1 856 555 1234', '856.555.1234']) {
    it(`signs in with "${typed}"`, async () => {
      const r = await svc2.attempt({ portal: 'tenant', salonCode: 'MERCH01', identifier: typed, password: 'correct-horse' });
      expect(r.outcome).toBe('SUCCESS');
    });
  }

  it('a wrong password on a phone account is still rejected (and audited)', async () => {
    const r = await svc2.attempt({ portal: 'tenant', salonCode: 'MERCH01', identifier: '856-555-1234', password: 'nope' });
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
    expect(sink2.attempts[0]).toMatchObject({ success: false, reason: 'INVALID_CREDENTIALS' });
  });

  it('a phone belonging to ANOTHER tenant cannot sign in through this store code', async () => {
    const r = await svc2.attempt({ portal: 'tenant', salonCode: 'OTHERSTORE', identifier: '856-555-1234', password: 'correct-horse' });
    expect(r.outcome).not.toBe('SUCCESS');   // store code resolves no tenant → generic failure
  });
});
