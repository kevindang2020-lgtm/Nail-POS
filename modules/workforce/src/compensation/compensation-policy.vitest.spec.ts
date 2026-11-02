// compensation-policy.vitest.spec.ts — §4 hierarchy, effective dates / as-of (§5 historical preservation),
// ticket-override approval (§24), and §27 validation.
import { describe, it, expect } from 'vitest';
import { resolvePolicy, validatePolicyRule, type CompensationRule, type ResolveContext } from './compensation-policy';

const R = (over: Partial<CompensationRule>): CompensationRule => ({
  id: 'r', tenantId: 't1', effectiveStart: '2026-01-01', version: 1, policyId: 'p1',
  commission: { type: 'percent', value: 50 }, ...over,
});
const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  tenantId: 't1', branchId: 'b1', technicianId: 'tech1', serviceId: 'svc1', serviceCategory: 'nails',
  ticketId: 'tk1', asOf: '2026-06-26', ...over,
});

describe('compensation policy hierarchy', () => {
  it('§4 most specific wins: ticket > tech+service > tech+category > tech > branch+service > branch > tenant', () => {
    const rules = [
      R({ id: 'tenant', commission: { type: 'percent', value: 50 } }),
      R({ id: 'branch', branchId: 'b1', commission: { type: 'percent', value: 52 } }),
      R({ id: 'branchSvc', branchId: 'b1', serviceId: 'svc1', commission: { type: 'percent', value: 54 } }),
      R({ id: 'tech', technicianId: 'tech1', commission: { type: 'percent', value: 56 } }),
      R({ id: 'techCat', technicianId: 'tech1', serviceCategory: 'nails', commission: { type: 'percent', value: 58 } }),
      R({ id: 'techSvc', technicianId: 'tech1', serviceId: 'svc1', commission: { type: 'percent', value: 60 } }),
      R({ id: 'ticket', ticketId: 'tk1', approved: true, commission: { type: 'percent', value: 70 } }),
    ];
    expect(resolvePolicy(rules, ctx())!.ruleId).toBe('ticket');
    expect(resolvePolicy(rules.filter((r) => r.id !== 'ticket'), ctx())!.ruleId).toBe('techSvc');
    expect(resolvePolicy(rules.filter((r) => !['ticket', 'techSvc'].includes(r.id)), ctx())!.ruleId).toBe('techCat');
    expect(resolvePolicy(rules.filter((r) => !['ticket', 'techSvc', 'techCat'].includes(r.id)), ctx())!.ruleId).toBe('tech');
    expect(resolvePolicy([R({ id: 'tenant' }), R({ id: 'branch', branchId: 'b1' })], ctx())!.ruleId).toBe('branch');
    expect(resolvePolicy([R({ id: 'tenant' })], ctx())!.source).toBe('Salon Default');
  });

  it('§121 mandate precedence: Salon Service > Salon Category > Branch Default > Salon Default', () => {
    const rules = [
      R({ id: 'salonDef', commission: { type: 'percent', value: 40 } }),
      R({ id: 'branchDef', branchId: 'b1', commission: { type: 'percent', value: 45 } }),
      R({ id: 'salonCat', serviceCategory: 'nails', commission: { type: 'percent', value: 50 } }),
      R({ id: 'branchCat', branchId: 'b1', serviceCategory: 'nails', commission: { type: 'percent', value: 55 } }),
      R({ id: 'salonSvc', serviceId: 'svc1', commission: { type: 'percent', value: 60 } }),
      R({ id: 'branchSvc', branchId: 'b1', serviceId: 'svc1', commission: { type: 'percent', value: 65 } }),
    ];
    // With no technicianId in context:
    const baseCtx = ctx({ technicianId: null });
    expect(resolvePolicy(rules, baseCtx)!.ruleId).toBe('branchSvc');
    expect(resolvePolicy(rules.filter((r) => r.id !== 'branchSvc'), baseCtx)!.ruleId).toBe('branchCat');
    expect(resolvePolicy(rules.filter((r) => !['branchSvc', 'branchCat'].includes(r.id)), baseCtx)!.ruleId).toBe('salonSvc');
    expect(resolvePolicy(rules.filter((r) => !['branchSvc', 'branchCat', 'salonSvc'].includes(r.id)), baseCtx)!.ruleId).toBe('salonCat');
    expect(resolvePolicy(rules.filter((r) => !['branchSvc', 'branchCat', 'salonSvc', 'salonCat'].includes(r.id)), baseCtx)!.ruleId).toBe('branchDef');
    expect(resolvePolicy([rules[0]], baseCtx)!.ruleId).toBe('salonDef');
  });

  it('source label reflects the winning level', () => {
    expect(resolvePolicy([R({ id: 'x', technicianId: 'tech1', serviceId: 'svc1' })], ctx())!.source).toBe('Technician + Service');
  });

  it('§24 ticket override applies only when approved', () => {
    const rules = [R({ id: 'tenant', commission: { type: 'percent', value: 50 } }), R({ id: 'tk', ticketId: 'tk1', approved: false, commission: { type: 'percent', value: 70 } })];
    expect(resolvePolicy(rules, ctx())!.ruleId).toBe('tenant'); // unapproved override ignored
    rules[1].approved = true;
    expect(resolvePolicy(rules, ctx())!.ruleId).toBe('tk');
  });

  it('§5 effective dates: a future rule does not change a past ticket (historical preservation)', () => {
    const rules = [
      R({ id: 'old', technicianId: 'tech1', commission: { type: 'percent', value: 60 }, effectiveStart: '2026-01-01', effectiveEnd: '2026-05-31' }),
      R({ id: 'new', technicianId: 'tech1', commission: { type: 'percent', value: 65 }, effectiveStart: '2026-06-01', version: 2 }),
    ];
    expect(resolvePolicy(rules, ctx({ asOf: '2026-04-15' }))!.ruleId).toBe('old'); // a ticket from April
    expect(resolvePolicy(rules, ctx({ asOf: '2026-06-26' }))!.ruleId).toBe('new'); // a ticket from June
  });

  it('ties at a level break to latest effectiveStart then highest version', () => {
    const rules = [
      R({ id: 'v1', technicianId: 'tech1', effectiveStart: '2026-01-01', version: 1 }),
      R({ id: 'v2', technicianId: 'tech1', effectiveStart: '2026-06-01', version: 2 }),
    ];
    expect(resolvePolicy(rules, ctx())!.ruleId).toBe('v2');
  });

  it('returns null when nothing matches (engine then falls back to a default elsewhere)', () => {
    expect(resolvePolicy([R({ id: 'otherTenant', tenantId: 't2' })], ctx())).toBeNull();
  });

  it('§27 validation: split must total 100, percent 0–100, supply ≤ eligible, dates ordered', () => {
    expect(validatePolicyRule({ technicianPercent: 60, salonPercent: 40 }).errors).toHaveLength(0);
    expect(validatePolicyRule({ technicianPercent: 70, salonPercent: 40 }).errors[0]).toMatch(/total 100/);
    expect(validatePolicyRule({ commission: { type: 'percent', value: 120 } }).errors[0]).toMatch(/0–100/);
    expect(validatePolicyRule({ supply: { method: 'fixed', value: 9000 }, serviceEligibleCents: 5000 }).errors[0]).toMatch(/exceeds eligible/);
    expect(validatePolicyRule({ effectiveStart: '2026-06-01', effectiveEnd: '2026-01-01' }).errors[0]).toMatch(/before the start/);
  });

  // mandate §121 (Oct 20 2026): the three scopes the Owner app offers that had NO level — any default rule beat them
  it('§121: Service > Category > Branch Default > Salon Default; Branch + Category sits between Branch + Service and Service', () => {
    const tenant = R({ id: 'tenant', commission: { type: 'percent', value: 50 } });
    const branch = R({ id: 'branch', branchId: 'b1', commission: { type: 'percent', value: 52 } });
    const cat = R({ id: 'cat', serviceCategory: 'nails', commission: { type: 'percent', value: 55 } });
    const svc = R({ id: 'svc', serviceId: 'svc1', commission: { type: 'percent', value: 58 } });
    const branchCat = R({ id: 'branchCat', branchId: 'b1', serviceCategory: 'nails', commission: { type: 'percent', value: 57 } });
    const branchSvc = R({ id: 'branchSvc', branchId: 'b1', serviceId: 'svc1', commission: { type: 'percent', value: 54 } });
    const c = ctx({ ticketId: null, technicianId: null });
    expect(resolvePolicy([tenant, cat], c)).toMatchObject({ ruleId: 'cat', source: 'Category', specificity: 9 });          // before: 'tenant' (rank 7 beat rank 99)
    expect(resolvePolicy([tenant, branch, cat], c)).toMatchObject({ ruleId: 'cat', source: 'Category' });                   // before: 'branch'
    expect(resolvePolicy([tenant, branch, cat, svc], c)).toMatchObject({ ruleId: 'svc', source: 'Service', specificity: 7 });   // before: 'branch'
    expect(resolvePolicy([tenant, branch, cat, svc, branchCat], c)).toMatchObject({ ruleId: 'branchCat', source: 'Branch + Category', specificity: 6 });
    expect(resolvePolicy([tenant, branch, cat, svc, branchCat, branchSvc], c)).toMatchObject({ ruleId: 'branchSvc', source: 'Branch + Service', specificity: 5 });
    expect(resolvePolicy([tenant, branch], c)).toMatchObject({ ruleId: 'branch', source: 'Branch Default', specificity: 10 });
    expect(resolvePolicy([tenant], c)).toMatchObject({ ruleId: 'tenant', source: 'Salon Default', specificity: 11 });
    // a technician-level rule still beats every tenant-wide one
    expect(resolvePolicy([svc, R({ id: 'tech', technicianId: 'tech1' })], ctx({ ticketId: null }))!.ruleId).toBe('tech');
  });
});
