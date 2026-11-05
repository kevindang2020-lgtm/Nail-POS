// eligibility.vitest.spec — every deal column and rule enforced, every reason listed (BUILD_PLAN Phase 5, bugs 5 + 6).
import { describe, it, expect } from 'vitest';
import { evaluateEligibility, evaluateRules, validateRules, localClock, type DealTerms, type EligibilityFacts } from './eligibility';

const NOW = Date.parse('2026-10-07T16:00:00Z');   // Wednesday, 12:00 in New York
const terms = (over: Partial<DealTerms> = {}): DealTerms => ({ id: 'd1', kind: 'deal', status: 'active', branchId: null, startsAt: null, endsAt: null, newCustomersOnly: false, memberOnly: false, serviceIds: [], ...over });
const facts = (over: Partial<EligibilityFacts> = {}): EligibilityFacts => ({ now: NOW, channel: 'pos', branchId: 'b1', timezone: 'America/New_York', serviceIds: ['gel'], spendCents: 5000, customer: { id: 'c1', paidVisits: 3, isMember: false }, usage: { taken: 0, byCustomer: 0 }, ...over });
const codes = (r: ReturnType<typeof evaluateEligibility>) => r.reasons.map((x) => x.code);

describe('the columns that were stored and never checked', () => {
  it('an active, unconstrained deal is eligible', () => { expect(evaluateEligibility(terms(), facts())).toMatchObject({ eligible: true, reasons: [] }); });
  it('date window: not started / ended', () => {
    expect(codes(evaluateEligibility(terms({ startsAt: '2026-10-08T00:00:00Z' }), facts()))).toContain('not_started');
    expect(codes(evaluateEligibility(terms({ endsAt: '2026-10-07T00:00:00Z' }), facts()))).toContain('ended');
  });
  it('a booking for after the deal ends does not qualify', () => {
    expect(codes(evaluateEligibility(terms({ endsAt: '2026-10-10T00:00:00Z' }), facts({ serviceAt: Date.parse('2026-10-12T15:00:00Z') })))).toEqual(['service_after_end']);
  });
  it('new customers only / members only / per customer', () => {
    expect(codes(evaluateEligibility(terms({ newCustomersOnly: true }), facts()))).toEqual(['new_customers_only']);
    expect(evaluateEligibility(terms({ newCustomersOnly: true }), facts({ customer: { id: 'c2', paidVisits: 0, isMember: false } })).eligible).toBe(true);
    expect(codes(evaluateEligibility(terms({ memberOnly: true }), facts()))).toEqual(['members_only']);
    expect(codes(evaluateEligibility(terms({ maxPerCustomer: 1 }), facts({ usage: { taken: 5, byCustomer: 1 } })))).toEqual(['per_customer_limit']);
  });
  it('sold out, budget used up', () => {
    expect(codes(evaluateEligibility(terms({ maxRedemptions: 5 }), facts({ usage: { taken: 5, byCustomer: 0 } })))).toEqual(['sold_out']);
    expect(codes(evaluateEligibility(terms({ budgetCents: 10_000, budgetReservedCents: 10_000 }), facts()))).toEqual(['budget_exhausted']);
  });
  it('days, hours (in the SALON’s timezone) and lead time', () => {
    expect(localClock(NOW, 'America/New_York')).toMatchObject({ dow: 3, minute: 720 });
    expect(codes(evaluateEligibility(terms({ daysOfWeek: [1, 2] }), facts()))).toEqual(['wrong_day']);
    expect(evaluateEligibility(terms({ daysOfWeek: [3] }), facts()).eligible).toBe(true);
    expect(codes(evaluateEligibility(terms({ validFromMinute: 13 * 60, validToMinute: 17 * 60 }), facts()))).toEqual(['wrong_time']);
    expect(codes(evaluateEligibility(terms({ bookingLeadMinutes: 120 }), facts({ serviceAt: NOW + 30 * 60_000 })))).toEqual(['lead_time']);
  });
  it('services, minimum spend, branch, channel, code', () => {
    expect(codes(evaluateEligibility(terms({ serviceIds: ['pedi'] }), facts()))).toEqual(['no_eligible_service']);
    expect(evaluateEligibility(terms({ serviceIds: ['pedi', 'gel'] }), facts({ serviceIds: ['gel', 'brows'] })).eligibleServiceIds).toEqual(['gel']);
    expect(codes(evaluateEligibility(terms({ minSpendCents: 6000 }), facts()))).toEqual(['min_spend']);
    expect(codes(evaluateEligibility(terms({ branchId: 'b2' }), facts()))).toEqual(['wrong_branch']);
    expect(codes(evaluateEligibility(terms({ channels: ['customer_app'] }), facts()))).toEqual(['wrong_channel']);
    expect(codes(evaluateEligibility(terms({ requiresCode: true }), facts()))).toEqual(['code_required']);
    expect(evaluateEligibility(terms({ requiresCode: true }), facts({ codeProvided: true })).eligible).toBe(true);
  });
  it('status, suspension, kill switch, tenant switch, frozen technician', () => {
    expect(codes(evaluateEligibility(terms({ status: 'paused' }), facts()))).toEqual(['not_active']);
    expect(codes(evaluateEligibility(terms({ suspendedAt: '2026-10-01T00:00:00Z', status: 'canceled' }), facts()))).toEqual(['suspended']);
    expect(codes(evaluateEligibility(terms(), facts({ engineOff: true, tenantDisabled: true, techFrozen: true })))).toEqual(['engine_off', 'tenant_disabled', 'tech_frozen']);
  });
  it('lists EVERY reason, not just the first', () => {
    expect(codes(evaluateEligibility(terms({ memberOnly: true, minSpendCents: 9000, serviceIds: ['pedi'] }), facts()))).toEqual(['members_only', 'no_eligible_service', 'min_spend']);
  });
  it('tenant settings: new-customer / existing-customer deals switched off', () => {
    expect(codes(evaluateEligibility(terms(), facts({ settings: { allowedExistingCustomer: false } })))).toEqual(['new_customers_only']);
    expect(codes(evaluateEligibility(terms(), facts({ customer: { id: 'c', paidVisits: 0, isMember: false }, settings: { allowedNewCustomer: false } })))).toEqual(['existing_customers_only']);
  });
});

describe('the rule builder (AND / OR)', () => {
  it('all: every rule must hold', () => {
    const g = { all: [{ type: 'member' as const }, { type: 'min_spend' as const, cents: 4000 }] };
    expect(evaluateRules(g, facts()).map((r) => r.code)).toEqual(['rule_member']);
  });
  it('any: one branch is enough; when none holds the reason lists the options', () => {
    const g = { any: [{ type: 'member' as const }, { all: [{ type: 'min_visits' as const, count: 10 }] }] };
    const r = evaluateRules(g, facts());
    expect(r).toHaveLength(1);
    expect(r[0].message).toMatch(/members only.*— or —.*at least 10 visits/i);
    expect(evaluateRules(g, facts({ customer: { id: 'c', paidVisits: 12, isMember: false } }))).toEqual([]);
  });
  it('birthday month, lapsed customers, technicians, time window across midnight', () => {
    expect(evaluateRules({ all: [{ type: 'birthday_month' }] }, facts({ customer: { id: 'c', paidVisits: 1, isMember: false, birthdayMonth: 10 } }))).toEqual([]);
    expect(evaluateRules({ all: [{ type: 'lapsed', days: 60 }] }, facts({ customer: { id: 'c', paidVisits: 1, isMember: false, lastVisitAt: NOW - 10 * 86_400_000 } }))[0].code).toBe('rule_lapsed');
    expect(evaluateRules({ all: [{ type: 'technician_in', technicianIds: ['t9'] }] }, facts({ technicianId: 't9' }))).toEqual([]);
    expect(evaluateRules({ all: [{ type: 'time_between', fromMinute: 22 * 60, toMinute: 13 * 60 }] }, facts())).toEqual([]);
  });
  it('validation refuses unknown types, bad values, deep nesting and too many rules', () => {
    expect(validateRules({ all: [{ type: 'magic' }] })).toEqual(['Unknown rule type "magic".']);
    expect(validateRules({ all: [{ type: 'min_spend', cents: 12.5 }] })).toHaveLength(1);
    expect(validateRules({ all: [{ type: 'day_of_week', days: [7] }] })).toHaveLength(1);
    expect(validateRules({ any: [{ all: [{ any: [{ all: [{ any: [{ type: 'member' }] }] }] }] }] })).toContain('Rules are nested too deeply (at most 4 levels).');
    expect(validateRules({ all: Array.from({ length: 41 }, () => ({ type: 'member' })) })).toContain('Too many rules (at most 40).');
    expect(validateRules({ all: [{ type: 'service_in', serviceIds: ['s'] }], any: [{ type: 'member' }] })).toEqual([]);
  });
});
