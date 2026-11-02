// Constitution 7 §16–§21 — the lifecycle transition rules.
import { describe, it, expect } from 'vitest';
import { decideLifecycleMove, LIFECYCLE_TRANSITIONS, LIFECYCLE_STATES } from './tenant-lifecycle-core';

describe('tenant lifecycle moves', () => {
  it('the table covers every state; ARCHIVED is the only terminal one; CLOSED leads only to ARCHIVED', () => {
    expect(Object.keys(LIFECYCLE_TRANSITIONS).sort()).toEqual([...LIFECYCLE_STATES].sort());
    expect(LIFECYCLE_STATES.filter((s) => LIFECYCLE_TRANSITIONS[s].length === 0)).toEqual(['ARCHIVED']);
    expect(LIFECYCLE_TRANSITIONS.CLOSED).toEqual(['ARCHIVED']);
  });
  it('onboarding goes DRAFT → ONBOARDING → PENDING_APPROVAL → ACTIVE, and cannot skip to ACTIVE', () => {
    expect(decideLifecycleMove('ONBOARDING', 'PENDING_APPROVAL')).toMatchObject({ ok: true });
    expect(decideLifecycleMove('PENDING_APPROVAL', 'ACTIVE')).toMatchObject({ ok: true });
    expect(decideLifecycleMove('ONBOARDING', 'ACTIVE')).toMatchObject({ ok: false, error: /cannot move from ONBOARDING to ACTIVE/ });
    expect(decideLifecycleMove('DRAFT', 'ACTIVE')).toMatchObject({ ok: false });
  });
  it('restriction and suspension need a reason code and a written reason (§18)', () => {
    expect(decideLifecycleMove('ACTIVE', 'RESTRICTED', 'card declined three times')).toMatchObject({ ok: false, error: /reason code/ });
    expect(decideLifecycleMove('PAST_DUE', 'SUSPENDED', 'short', 'BILLING')).toMatchObject({ ok: false, error: /at least 10/ });
    expect(decideLifecycleMove('PAST_DUE', 'SUSPENDED', 'unpaid for 45 days', 'BILLING')).toEqual({ ok: true, from: 'PAST_DUE', to: 'SUSPENDED' });
  });
  it('reactivation, closure and archiving need a written reason; PAST_DUE → ACTIVE (paid) does not', () => {
    expect(decideLifecycleMove('SUSPENDED', 'ACTIVE')).toMatchObject({ ok: false, error: /reason/ });
    expect(decideLifecycleMove('ACTIVE', 'CLOSED', 'x')).toMatchObject({ ok: false });
    expect(decideLifecycleMove('CLOSED', 'ARCHIVED', 'retention period complete')).toMatchObject({ ok: true });
    expect(decideLifecycleMove('PAST_DUE', 'ACTIVE')).toMatchObject({ ok: true });
  });
  it('nothing leaves ARCHIVED, and a closed tenant cannot be quietly reactivated', () => {
    expect(decideLifecycleMove('ARCHIVED', 'ACTIVE', 'bring it back please')).toMatchObject({ ok: false });
    expect(decideLifecycleMove('CLOSED', 'ACTIVE', 'bring it back please')).toMatchObject({ ok: false });
  });
});
