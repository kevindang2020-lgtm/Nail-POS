// Pure snapshot-assembly mapping for the Kysely access repo: raw query parts → access snapshot, then fed through the
// gate to prove the real data path enforces correctly (default-deny, active+limit, trial, role→permission, tenant status).
import { describe, it, expect } from 'vitest';
import { assembleSnapshot } from './ai-access.kysely.repository';
import { evaluateAiAccess } from './ai-access-gate';

describe('assembleSnapshot', () => {
  it('default-denies when there is no subscription', () => {
    const snap = assembleSnapshot({ tenantStatus: 'active', role: 'OWNER', subscription: null, used: 0 });
    expect(snap.subscription).toBeNull();
    expect(evaluateAiAccess(snap).reason).toBe('not_subscribed');
  });
  it('maps an active paid subscription within limit to allowed', () => {
    const snap = assembleSnapshot({
      tenantStatus: 'active', role: 'OWNER', used: 40,
      subscription: { status: 'active', trial_ends_at: null, usage_limit: 100, overage_enabled: false },
    });
    expect(snap.usage).toEqual({ used: 40, limit: 100, overageEnabled: false });
    const d = evaluateAiAccess(snap);
    expect(d.allowed).toBe(true); expect(d.remainingUsage).toBe(60);
  });
  it('carries trial end + overage flag through', () => {
    const ends = new Date(Date.now() - 1000).toISOString();
    const snap = assembleSnapshot({
      tenantStatus: 'active', role: 'OWNER', used: 0,
      subscription: { status: 'trialing', trial_ends_at: ends, usage_limit: 10, overage_enabled: true },
    });
    expect(snap.subscription?.trialEndsAt).toBe(ends);
    expect(snap.usage.overageEnabled).toBe(true);
    expect(evaluateAiAccess(snap).reason).toBe('trial_expired'); // ends in the past
  });
  it('unknown tenant → suspended (gate denies), and role drives permission', () => {
    expect(assembleSnapshot({ tenantStatus: null, role: 'OWNER', subscription: null, used: 0 }).tenantStatus).toBe('suspended');
    expect(assembleSnapshot({ tenantStatus: 'active', role: null, subscription: { status: 'active', trial_ends_at: null, usage_limit: 0, overage_enabled: false }, used: 0 }).hasPermission).toBe(false);
    expect(assembleSnapshot({ tenantStatus: 'active', role: 'OWNER', subscription: { status: 'active', trial_ends_at: null, usage_limit: 0, overage_enabled: false }, used: 0 }).hasPermission).toBe(true);
  });
});
