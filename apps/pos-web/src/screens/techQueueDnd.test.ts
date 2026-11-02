import { describe, it, expect } from 'vitest';
import { dropEligibility } from './techQueueDnd';

describe('Tech Queue drop eligibility (client gate)', () => {
  it('available technician accepts an immediate assignment', () => {
    expect(dropEligibility('available')).toEqual({ ok: true, mode: 'now' });
  });
  it('finishing-soon technician accepts a queued next assignment', () => {
    expect(dropEligibility('finishing_soon')).toEqual({ ok: true, mode: 'next' });
  });
  it('mid-service / break / off technicians are rejected with a reason', () => {
    expect(dropEligibility('in_service').ok).toBe(false);
    expect(dropEligibility('on_break').ok).toBe(false);
    expect(dropEligibility('off_today').ok).toBe(false);
    expect(dropEligibility('in_service').reason).toMatch(/mid-service/);
  });
  it('unknown status is rejected', () => {
    expect(dropEligibility('zzz').ok).toBe(false);
  });
});
