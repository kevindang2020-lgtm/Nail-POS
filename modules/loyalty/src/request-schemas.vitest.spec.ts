// BUILD_PLAN Phase 12 (#17): the loyalty routes' body validation, route by route on the real controller.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { LoyaltyController as L } from './loyalty.controller';

const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/loyalty/rewards', ctl: L, handler: 'createReward', today: [{ title: '$5 off', pointsCost: 100, rewardType: 'amount_off', valueCents: 500, validDays: 30, active: true }], bad: [{ title: 'x', pointsCost: '100' }, 'pointsCost'] },
  { route: 'PATCH /pos/loyalty/rewards/:rewardId', ctl: L, handler: 'updateReward', today: [{ active: false }, { title: '10% off', rewardType: 'percent_off', percent: 10, validDays: null }], bad: [{ active: 'no' }, 'active'] },
];
describe('loyalty — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
