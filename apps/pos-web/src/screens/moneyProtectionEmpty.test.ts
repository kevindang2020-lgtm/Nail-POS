import { describe, it, expect } from 'vitest';
import { alertsEmpty } from './MoneyProtectionWorkspace';

const base = { status: 'open', severity: 'all', category: 'all' };
describe('Money Protection alerts — which empty it is', () => {
  it('filters first, then the monitor state', () => {
    expect(alertsEmpty({ ...base, q: 'x' }, {}, { monitor: { state: 'current' } })).toMatch(/Nothing matches/);
    expect(alertsEmpty({ ...base, severity: 'HIGH' }, {}, null)).toMatch(/Nothing matches/);
    expect(alertsEmpty(base, {}, { monitor: { state: 'module_off' } })).toMatch(/turned off/);
    expect(alertsEmpty(base, {}, { monitor: { state: 'never_checked' } })).toMatch(/never run/);
    expect(alertsEmpty(base, {}, { monitor: { state: 'last_run_failed' } })).toMatch(/failed/);
    expect(alertsEmpty(base, {}, { monitor: { state: 'stale', lastSuccessAt: '2026-11-01T12:00:00Z' } })).toMatch(/No successful detection pass since/);
    expect(alertsEmpty(base, {}, { monitor: { state: 'current', lastSuccessAt: '2026-11-11T12:00:00Z', lastEvaluated: 0 } })).toMatch(/no payment data/);
    expect(alertsEmpty(base, {}, { monitor: { state: 'current', lastSuccessAt: '2026-11-11T12:00:00Z', lastEvaluated: 42 } })).toMatch(/checked 42 records/);
  });
});
