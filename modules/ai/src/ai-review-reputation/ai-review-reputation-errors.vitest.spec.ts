// ai-review-reputation-errors.vitest.spec.ts — the stable error taxonomy → HTTP mapping used by the controller.
import { describe, it, expect } from 'vitest';
import { mapErrorToHttp, errorCode, REPUTATION_ERROR_STATUS } from './ai-review-reputation-errors';

describe('error taxonomy', () => {
  it('maps stable codes to their HTTP status', () => {
    expect(mapErrorToHttp('DRAFT_UNSAFE')).toBe(422);
    expect(mapErrorToHttp('NOT_APPROVED')).toBe(409);
    expect(mapErrorToHttp('REVIEW_NOT_FOUND')).toBe(404);
    expect(mapErrorToHttp('FORBIDDEN')).toBe(403);
    expect(mapErrorToHttp('PUBLISH_FAILED')).toBe(502);
  });
  it('falls back to 500 for unknown codes and normalizes thrown errors', () => {
    expect(mapErrorToHttp('WHATEVER')).toBe(500);
    expect(errorCode(new Error('DRAFT_UNSAFE'))).toBe('DRAFT_UNSAFE');
    expect(errorCode(new Error('boom'))).toBe('INTERNAL_ERROR');
  });
  it('every taxonomy entry is a valid HTTP status', () => {
    expect(Object.values(REPUTATION_ERROR_STATUS).every((v) => v >= 400 && v <= 599)).toBe(true);
  });
});
