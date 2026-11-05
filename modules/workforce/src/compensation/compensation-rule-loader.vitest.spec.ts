import { describe, it, expect } from 'vitest';
import {
  mapVersionRowToRule,
  resolveFromRules,
  pickLineCommission,
  RULE_SOURCE_SERVICE_DEFAULT,
  RULE_SOURCE_TENANT_DEFAULT,
  type PolicyVersionRow,
} from './compensation-rule-loader';

const row = (over: Partial<PolicyVersionRow> = {}): PolicyVersionRow => ({
  policy_id: 'p1', version_id: 'v1', version: 1, branch_id: null, technician_id: null, service_id: null,
  service_category: null, ticket_id: null, commission_type: 'percent', commission_value: 60,
  supply_method: 'none', supply_value: 0, discount_funding: 'proportional',
  effective_start: '2026-01-01T00:00:00Z', effective_end: null, approved: true, ...over,
});
const T = 't1';

describe('mapVersionRowToRule', () => {
  it('maps a version row to the resolver rule shape', () => {
    const r = mapVersionRowToRule(T, row({ technician_id: 'tech1', service_id: 'svc1', commission_value: 65 }));
    expect(r).toMatchObject({ tenantId: 't1', policyId: 'p1', version: 1, technicianId: 'tech1', serviceId: 'svc1', commission: { type: 'percent', value: 65 } });
  });
  it('handles Date effective values + fixed type', () => {
    const r = mapVersionRowToRule(T, row({ commission_type: 'fixed', commission_value: 2500, effective_start: new Date('2026-01-01T00:00:00Z') }));
    expect(r.commission).toEqual({ type: 'fixed', value: 2500 });
    expect(r.effectiveStart).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('resolveFromRules', () => {
  const rules = [
    mapVersionRowToRule(T, row({ policy_id: 'tenant', version_id: 'r_tenant', commission_value: 60 })),                                                  // Salon Default (rank 7)
    mapVersionRowToRule(T, row({ policy_id: 'bsvc', version_id: 'r_bsvc', branch_id: 'b1', service_id: 'svc1', commission_value: 55 })),                 // Branch + Service (rank 5)
    mapVersionRowToRule(T, row({ policy_id: 'ts', version_id: 'r_ts', technician_id: 'tech1', service_id: 'svc1', commission_value: 70 })),              // Technician + Service (rank 2)
  ];

  it('picks the most specific matching rule (technician + service) with provenance', () => {
    const got = resolveFromRules(rules, { tenantId: T, technicianId: 'tech1', serviceId: 'svc1', branchId: 'b1', serviceCategory: 'nails' });
    expect(got).toMatchObject({ commissionType: 'percent', commissionValue: 70, source: 'Technician + Service', policyId: 'ts' });
  });
  it('falls through to Branch + Service when the technician has no rule', () => {
    const got = resolveFromRules(rules, { tenantId: T, technicianId: 'tech2', serviceId: 'svc1', branchId: 'b1', serviceCategory: 'nails' });
    expect(got).toMatchObject({ commissionValue: 55, source: 'Branch + Service' });
  });
  it('falls through to Salon Default when nothing more specific matches', () => {
    const got = resolveFromRules(rules, { tenantId: T, technicianId: 'tech2', serviceId: 'svc2', branchId: 'b1', serviceCategory: 'nails' });
    expect(got).toMatchObject({ commissionValue: 60, source: 'Salon Default' });
  });
  it('returns null when the tenant has no rules (caller uses service-default fallback)', () => {
    expect(resolveFromRules([], { tenantId: T, technicianId: 'tech1', serviceId: 'svc1' })).toBeNull();
  });
  it('ignores a rule that is not yet effective (as-of resolution keeps history stable)', () => {
    const future = [mapVersionRowToRule(T, row({ policy_id: 'future', version_id: 'r_future', effective_start: '2099-01-01T00:00:00Z', commission_value: 90 }))];
    expect(resolveFromRules(future, { tenantId: T, serviceId: 'svc1', asOf: '2026-06-01T00:00:00Z' })).toBeNull();
  });
});

describe('pickLineCommission (§121 precedence)', () => {
  const tenantDefault = { commissionType: 'percent' as const, commissionValue: 50, source: RULE_SOURCE_TENANT_DEFAULT };

  it('service row rate outranks an authored Salon Default rule', () => {
    const resolvedDefault = { commissionType: 'percent' as const, commissionValue: 40, supplyMethod: 'none', supplyValue: 0, discountFunding: 'proportional', policyId: 'pDef', policyVersion: 1, source: 'Salon Default' };
    const serviceRate = { commission_type: 'percent', commission_value: 60 };
    const picked = pickLineCommission(resolvedDefault, serviceRate, tenantDefault);
    expect(picked.commissionValue).toBe(60);
    expect(picked.source).toBe(RULE_SOURCE_SERVICE_DEFAULT);
  });

  it('service row rate outranks an authored Salon Category rule', () => {
    const resolvedCat = { commissionType: 'percent' as const, commissionValue: 45, supplyMethod: 'none', supplyValue: 0, discountFunding: 'proportional', policyId: 'pCat', policyVersion: 1, source: 'Salon Category' };
    const serviceRate = { commission_type: 'percent', commission_value: 65 };
    const picked = pickLineCommission(resolvedCat, serviceRate, tenantDefault);
    expect(picked.commissionValue).toBe(65);
    expect(picked.source).toBe(RULE_SOURCE_SERVICE_DEFAULT);
  });

  it('authored Salon Service rule outranks the service row rate', () => {
    const resolvedSvc = { commissionType: 'percent' as const, commissionValue: 70, supplyMethod: 'none', supplyValue: 0, discountFunding: 'proportional', policyId: 'pSvc', policyVersion: 1, source: 'Salon Service' };
    const serviceRate = { commission_type: 'percent', commission_value: 60 };
    const picked = pickLineCommission(resolvedSvc, serviceRate, tenantDefault);
    expect(picked.commissionValue).toBe(70);
    expect(picked.source).toBe('Salon Service');
  });

  it('falls back to tenant default when neither authored rule nor service rate exists', () => {
    const picked = pickLineCommission(null, null, tenantDefault);
    expect(picked.commissionValue).toBe(50);
    expect(picked.source).toBe(RULE_SOURCE_TENANT_DEFAULT);
  });
});
