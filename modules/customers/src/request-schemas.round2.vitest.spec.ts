// BUILD_PLAN Phase 12 round 2 (#17): referrals + review visibility, route by route on the real controllers.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { ReferralsController as R } from './pos-referrals/pos-referrals.controller';
import { ReviewsController as V } from './reviews/reviews.controller';

const I = '22222222-2222-4222-8222-222222222222';
const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/referrals/record', ctl: R, handler: 'record', today: [{ code: 'MAI10', referredCustomerId: I }], bad: [{ code: ['MAI10'] }, 'code'] },
  { route: 'POST /pos/referrals/:id/reward', ctl: R, handler: 'reward', today: [{ rewardCents: 1000 }], bad: [{ rewardCents: 1000, status: 'rewarded' }, 'status'] },
  { route: 'POST /pos/reviews/:id/visibility', ctl: V, handler: 'visibility', today: [{ hidden: true, reason: 'spam' }, { hidden: false, reason: null }], bad: [{ hidden: 'yes' }, 'hidden'] },
];
describe('customers (round 2) — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
