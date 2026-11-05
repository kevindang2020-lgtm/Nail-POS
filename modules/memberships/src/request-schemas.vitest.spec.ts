// BUILD_PLAN Phase 12 (#17): the memberships routes' body validation, route by route on the real controllers — the bodies
// pos-web (MembershipPlanBuilder, MembershipEnrollModal, MembershipRedeemPanel, posMembershipEnrollApi) and the internal
// billing runner send today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming the
// field, an undeclared tenantId (and a `status` on a staff membership body) is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { MembershipBillingController as BL } from './membership-billing.controller';
import { MembershipCommsController as CM } from './membership-comms.controller';
import { MembershipEnrollController as E } from './membership-enroll.controller';
import { MembershipsController as M } from './memberships.controller';

const I = '22222222-2222-4222-8222-222222222222';
const c = (route: string, ctl: any, handler: string, today: Record<string, unknown>[], bad: [unknown, string], keepsUnknown = false): RouteBodyCase => ({ route, ctl, handler, today, bad, keepsUnknown });
const version = { billingInterval: 'month', intervalCount: 1, priceCents: 4900, isCustomPricing: false, enrollmentFeeCents: 0, setupFeeCents: 0, trialDays: 0, autoRenew: true, billingCycles: null, termType: 'none', termDays: null, rolloverAllowed: true, rolloverMaxCycles: 2, creditExpiryDays: null, techCommissionBasis: 'percent', techSplitPct: 60, ownerSplitPct: 40, techFixedCents: null, allocationTiming: 'on_redemption', cancellationPolicy: 'end_of_period', minCommitmentCycles: 0, pauseMaxPerYear: 1, pauseMaxDays: 30, autoRenewDisclosure: 'Renews monthly', estMarginCents: 1500, benefits: [{ benefitType: 'service_credit', label: 'Gel mani', serviceId: I, creditsPerCycle: 1, valueCents: 4500, percent: 0, allocatedValueCents: 4500, minDaysBetween: 7, maxPerCycle: 1, rolloverAllowed: true }] };
const CASES: RouteBodyCase[] = [
  c('POST /pos/memberships/plans', M, 'createPlan', [{ name: 'Gel Club', planCode: null, productType: 'recurring', description: null, badge: null, isPopular: true, isFeatured: false, memberVisible: true }], [{ name: 'x', status: 'active' }, 'status']),
  c('POST /pos/memberships/plans/:planId/versions', M, 'publishVersion', [version], [{ ...version, benefits: { benefitType: 'x' } }, 'benefits']),
  c('POST /pos/memberships/enroll', E, 'enroll', [{ customerId: I, planId: I, autoRenewConsent: true, agreementVersion: 'pos-1', channel: 'pos' }], [{ customerId: I, planId: [I] }, 'planId']),
  c('POST /pos/memberships/members/by-customers', E, 'membersByCustomers', [{ customerIds: [I] }], [{ customerIds: I }, 'customerIds']),
  c('POST /pos/memberships/reserve', E, 'reserve', [{ membershipId: I, benefitId: I, ticketId: I, quantity: 1 }], [{ membershipId: I, quantity: '1' }, 'quantity']),
  c('POST /pos/memberships/release', E, 'release', [{ reservationRef: 'res-1' }], [{ reservationRef: { r: 1 } }, 'reservationRef']),
  c('POST /pos/memberships/redeem', E, 'redeem', [{ membershipId: I, benefitId: I, ticketId: I, serviceLineId: I, technicianId: I }], [{ membershipId: I, status: 'redeemed' }, 'status']),
  c('POST /pos/memberships/cancel', E, 'cancel', [{ membershipId: I, atPeriodEnd: true, reason: 'moving', expectedVersion: 3 }], [{ membershipId: I, atPeriodEnd: 'yes' }, 'atPeriodEnd']),
  c('POST /pos/memberships/pause', E, 'pause', [{ membershipId: I, resumesAt: '2026-11-01', expectedVersion: 3 }], [{ membershipId: [I] }, 'membershipId']),
  c('POST /pos/memberships/resume', E, 'resume', [{ membershipId: I }], [{ membershipId: I, expectedVersion: 'v3' }, 'expectedVersion']),
  c('POST /pos/memberships/comms/reminders/run', CM, 'runReminders', [{ withinDays: 7 }], [{ withinDays: [7] }, 'withinDays']),
  c('POST /internal/membership-billing/run-renewals', BL, 'run', [{}, { limit: 100 }], [{ limit: { n: 1 } }, 'limit']),
  c('POST /internal/membership-billing/run-reminders', BL, 'runReminders', [{ withinDays: 7, limit: 500 }], [{ withinDays: [] }, 'withinDays']),
  c('POST /internal/membership-billing/cardpointe', BL, 'cardpointe', [{ membershipId: I, charge: { respstat: 'A', resptext: 'Approval', retref: '123', amount: '49.00' }, attempt: 1 }], [{ membershipId: I, charge: { nested: { a: 1 } } }, 'charge.nested']),
  c('POST /internal/membership-billing/apply', BL, 'apply', [{ membershipId: I, status: 'succeeded', amountCents: 4900, processor: 'cardpointe', processorRef: 'r-1' }, { membershipId: I, status: 'failed', declineReason: 'insufficient funds', attempt: 2 }], [{ membershipId: I, amountCents: '49' }, 'amountCents']),
  c('POST /internal/membership-billing/proration-preview', BL, 'proration', [{ membershipId: I, newPriceCents: 5900 }], [{ membershipId: I, newPriceCents: {} }, 'newPriceCents']),
];

describe('memberships — validated bodies, route by route', () => {
  for (const x of CASES) it(x.route, () => expect(routeBodyFailures(x, bodyPipeOf as any)).toEqual([]));
});
