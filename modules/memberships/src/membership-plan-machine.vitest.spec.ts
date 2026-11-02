// BUILD_PLAN Phase 12 round 2 (#27): publishing a version activates a plan; an archived plan is never published again.
import { describe, it, expect } from 'vitest';
import { MEMBERSHIP_PLAN } from './membership-machine';

describe('membership plan lifecycle', () => {
  it('publish from draft / active / paused / inactive / disabled; never from archived', () => {
    for (const f of ['draft', 'active', 'paused', 'inactive', 'disabled']) expect(MEMBERSHIP_PLAN.can(f, 'active'), f).toBe(true);
    expect(MEMBERSHIP_PLAN.can('archived', 'active')).toBe(false);
  });
});
