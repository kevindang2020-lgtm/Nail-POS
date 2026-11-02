// BUILD_PLAN Phase 12 round 2 (#17): the hardware payment program's Super Admin + cron routes — route by route on the
// real controllers: admin-web's bodies pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED
// naming the field, an undeclared tenantId (and raw card data) is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { HardwarePaymentCronController as HC } from './hardware-payment/hardware-payment.cron.controller';
import { HardwarePaymentSuperAdminController as HS } from './hardware-payment/hardware-payment.super-admin.controller';

const I = '22222222-2222-4222-8222-222222222222';
const c = (route: string, ctl: any, handler: string, today: Record<string, unknown>[], bad: [unknown, string]): RouteBodyCase => ({ route, ctl, handler, today, bad });
const CASES: RouteBodyCase[] = [
  c('POST /internal/hardware-payment/run-monthly', HC, 'runMonthly', [{}, { billingMonth: '2026-09' }], [{ billingMonth: 202609 }, 'billingMonth']),
  c('POST /super-admin/tenants/:tenantId/hardware-payment-plan', HS, 'createPlan', [{ status: 'active', monthlyPaymentCents: 9900, totalHardwareCostCents: 238800 }], [{ status: 'active', cardNumber: '4111111111111111' }, 'cardNumber']),
  c('PATCH /super-admin/tenants/:tenantId/hardware-payment-plan/:planId', HS, 'updatePlan', [{ monthlyPaymentCents: 8900, dueDayOfMonth: 5 }], [{ dueDayOfMonth: 40 }, 'dueDayOfMonth']),
  c('POST /super-admin/tenants/:tenantId/hardware-payment/recalculate-month', HS, 'recalc', [{ planId: I, billingMonth: '2026-09', cardVolumeCents: 5000000 }], [{ planId: I, billingMonth: '2026-09', cardVolumeCents: {} }, 'cardVolumeCents']),
  c('POST /super-admin/tenants/:tenantId/hardware-payment/charge-shortfall', HS, 'chargeShortfall', [{ planId: I, billingMonth: '2026-09' }], [{ planId: [I] }, 'planId']),
  c('POST /super-admin/tenants/:tenantId/hardware-payment/import-volume', HS, 'importVolume', [{ billingMonth: '2026-09', cardVolumeCents: 5000000, source: 'manual' }], [{ billingMonth: '2026-09', source: 5 }, 'source']),
  c('POST /super-admin/hardware-payment/run-monthly', HS, 'runMonthly', [{ billingMonth: '2026-09' }], [{ billingMonth: '2026-09-01' }, 'billingMonth']),
  c('POST /super-admin/tenants/:tenantId/hardware-payment/pause', HS, 'pause', [{ planId: I }], [{ planId: {} }, 'planId']),
  c('POST /super-admin/tenants/:tenantId/hardware-payment/resume', HS, 'resume', [{ planId: I }], [{ planId: [] }, 'planId']),
  c('PATCH /super-admin/hardware-payment/settings', HS, 'updateSettings', [{ pricingRateBps: 290, expenseRateBps: 180, platformSharePercent: 50, fiservSharePercent: 50 }], [{ pricingRateBps: [290] }, 'pricingRateBps']),
  c('PATCH /super-admin/tenants/:tenantId/hardware-payment/settings', HS, 'updateTenantSettings', [{ pricingRateBps: '290', salonHardwareCreditPercentOfPlatformShare: 40 }], [{ fiservSharePercent: {} }, 'fiservSharePercent']),
];

describe('payments (round 2) — validated bodies, route by route', () => {
  for (const x of CASES) it(x.route, () => expect(routeBodyFailures(x, bodyPipeOf as any)).toEqual([]));
});
