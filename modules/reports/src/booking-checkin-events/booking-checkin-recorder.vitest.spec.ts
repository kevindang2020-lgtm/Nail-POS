// booking-checkin-recorder.vitest.spec.ts — locks the failed-event normalizer defaults/clamps (the row shape the
// pipeline emits). The DB inserts themselves are exercised by the live recorder smoke.
import { describe, it, expect } from 'vitest';
import { normalizeFailedEvent } from './booking-checkin-recorder';

describe('normalizeFailedEvent', () => {
  it('applies store defaults when fields are omitted', () => {
    const e = normalizeFailedEvent({ tenantId: 't1' });
    expect(e.category).toBe('check_in');
    expect(e.failureType).toBe('unknown_error');
    expect(e.retryStatus).toBe('failed');
    expect(e.branchId).toBeNull();
    expect(e.errorMessage).toBeNull();
  });

  it('preserves provided values', () => {
    const e = normalizeFailedEvent({ tenantId: 't1', branchId: 'b1', category: 'api', failureType: 'api_timeout', retryStatus: 'retrying', source: 'online' });
    expect(e).toMatchObject({ tenantId: 't1', branchId: 'b1', category: 'api', failureType: 'api_timeout', retryStatus: 'retrying', source: 'online' });
  });

  it('falls back to unknown_error for a blank failure type', () => {
    expect(normalizeFailedEvent({ tenantId: 't1', failureType: '   ' }).failureType).toBe('unknown_error');
  });

  it('bounds an over-long error message to 500 chars (safe, not unbounded)', () => {
    const e = normalizeFailedEvent({ tenantId: 't1', errorMessage: 'x'.repeat(900) });
    expect(e.errorMessage!.length).toBe(500);
  });
});
