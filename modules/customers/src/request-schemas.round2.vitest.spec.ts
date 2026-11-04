// BUILD_PLAN Phase 12 round 2 (#17): referrals + review moderation (the Oct 31 2026 route; the legacy visibility route is retired), route by route on the real controllers.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { ReferralsController as R } from './pos-referrals/pos-referrals.controller';
import { ReviewsCenterController as V } from './reviews/reviews-center.controller';

const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/reviews-center/reviews/:id/moderate', ctl: V, handler: 'moderate',
    today: [{ action: 'hide', reasonCode: 'spam', reasonText: null, evidence: null, expectedVersion: 0, idempotencyKey: 'k-1' }, { action: 'unhide', reasonCode: null, reasonText: null, evidence: null, expectedVersion: 1, idempotencyKey: 'k-2' }],
    bad: [{ action: 'hide', reasonCode: 'spam', expectedVersion: 0, idempotencyKey: 'k-3', hidden: true }, 'hidden'] },
];
describe('retired referral routes (Referral Program guide, Oct 30): recording goes through /pos/referral-program', () => {
  it('POST /pos/referrals/record and /:id/reward no longer exist on the controller', () => {
    expect((R.prototype as any).record).toBeUndefined();
    expect((R.prototype as any).reward).toBeUndefined();
  });
});
describe('customers (round 2) — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
