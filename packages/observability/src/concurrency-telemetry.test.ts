import { describe, it, expect } from 'vitest';
import { concurrencyConflicts, recordConflict } from './concurrency-telemetry';

describe('concurrency conflict telemetry (Smooth Refresh spec §100)', () => {
  it('counts refused writes by module and stable code', () => {
    const val = (m: string, c: string) => concurrencyConflicts.snapshot().find((e) => e.labels.module === m && e.labels.code === c)?.value ?? 0;
    const b0 = val('booking', 'APPOINTMENT_CONFLICT'); const c0 = val('customers', 'VERSION_CONFLICT');
    recordConflict('booking', 'APPOINTMENT_CONFLICT'); recordConflict('booking', 'APPOINTMENT_CONFLICT'); recordConflict('customers', 'VERSION_CONFLICT');
    expect(val('booking', 'APPOINTMENT_CONFLICT') - b0).toBe(2);
    expect(val('customers', 'VERSION_CONFLICT') - c0).toBe(1);
  });
  it('never throws (a telemetry failure must not turn a clean 409 into a 500)', () => {
    expect(() => recordConflict(undefined as any, null as any)).not.toThrow();
  });
});
