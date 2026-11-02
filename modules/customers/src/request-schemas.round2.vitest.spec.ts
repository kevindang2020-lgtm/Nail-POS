// BUILD_PLAN Phase 12 round 2 (#17): referrals + review moderation (the Oct 31 2026 route; the legacy visibility route is retired), route by route on the real controllers.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { ReferralsController as R } from './pos-referrals/pos-referrals.controller';
import { ReviewsCenterController as V } from './reviews/reviews-center.controller';

const I = '22222222-2222-4222-8222-222222222222';
const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/referrals/record', ctl: R, handler: 'record', today: [{ code: 'MAI10', referredCustomerId: I }], bad: [{ code: ['MAI10'] }, 'code'] },
  { route: 'POST /pos/referrals/:id/reward', ctl: R, handler: 'reward', today: [{ rewardCents: 1000 }], bad: [{ rewardCents: 1000, status: 'rewarded' }, 'status'] },
  { route: 'POST /pos/reviews-center/reviews/:id/moderate', ctl: V, handler: 'moderate',
    today: [{ action: 'hide', reasonCode: 'spam', reasonText: null, evidence: null, expectedVersion: 0, idempotencyKey: 'k-1' }, { action: 'unhide', reasonCode: null, reasonText: null, evidence: null, expectedVersion: 1, idempotencyKey: 'k-2' }],
    bad: [{ action: 'hide', reasonCode: 'spam', expectedVersion: 0, idempotencyKey: 'k-3', hidden: true }, 'hidden'] },
];
describe('customers (round 2) — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
