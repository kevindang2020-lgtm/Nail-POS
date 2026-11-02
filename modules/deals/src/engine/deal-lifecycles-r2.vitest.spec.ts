// BUILD_PLAN Phase 12 round 2 (#27): the DEAL machine contains every move deals.core's TRANSITIONS lists (the lifecycle
// routes keep working), the coupon flag moves and the platform suspension; ARCHIVED is terminal; a revoked code is final.
import { describe, it, expect } from 'vitest';
import { DEAL, DEAL_COUPON_CODE, BUNDLE } from './deal-lifecycles';
import { nextStatus } from '../deals/deals.core';

describe('deal lifecycles', () => {
  it('every action deals.core allows is a DEAL move', () => {
    const actions = ['submit', 'approve', 'reject', 'request_changes', 'publish', 'schedule', 'pause', 'resume', 'mark_sold_out', 'expire', 'cancel', 'archive'] as const;
    for (const from of DEAL.states) for (const a of actions) { const to = nextStatus(from as any, a as any); if (to) expect(DEAL.can(from, to), `${from} -${a}-> ${to}`).toBe(true); }
  });
  it('the platform suspension cancels a live or finished deal; archived is terminal', () => {
    for (const f of ['active', 'paused', 'expired', 'sold_out', 'rejected']) expect(DEAL.can(f, 'canceled'), f).toBe(true);
    expect(DEAL.states.filter((t) => DEAL.can('archived', t))).toEqual([]);
  });
  it('coupon codes: used up and given back, never un-revoked; bundles are a flag', () => {
    expect([DEAL_COUPON_CODE.can('active', 'exhausted'), DEAL_COUPON_CODE.can('exhausted', 'active'), DEAL_COUPON_CODE.can('revoked', 'active')]).toEqual([true, true, false]);
    expect(BUNDLE.can('archived', 'active')).toBe(true);
  });
});
