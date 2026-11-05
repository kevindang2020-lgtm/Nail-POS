// BUILD_PLAN Phase 12 (#17): the customers routes' body validation, route by route on the real controller — today's
// pos-web bodies pass intact, unknown fields are stripped (notes keep extra scalar keys: they are a stored blob), a bad
// body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { CustomersController } from './customers/customers.controller';

const C = CustomersController;
const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/customers', ctl: C, handler: 'create', today: [
      { firstName: 'Ana', lastName: 'Lee', phone: '(609) 555-1234', email: 'ana@x.co', smsOptIn: true, emailOptIn: false, marketingOptIn: false },
      { firstName: 'Bo', phone: '6095551234', smsOptIn: false, emailOptIn: false, marketingOptIn: true },
    ], bad: [{ firstName: { $gt: '' } }, 'firstName'] },
  { route: 'PATCH /pos/customers/:id', ctl: C, handler: 'update', today: [
      { isVip: true, smsOptIn: true, emailOptIn: false, marketingOptIn: false, status: 'active', preferredName: 'Annie', preferredLanguage: 'Vietnamese', preferredBranchId: null, email: 'a@x.co', expectedVersion: 4 },
      { isVip: false, smsOptIn: false, emailOptIn: false, marketingOptIn: false, status: 'inactive', preferredName: '', preferredLanguage: '', preferredBranchId: null },
    ], bad: [{ expectedVersion: 'four' }, 'expectedVersion'] },
  { route: 'PATCH /pos/customers/:id/notes', ctl: C, handler: 'sNotes', keepsUnknown: true, today: [
      { salonNotes: 'likes almond', allergyNotes: '', preferredStyle: '', preferredTechnician: '', servicePreferences: '', warnings: 'acetone', customerVisible: false },
    ], bad: [{ salonNotes: ['x'] }, 'salonNotes'] },
  { route: 'PATCH /pos/customers/:id/tags', ctl: C, handler: 'sTags', today: [{ tags: ['VIP', 'no-show risk'] }], bad: [{ tags: 'VIP' }, 'tags'] },
  { route: 'PATCH /pos/customers/:id/loyalty', ctl: C, handler: 'sLoyalty', today: [
      { points: 120, earned: 300, redeemed: 180, tier: 'Gold', tierThresholdPoints: 500, birthdayReward: true, referralReward: false, reason: 'manual correction' },
    ], bad: [{ points: '120', reason: 'x' }, 'points'] },
  { route: 'POST /pos/customers/:id/loyalty-adjust', ctl: C, handler: 'sLoyaltyAdjust', today: [{ amount: -50, reason: 'goodwill' }], bad: [{ amount: { n: 1 } }, 'amount'] },
  { route: 'PATCH /pos/customers/:id/membership', ctl: C, handler: 'sMember', today: [{ plan: 'Gold', status: 'active', benefits: ['10% off'], billingStatus: 'current' }], bad: [{ benefits: 'all' }, 'benefits'] },
  { route: 'POST /pos/customers/duplicates/:id/decision', ctl: C, handler: 'decide', today: [{ decision: 'keep_separate' }, { decision: 'not_sure' }], bad: [{ decision: ['x'] }, 'decision'] },
  { route: 'POST /pos/customers/duplicates/:id/merge', ctl: C, handler: 'merge', today: [{ primaryCustomerId: '0b6c1f5e-3d0f-4c7e-9a51-1c2b3d4e5f60' }], bad: [{ primaryCustomerId: {} }, 'primaryCustomerId'] },
  { route: 'POST /pos/customers/import/preview', ctl: C, handler: 'importPreview', today: [{ csv: 'first_name,phone\nAna,6095551234', updateExisting: false }], bad: [{ csv: 42 }, 'csv'] },
  { route: 'POST /pos/customers/import/commit', ctl: C, handler: 'importCommit', today: [{ csv: 'first_name,phone\nAna,6095551234', updateExisting: true }], bad: [{ csv: ['a'] }, 'csv'] },
  { route: 'POST /pos/customers/import', ctl: C, handler: 'import', today: [{ csv: 'first_name\nAna' }], bad: [{ csv: {} }, 'csv'] },
];

describe('customers — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
