import { describe, it, expect } from 'vitest';
import { mapVersionRowToRule, pickLineCommission, resolveFromRules, type PolicyVersionRow } from './compensation-rule-loader';

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

  // mandate §121 (Oct 20 2026): the service row's own rate is the Service level — below an authored Service rule, above
  // authored Category / Branch Default / Salon Default rules (before: ANY authored rule beat it, so a 50 % Salon Default
  // silently overrode the 65 % the owner typed on the Acrylic service)
  describe('§121 service row rate vs authored rules', () => {
    const tenantDefault = { commissionType: 'percent' as const, commissionValue: 50, source: 'Tenant Default' };
    const svcRate = { commission_type: 'percent', commission_value: 65 };
    const resolved = (specificity: number, source: string, value: number) => ({ commissionType: 'percent' as const, commissionValue: value, supplyMethod: 'none', supplyValue: 0, discountFunding: 'proportional', policyId: 'p', policyVersion: 1, source, specificity });
    it('a Salon Default / Branch Default / Category rule does NOT beat the service row rate', () => {
      expect(pickLineCommission(resolved(11, 'Salon Default', 50), svcRate, tenantDefault)).toMatchObject({ commissionValue: 65, source: 'Service default', policyId: null });
      expect(pickLineCommission(resolved(10, 'Branch Default', 52), svcRate, tenantDefault)).toMatchObject({ commissionValue: 65 });
      expect(pickLineCommission(resolved(9, 'Category', 55), svcRate, tenantDefault)).toMatchObject({ commissionValue: 65 });
    });
    it('an authored Service rule, a Branch + Category / Branch + Service rule, a technician rule or a ticket override DOES beat it', () => {
      expect(pickLineCommission(resolved(7, 'Service', 58), svcRate, tenantDefault)).toMatchObject({ commissionValue: 58, source: 'Service' });
      expect(pickLineCommission(resolved(6, 'Branch + Category', 57), svcRate, tenantDefault)).toMatchObject({ commissionValue: 57 });
      expect(pickLineCommission(resolved(5, 'Branch + Service', 54), svcRate, tenantDefault)).toMatchObject({ commissionValue: 54 });
      expect(pickLineCommission(resolved(4, 'Technician Default', 56), svcRate, tenantDefault)).toMatchObject({ commissionValue: 56 });
      expect(pickLineCommission(resolved(1, 'Ticket Override', 70), svcRate, tenantDefault)).toMatchObject({ commissionValue: 70 });
    });
    it('with no service rate the authored rule wins at any level; with nothing authored the service rate, then the tenant default', () => {
      expect(pickLineCommission(resolved(11, 'Salon Default', 50), { commission_type: 'none', commission_value: null }, tenantDefault)).toMatchObject({ commissionValue: 50, source: 'Salon Default' });
      expect(pickLineCommission(null, svcRate, tenantDefault)).toMatchObject({ commissionValue: 65 });
      expect(pickLineCommission(null, null, tenantDefault)).toMatchObject({ commissionValue: 50, source: 'Tenant Default' });
    });
  });
});
