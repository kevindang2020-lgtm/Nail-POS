import { describe, it, expect } from 'vitest';
import { checkCompliance, type ComplianceInput } from './compensation-compliance';

const base: ComplianceInput = { classification: 'employee', periodPayCents: 0, hoursWorked: 0, minHourlyWageCents: 1500, overtimeThresholdHours: 40 };

describe('checkCompliance (§18) — minimum wage applies to employees only', () => {
  it('flags an employee whose effective hourly is below minimum wage, with the shortfall', () => {
    // $300 over 40h = $7.50/h, below $15.00 min
    const flags = checkCompliance({ ...base, periodPayCents: 30000, hoursWorked: 40 });
    const wage = flags.find((f) => f.code === 'below_minimum_wage')!;
    expect(wage).toBeTruthy();
    expect(wage.effectiveHourlyCents).toBe(750);
    expect(wage.shortfallCents).toBe(30000); // (1500-750)*40
  });

  it('does NOT flag an employee at or above minimum wage', () => {
    // $700 over 40h = $17.50/h
    expect(checkCompliance({ ...base, periodPayCents: 70000, hoursWorked: 40 }).some((f) => f.code === 'below_minimum_wage')).toBe(false);
  });

  it('does NOT apply minimum wage to a contractor', () => {
    expect(checkCompliance({ ...base, classification: 'contractor', periodPayCents: 30000, hoursWorked: 40 })).toHaveLength(0);
  });

  it('does NOT apply minimum wage to a booth renter', () => {
    expect(checkCompliance({ ...base, classification: 'booth_renter', periodPayCents: 10000, hoursWorked: 40 })).toHaveLength(0);
  });

  it('skips the wage check when no minimum is configured or hours are zero', () => {
    expect(checkCompliance({ ...base, minHourlyWageCents: 0, periodPayCents: 30000, hoursWorked: 40 }).some((f) => f.code === 'below_minimum_wage')).toBe(false);
    expect(checkCompliance({ ...base, periodPayCents: 30000, hoursWorked: 0 }).some((f) => f.code === 'below_minimum_wage')).toBe(false);
  });
});

describe('checkCompliance — overtime (employees only)', () => {
  it('flags hours over the overtime threshold', () => {
    const ot = checkCompliance({ ...base, periodPayCents: 100000, hoursWorked: 46 }).find((f) => f.code === 'overtime_hours')!;
    expect(ot).toBeTruthy();
    expect(ot.overtimeHours).toBe(6);
  });

  it('does not flag overtime at or under the threshold', () => {
    expect(checkCompliance({ ...base, periodPayCents: 100000, hoursWorked: 40 }).some((f) => f.code === 'overtime_hours')).toBe(false);
  });

  it('never raises wage/overtime flags for a contractor even over the threshold', () => {
    expect(checkCompliance({ ...base, classification: 'contractor', periodPayCents: 100000, hoursWorked: 60 })).toHaveLength(0);
  });
});
