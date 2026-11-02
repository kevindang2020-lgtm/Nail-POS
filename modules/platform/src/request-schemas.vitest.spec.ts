// BUILD_PLAN Phase 12 (#17): the platform routes' body validation, route by route on the real controllers — the
// @Body(ValidatedBody(...)) pipe each handler carries, fed (1) the bodies admin-web sends today (copied from
// superAdminPlansApi / superAdminAutomationApi / FeatureRegistryScreen / ApprovalsScreen), which must pass intact,
// (2) the same plus an unknown field, which is stripped, (3) a bad body → 400 VALIDATION_FAILED naming the field,
// (4) an undeclared tenantId → refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { SuperAdminPlansController as P } from './super-admin-plans/plans.controller';
import { EntitlementsController as E } from './super-admin-plans/entitlements.controller';
import { SubscriptionChangeController as SC } from './super-admin-plans/subscription-change.controller';
import { TenantOffersController as O } from './super-admin-plans/tenant-offers.controller';
import { GrandfatherController as G } from './super-admin-plans/grandfather.controller';
import { OverageController as OV } from './super-admin-plans/overage.controller';
import { FeatureRegistryController as F } from './super-admin-plans/feature-registry';
import { PlatformApprovalsController as A } from './platform-approvals/platform-approvals';
import { SuperAdminAutomationController as AU } from './super-admin-automation/super-admin-automation.controller';

const U = '11111111-1111-4111-8111-111111111111';
const CASES: RouteBodyCase[] = [
  { route: 'POST /super-admin/plans', ctl: P, handler: 'create', today: [
      { code: 'gold', name: 'Gold', monthlyPriceCents: 9900 },
      { code: 'pro', name: 'Pro', subtitle: null, description: 'x', planType: 'standard', status: 'draft', monthlyPriceCents: 19900, annualPriceCents: 199000, setupFeeCents: 0, isRecommended: true, isPublic: true, displayOrder: 2, limits: { branches: 3, users: null }, features: [{ featureKey: 'ai.reports', state: 'enabled' }] },
    ], bad: [{ code: 'gold', name: 'Gold', monthlyPriceCents: '99' }, 'monthlyPriceCents'] },
  { route: 'PATCH /super-admin/plans/:id', ctl: P, handler: 'update', today: [{ name: 'Gold+' }, { status: 'active', isPublic: false, displayOrder: 1 }], bad: [{ name: 'x'.repeat(81) }, 'name'] },
  { route: 'POST /super-admin/plans/:id/pricing', ctl: P, handler: 'changePricing', today: [{ monthlyPriceCents: 10900, annualPriceCents: null, reason: 'annual review', confirm: true }, { monthlyPriceCents: 10900, reason: 'r', confirm: true, effectiveFrom: '2026-11-01' }], bad: [{ monthlyPriceCents: 10900, reason: 'r', confirm: 'yes' }, 'confirm'] },
  { route: 'PUT /super-admin/plans/:id/limits', ctl: P, handler: 'updateLimits', today: [{ reason: 'r', changes: [{ metric: 'branches', limitValue: 5 }, { metric: 'users', limitValue: 'unlimited', enforcement: 'soft', overageAllowed: true, overagePriceCents: 500 }, { metric: 'devices', limitValue: null }] }], bad: [{ reason: 'r', changes: [{ metric: 'branches', limitValue: -1 }] }, 'changes[0].limitValue'] },
  { route: 'PUT /super-admin/plans/tenants/:tenantId/limits', ctl: E, handler: 'setLimit', today: [{ metric: 'branches', limitValue: 4, enforcement: 'hard', reason: 'pilot' }, { metric: 'branches', clear: true, reason: 'r' }], bad: [{ metric: 'branches', limitValue: 'lots' }, 'limitValue'] },
  { route: 'PUT /super-admin/plans/tenants/:tenantId/features', ctl: E, handler: 'setFeature', today: [{ featureKey: 'ai.reports', state: 'enabled', reason: 'trial' }, { featureKey: 'ai.reports', state: 'clear' }], bad: [{ featureKey: ['x'], state: 'enabled' }, 'featureKey'] },
  { route: 'POST /super-admin/plans/tenants/:tenantId/usage', ctl: E, handler: 'recordUsage', today: [{ metric: 'sms_monthly', amount: 10, period: '2026-10' }], bad: [{ metric: 'sms_monthly', amount: 1.5 }, 'amount'] },
  { route: 'POST …/subscription/preview', ctl: SC, handler: 'preview', today: [{ toPlanCode: 'gold', strategy: 'immediate' }], bad: [{ toPlanCode: { code: 'gold' } }, 'toPlanCode'] },
  { route: 'POST …/subscription/change', ctl: SC, handler: 'change', today: [{ toPlanCode: 'gold', strategy: 'next_cycle', reason: 'upgrade' }], bad: [{ toPlanCode: 'gold', reason: 'x'.repeat(1001) }, 'reason'] },
  { route: 'POST …/offers/add-ons', ctl: O, handler: 'assignAddOn', today: [{ addOnCode: 'ai_pack', quantity: 1, priceCents: 2900 }, { addOnCode: 'ai_pack', priceCents: null }], bad: [{ addOnCode: 'ai_pack', quantity: -1 }, 'quantity'] },
  { route: 'POST …/offers/add-ons/cancel', ctl: O, handler: 'cancelAddOn', today: [{ addOnCode: 'ai_pack' }], bad: [{ addOnCode: 5 }, 'addOnCode'] },
  { route: 'POST …/offers/trials', ctl: O, handler: 'startTrial', today: [{ trialCode: 't30' }], bad: [{ trialCode: [] }, 'trialCode'] },
  { route: 'POST …/offers/promotions', ctl: O, handler: 'applyPromotion', today: [{ promoCode: 'FALL' }], bad: [{ promoCode: {} }, 'promoCode'] },
  { route: 'POST /super-admin/plans/grandfathered', ctl: G, handler: 'create', today: [{ tenantId: U, planVersionId: U, lockedMonthlyPriceCents: 4900, migrationTargetPlanCode: null, effectiveFrom: null, endDate: '2027-01-01', reason: 'legacy' }], bad: [{ tenantId: U, planVersionId: U, lockedMonthlyPriceCents: '49', reason: 'r' }, 'lockedMonthlyPriceCents'] },
  { route: 'PUT /super-admin/plans/overage/rules', ctl: OV, handler: 'updateRules', today: [{ reason: 'r', changes: [{ metric: 'sms_monthly', unitPriceCents: 2, graceAmount: 100, warningThresholdPct: 80 }] }], bad: [{ reason: 'r', changes: 'sms' }, 'changes'] },
  { route: 'PATCH /super-admin/features/:key', ctl: F, handler: 'setStatus', today: [{ status: 'beta', reason: 'rolling out' }], bad: [{ status: ['beta'] }, 'status'] },
  { route: 'POST /super-admin/approvals/:id/approve', ctl: A, handler: 'approve', today: [{}, { note: 'ok' }], bad: [{ note: 5 }, 'note'] },
  { route: 'POST /super-admin/approvals/:id/reject', ctl: A, handler: 'reject', today: [{ note: 'not justified enough' }], bad: [{ note: 'x'.repeat(2001) }, 'note'] },
  { route: 'POST /super-admin/approvals/policies/:action', ctl: A, handler: 'setPolicy', today: [{ required: true, reason: 'two person rule' }], bad: [{ required: 'yes' }, 'required'] },
  { route: 'POST /super-admin/automation-rules/rules', ctl: AU, handler: 'createRule', today: [{ name: 'EOD', triggerId: 'day.closed', actions: [{ type: 'notify_owner' }], conditions: { logic: 'and', conditions: [{ field: 'x', operator: 'eq', value: 1 }] }, scopeKind: 'tenant', tenantId: U }], bad: [{ name: 'x', actions: 'notify' }, 'actions'] },
  { route: 'POST /super-admin/automation-rules/test', ctl: AU, handler: 'testInline', today: [{ triggerId: 'day.closed', conditions: { logic: 'and' }, actions: [{ type: 'notify_owner' }], context: { x: 1 } }], bad: [{ context: 'x' }, 'context'] },
  { route: 'POST /super-admin/automation-rules/rules/:id/test', ctl: AU, handler: 'testRule', today: [{ triggerId: 'day.closed' }], bad: [{ actions: [{ type: 5 }] }, 'actions[0].type'] },
  { route: 'POST /super-admin/automation-rules/rules/:id/status', ctl: AU, handler: 'setStatus', today: [{ to: 'active' }, { to: 'disabled', reason: 'noisy' }], bad: [{ to: { s: 1 } }, 'to'] },
  { route: 'POST /super-admin/automation-rules/exceptions', ctl: AU, handler: 'createException', today: [{ ruleId: U, tenantId: U, exceptionType: 'quiet_hours', overrideValue: '22:00', notes: 'n', reason: 'r' }], bad: [{ ruleId: U, tenantId: U, exceptionType: 'x'.repeat(61) }, 'exceptionType'] },
];

describe('platform — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    // a Super Admin route whose payload IS a target tenant (grandfathering, a rule's scope, a tenant exception) declares
    // tenantId — the "undeclared tenantId is refused" probe does not apply to it
    const declares = !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
    expect(routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(declares && f.endsWith('an undeclared tenantId was accepted')))).toEqual([]);
  });
  it('the routes that DECLARE a target tenantId still refuse platformRole / permissions', () => {
    for (const [ctl, h, body] of [[G, 'create', { tenantId: U, planVersionId: U, reason: 'r' }], [AU, 'createRule', { name: 'x', tenantId: U }], [AU, 'createException', { ruleId: U, tenantId: U }]] as const) {
      const pipe: any = bodyPipeOf(ctl as any, h);
      expect(() => pipe.transform({ ...body, platformRole: 'owner' })).toThrow();
      expect(() => pipe.transform({ ...body, permissions: ['*'] })).toThrow();
    }
  });
});
