import { describe, it, expect } from 'vitest';
import { detectDuplicates, validateCorrection, validateDisable, validateSupportSession, detectSuspicious } from './membership-actions-core';

const base = (over: Partial<any> = {}) => ({ id: 'x', membershipId: 'm1', amountCents: 4900, status: 'succeeded', createdAt: '2026-05-01T10:00:00Z', ...over });

describe('detectDuplicates', () => {
  it('flags two succeeded same-amount charges within the window (high confidence when <1h apart)', () => {
    const cases = detectDuplicates([base({ id: 'a', createdAt: '2026-05-01T10:00:00Z' }), base({ id: 'b', createdAt: '2026-05-01T10:30:00Z' })]);
    expect(cases).toHaveLength(1);
    expect(cases[0].count).toBe(2);
    expect(cases[0].paymentIds).toEqual(['a', 'b']);
    expect(cases[0].confidence).toBe('high');
  });
  it('does not flag charges outside the window', () => {
    const cases = detectDuplicates([base({ id: 'a', createdAt: '2026-05-01T10:00:00Z' }), base({ id: 'b', createdAt: '2026-05-10T10:00:00Z' })], 48);
    expect(cases).toHaveLength(0);
  });
  it('ignores failed charges and different amounts', () => {
    expect(detectDuplicates([base({ id: 'a' }), base({ id: 'b', status: 'failed' })])).toHaveLength(0);
    expect(detectDuplicates([base({ id: 'a' }), base({ id: 'b', amountCents: 5900 })])).toHaveLength(0);
  });
});

describe('validateCorrection', () => {
  it('accepts a well-formed compensating correction', () => {
    const r = validateCorrection({ membershipId: 'm1', direction: 'credit', quantity: 1, amountCents: 4900, reason: 'duplicate credit issued during migration' });
    expect(r.ok).toBe(true); expect(r.value.direction).toBe('credit');
  });
  it('requires membershipId, valid direction, positive quantity, and a reason', () => {
    expect(validateCorrection({ direction: 'credit', quantity: 1, reason: 'x is enough?' }).ok).toBe(false); // missing membershipId
    expect(validateCorrection({ membershipId: 'm', direction: 'sideways', quantity: 1, reason: 'valid reason' }).ok).toBe(false);
    expect(validateCorrection({ membershipId: 'm', direction: 'credit', quantity: 0, reason: 'valid reason' }).ok).toBe(false);
    expect(validateCorrection({ membershipId: 'm', direction: 'credit', quantity: 1, reason: 'no' }).ok).toBe(false);
  });
});

describe('validateDisable', () => {
  it('requires a reason', () => {
    expect(validateDisable({ reason: 'duplicate charging across branches' }).ok).toBe(true);
    expect(validateDisable({ reason: '' }).ok).toBe(false);
  });
});

describe('validateSupportSession', () => {
  it('accepts a valid session request', () => {
    const r = validateSupportSession({ tenantId: 't1', reason: 'investigating billing failure', durationMinutes: 30, accessLevel: 'read_only' });
    expect(r.ok).toBe(true); expect(r.value.durationMinutes).toBe(30);
  });
  it('requires tenant, reason, and a bounded duration', () => {
    expect(validateSupportSession({ reason: 'valid reason', durationMinutes: 30 }).ok).toBe(false);
    expect(validateSupportSession({ tenantId: 't1', reason: 'no', durationMinutes: 30 }).ok).toBe(false);
    expect(validateSupportSession({ tenantId: 't1', reason: 'valid reason', durationMinutes: 1 }).ok).toBe(false);
    expect(validateSupportSession({ tenantId: 't1', reason: 'valid reason', durationMinutes: 9999 }, 240).ok).toBe(false);
  });
});

describe('detectSuspicious', () => {
  const m = (over: Partial<any>) => ({ membershipId: 'x', customerId: 'c1', planId: 'p1', status: 'active', ...over });
  it('flags a customer with 2+ active memberships and scores severity by count', () => {
    const cases = detectSuspicious([m({ membershipId: 'a', planId: 'p1' }), m({ membershipId: 'b', planId: 'p2' })]);
    expect(cases).toHaveLength(1); expect(cases[0].count).toBe(2); expect(cases[0].severity).toBe('low');
    const high = detectSuspicious([m({ membershipId: 'a' }), m({ membershipId: 'b' }), m({ membershipId: 'c' }), m({ membershipId: 'd' })]);
    expect(high[0].severity).toBe('high');
  });
  it('ignores single memberships and non-active statuses', () => {
    expect(detectSuspicious([m({ membershipId: 'a' })])).toHaveLength(0);
    expect(detectSuspicious([m({ membershipId: 'a', status: 'cancelled' }), m({ membershipId: 'b', status: 'paused' })])).toHaveLength(0);
  });
});

// Constitution 7 §74–§78 — the same Support Mode rules as every other entry
import { validateSupportSession as vss } from './membership-actions-core';
describe('memberships support mode follows the Support Mode rules', () => {
  it('reason 10+ characters; 15–60 minutes', () => {
    expect(vss({ tenantId: 't1', reason: 'short', durationMinutes: 30 }).ok).toBe(false);
    expect(vss({ tenantId: 't1', reason: 'member billing review', durationMinutes: 240 }).ok).toBe(false);
    expect(vss({ tenantId: 't1', reason: 'member billing review', durationMinutes: 10 }).ok).toBe(false);
    expect(vss({ tenantId: 't1', reason: 'member billing review', durationMinutes: 60 }).ok).toBe(true);
  });
});
