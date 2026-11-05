// access-request-core.vitest.spec.ts — the safety rules that gate access grants. Authority is deny-by-default: an
// approver can never grant above their own rank, SUPER_ADMIN is grantable only by SUPER_ADMIN, privileged grants are
// flagged high-risk, and decisions act only on open requests.
import { describe, it, expect } from 'vitest';
import { roleRank, isGrantableRole, approverCanGrant, isHighRisk, decideTransition, grantExpiry } from './access-request-core';

describe('roleRank / isGrantableRole', () => {
  it('orders authority and rejects unknown/customer roles as grant targets', () => {
    expect(roleRank('SUPER_ADMIN')).toBeGreaterThan(roleRank('OWNER'));
    expect(roleRank('OWNER')).toBeGreaterThan(roleRank('MANAGER'));
    expect(roleRank('MANAGER')).toBeGreaterThan(roleRank('TECHNICIAN'));
    expect(roleRank('NONSENSE')).toBe(0);
    expect(isGrantableRole('CUSTOMER')).toBe(false);
    expect(isGrantableRole('MANAGER')).toBe(true);
  });
});

describe('approverCanGrant (deny-by-default authority)', () => {
  it('lets an approver grant at or below their own authority', () => {
    expect(approverCanGrant('OWNER', 'MANAGER')).toBe(true);
    expect(approverCanGrant('OWNER', 'OWNER')).toBe(true);
    expect(approverCanGrant('MANAGER', 'TECHNICIAN')).toBe(true);
  });
  it('forbids granting above the approver’s authority', () => {
    expect(approverCanGrant('MANAGER', 'OWNER')).toBe(false);
    expect(approverCanGrant('TECHNICIAN', 'MANAGER')).toBe(false);
  });
  it('only a SUPER_ADMIN can grant SUPER_ADMIN', () => {
    expect(approverCanGrant('OWNER', 'SUPER_ADMIN')).toBe(false);
    expect(approverCanGrant('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
    expect(approverCanGrant('SUPER_ADMIN', 'OWNER')).toBe(true);
  });
  it('rejects an ungrantable target outright', () => {
    expect(approverCanGrant('SUPER_ADMIN', 'CUSTOMER')).toBe(false);
  });
});

describe('isHighRisk', () => {
  it('flags privileged elevations only', () => {
    expect(isHighRisk('OWNER')).toBe(true);
    expect(isHighRisk('SUPER_ADMIN')).toBe(true);
    expect(isHighRisk('MANAGER')).toBe(false);
    expect(isHighRisk('TECHNICIAN')).toBe(false);
  });
});

describe('decideTransition (lifecycle guard)', () => {
  it('review only from submitted', () => {
    expect(decideTransition('submitted', 'review')).toEqual({ ok: true, next: 'under_review' });
    expect(decideTransition('under_review', 'review')).toEqual({ ok: false, reason: 'invalid_transition' });
  });
  it('approve / reject / cancel act on open requests', () => {
    for (const cur of ['submitted', 'under_review']) {
      expect(decideTransition(cur, 'approve')).toEqual({ ok: true, next: 'approved' });
      expect(decideTransition(cur, 'reject')).toEqual({ ok: true, next: 'rejected' });
      expect(decideTransition(cur, 'cancel')).toEqual({ ok: true, next: 'cancelled' });
    }
  });
  it('terminal states cannot transition', () => {
    for (const cur of ['approved', 'rejected', 'cancelled', 'expired']) {
      expect(decideTransition(cur, 'approve').ok).toBe(false);
      expect(decideTransition(cur, 'cancel').ok).toBe(false);
    }
  });
});

describe('grantExpiry', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('permanent grant when no/zero duration', () => {
    expect(grantExpiry(now, null)).toBeNull();
    expect(grantExpiry(now, 0)).toBeNull();
    expect(grantExpiry(now, -5)).toBeNull();
  });
  it('temporary grant adds N days', () => {
    expect(grantExpiry(now, 30)!.toISOString()).toBe(new Date(now.getTime() + 30 * 86400000).toISOString());
  });
});
