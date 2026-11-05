// BUILD_PLAN Phase 12 (#17): the analytics routes' body validation (Owner App + AI Business Assistant), route by route
// on the real controllers — the bodies owner-web / pos-web send today pass intact, unknown fields are stripped, a bad
// body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { OwnerController as O } from './owner/owner.controller';
import { AiBusinessController as A } from './ai-business/ai-business.controller';

const B = '22222222-2222-4222-8222-222222222222';
const CASES: RouteBodyCase[] = [
  { route: 'POST /owner/activity', ctl: O, handler: 'recordActivity', today: [{ screen: 'dashboard' }, { screen: 'reports', branchId: B }], bad: [{ screen: ['reports'] }, 'screen'] },
  { route: 'POST /owner/context/select', ctl: O, handler: 'selectContext', today: [{ mode: 'all' }, { mode: 'single', branchId: B, pin: '1234' }], bad: [{ mode: 'single', pin: { p: 1 } }, 'pin'] },
  { route: 'POST /owner/security/access-code', ctl: O, handler: 'setAccessCode', today: [{ currentPassword: 'pw-123456', newCode: '482913' }], bad: [{ currentPassword: 5 }, 'currentPassword'] },
  { route: 'POST /owner/expenses', ctl: O, handler: 'createExpense', today: [{ category: 'supplies', amountCents: 4599, description: 'acetone', vendor: 'Sally', incurredOn: '2026-10-07' }, { category: 'rent', amountCents: 250000, incurredOn: '2026-10-01', branchId: B }], bad: [{ category: 'rent', amountCents: '2500', incurredOn: '2026-10-01' }, 'amountCents'] },
  { route: 'PATCH /owner/expenses/:id', ctl: O, handler: 'updateExpense', today: [{ amountCents: 4000 }, { description: null, vendor: null }], bad: [{ incurredOn: 20261001 }, 'incurredOn'] },
  { route: 'POST /owner/payroll/periods/:id/approve', ctl: O, handler: 'approvePayroll', today: [{ pin: '1234' }], bad: [{ pin: '1234', status: 'approved' }, 'status'] },
  { route: 'POST /owner/payroll/periods/:id/lock', ctl: O, handler: 'lockPayroll', today: [{ pin: '1234' }], bad: [{ pin: ['1234'] }, 'pin'] },
  { route: 'POST /owner/payroll/periods/:id/reopen', ctl: O, handler: 'reopenPayroll', today: [{ pin: '1234' }], bad: [{ pin: {} }, 'pin'] },
  { route: 'POST /pos/ai-business/reports', ctl: A, handler: 'createReport', today: [{ reportType: 'weekly_summary' }], bad: [{ reportType: 7 }, 'reportType'] },
  { route: 'POST /pos/ai-business/ask', ctl: A, handler: 'ask', today: [{ question: 'How did we do today?' }, { intent: 'revenue_summary', preset: 'today', comparePreset: 'yesterday' }], bad: [{ question: 'x'.repeat(2001) }, 'question'] },
  { route: 'POST /pos/ai-business/saved-questions', ctl: A, handler: 'createSaved', today: [{ title: 'Daily revenue', intent: 'revenue_summary', preset: 'today', sharingScope: 'tenant' }], bad: [{ title: 'x', intent: ['revenue_summary'] }, 'intent'] },
  { route: 'POST /pos/ai-business/alerts', ctl: A, handler: 'createAlert', today: [{ title: 'Low revenue', metricId: 'revenue', operator: 'lt', threshold: 500, preset: 'today' }], bad: [{ title: 'x', metricId: 'revenue', operator: 'lt', threshold: '500' }, 'threshold'] },
  { route: 'PATCH /pos/ai-business/alerts/:id', ctl: A, handler: 'updateAlert', today: [{ active: false }, { threshold: 250, title: 'Renamed' }], bad: [{ active: 'false' }, 'active'] },
];

describe('analytics — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
