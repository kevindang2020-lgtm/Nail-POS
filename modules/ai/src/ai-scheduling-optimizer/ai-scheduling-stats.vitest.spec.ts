// ai-scheduling-stats.vitest.spec.ts — robust duration stats over valid records only (median/percentiles/trimmed-mean/
// outliers, never a plain average alone), utilization on eligible time, and the controlled duration hierarchy where
// historical data never auto-overrides approved configuration.
import { describe, it, expect } from 'vitest';
import { validDurations, robustDurationStats, suggestDuration, resolveDuration, type DurationRecord } from './ai-scheduling-stats';

describe('valid records + robust stats', () => {
  it('excludes untrustworthy records and computes robust statistics', () => {
    const recs: DurationRecord[] = [{ actualMin: 60, completed: true }, { actualMin: 65, completed: true }, { actualMin: 55, completed: true }, { actualMin: 9999, completed: true, corrupted: true }, { actualMin: 1, completed: false }, { actualMin: 60, completed: true, isTest: true }, { actualMin: 70, completed: true, canceled: true }, { actualMin: 62, completed: true, manuallyEdited: true }];
    expect(validDurations(recs)).toHaveLength(3);
    const st = robustDurationStats([50, 52, 55, 54, 53, 51, 56, 50, 200]);
    expect(st.p25).toBeLessThanOrEqual(st.median);
    expect(st.median).toBeLessThanOrEqual(st.p75);
    expect(st.outliers).toContain(200);
    expect(st.trimmedMean).toBeLessThan([50, 52, 55, 54, 53, 51, 56, 50, 200].reduce((a, b) => a + b, 0) / 9);
    expect(robustDurationStats([]).n).toBe(0);
  });
});

describe('duration suggestions (advisory)', () => {
  const longer = robustDurationStats([70, 72, 71, 73, 69, 74, 72, 71, 70, 73]);
  it('suggests but never auto-applies', () => {
    expect(suggestDuration(60, longer).action).toBe('increase');
    expect(suggestDuration(60, robustDurationStats([70, 72, 71])).reason).toBe('insufficient_sample');
    expect(suggestDuration(60, robustDurationStats([40, 90, 45, 95, 42, 88, 47, 91, 44, 89])).action).toBe('add_buffer');
    expect(suggestDuration(72, longer).action).toBe('keep');
  });
});

describe('duration hierarchy', () => {
  it('respects precedence and never returns a historical source', () => {
    expect(resolveDuration({ appointmentOverrideMin: 45, technicianSpecificMin: 50, tenantTemplateMin: 60 }).source).toBe('appointment_override');
    expect(resolveDuration({ technicianSpecificMin: 50, tenantTemplateMin: 60 }).source).toBe('technician_specific');
    expect(resolveDuration({ branchSpecificMin: 55, tenantTemplateMin: 60 }).source).toBe('branch_specific');
    expect(resolveDuration({ tenantTemplateMin: 60 }).source).toBe('tenant_template');
    expect(resolveDuration({}).source).toBe('platform_fallback');
  });
});
