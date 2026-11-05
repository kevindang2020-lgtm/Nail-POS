import { describe, it, expect } from 'vitest';
import { API_IDEMPOTENCY } from './idempotency-lifecycle';

describe('API_IDEMPOTENCY', () => {
  it('an inflight key finishes once', () => {
    expect(API_IDEMPOTENCY.can('inflight', 'done')).toBe(true);
    expect(API_IDEMPOTENCY.sourcesOf('done')).toEqual(['inflight']);
  });
  it('a finished reply is never overwritten (done is final) and nothing goes back to inflight', () => {
    expect(API_IDEMPOTENCY.can('done', 'done')).toBe(false);
    expect(API_IDEMPOTENCY.can('done', 'inflight')).toBe(false);
  });
});
