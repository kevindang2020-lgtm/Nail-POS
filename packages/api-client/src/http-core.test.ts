// http-core.test — the transport core every web app's API client uses. Six copies existed; none had a test.
import { describe, it, expect } from 'vitest';
import { buildUrl, assertNoClientTenant, normalizeError, isEmptyState } from './index';

describe('buildUrl', () => {
  it('joins base and path with exactly one slash', () => {
    expect(buildUrl('https://api.x.com/', 'customers')).toBe('https://api.x.com/customers');
    expect(buildUrl('https://api.x.com//', '/customers')).toBe('https://api.x.com/customers');
    expect(buildUrl('', '/customers')).toBe('/customers');                       // same-origin
  });
  it('drops undefined, null and empty query values; encodes the rest', () => {
    expect(buildUrl('', '/x', { a: 1, b: undefined, c: null, d: '', e: 'a b&c' })).toBe('/x?a=1&e=a%20b%26c');
    expect(buildUrl('', '/x', {})).toBe('/x');
  });
  it('keeps 0 and false — they are values, not absence', () => {
    expect(buildUrl('', '/x', { page: 0, active: false })).toBe('/x?page=0&active=false');
  });
});

describe('assertNoClientTenant — the client never chooses its tenant (Constitution 12 §323)', () => {
  it.each(['tenantId', 'branchId', 'tenant_id', 'branch_id'])('refuses a body carrying %s', (k) => {
    expect(() => assertNoClientTenant({ [k]: 'x' })).toThrow(/server derives tenant context/);
  });
  it('allows ordinary bodies and no body', () => {
    expect(() => assertNoClientTenant({ name: 'Ann', customerId: 'c1' })).not.toThrow();
    expect(() => assertNoClientTenant(undefined)).not.toThrow();
  });
  it('checks OWN keys only — an inherited property is not the client sending it', () => {
    expect(() => assertNoClientTenant(Object.create({ tenantId: 'x' }))).not.toThrow();
  });
});

describe('normalizeError', () => {
  it('uses the server code and message when present', () => {
    expect(normalizeError(422, { code: 'INVALID', message: 'Bad phone' })).toMatchObject({ status: 422, code: 'INVALID', message: 'Bad phone' });
  });
  it('falls back to readable defaults by status', () => {
    expect(normalizeError(401, null)).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Please sign in again.' });
    expect(normalizeError(403, {})).toMatchObject({ code: 'FORBIDDEN', message: 'You do not have permission to do that.' });
    expect(normalizeError(503, 'not json')).toMatchObject({ code: 'ERROR', message: 'Something went wrong. Please try again.' });
    expect(normalizeError(404, {})).toMatchObject({ message: 'Request failed.' });
  });
  it('KEEPS the rest of the body in details — a 428 phone-verification error must carry what the customer needs', () => {
    // The five copies that dropped `details` made this error structurally unusable; the merged core keeps it.
    const e = normalizeError(428, { code: 'phone_verification_required', message: 'Verify your phone', bookingSessionId: 'bs_1', maskedPhone: '***0142' });
    expect(e.details).toEqual({ bookingSessionId: 'bs_1', maskedPhone: '***0142' });
    expect(e.details).not.toHaveProperty('code'); expect(e.details).not.toHaveProperty('message');
  });
});

describe('isEmptyState', () => {
  it('empty or missing lists are an empty state, not an error', () => {
    expect(isEmptyState([])).toBe(true); expect(isEmptyState(null)).toBe(true); expect(isEmptyState(undefined)).toBe(true); expect(isEmptyState([1])).toBe(false);
  });
  it('super-admin paths may carry tenantId / branchId (the platform manages tenants); auth paths may carry branchId only', () => {
    expect(() => assertNoClientTenant({ tenantId: 't1', branchId: 'b1' }, '/super-admin/tenants/t1/support-session')).not.toThrow();
    expect(() => assertNoClientTenant({ branchId: 'b1' }, '/auth/login')).not.toThrow();
    expect(() => assertNoClientTenant({ tenantId: 't1' }, '/auth/login')).toThrow(/server derives/);
    expect(() => assertNoClientTenant({ tenantId: 't1' }, '/pos/tickets')).toThrow(/server derives/);
  });
});

describe('normalizeError reads the Constitution 5 envelope first', () => {
  it('error.{code,message} win; the top-level twins are the fallback; the envelope stays in details for callers that want action', () => {
    const e = normalizeError(409, { code: 'old', message: 'old msg', error: { code: 'VERSION_CONFLICT', message: 'Someone else changed this.', details: { currentVersion: 3 }, action: 'REFRESH' } });
    expect(e.code).toBe('VERSION_CONFLICT'); expect(e.message).toBe('Someone else changed this.');
    expect((e.details as any).error.action).toBe('REFRESH');
    expect(normalizeError(400, { code: 'pin_not_set', message: 'Set a PIN.' })).toMatchObject({ code: 'pin_not_set', message: 'Set a PIN.' });
    expect(normalizeError(401, { error: 'Unauthorized' }).code).toBe('UNAUTHENTICATED');   // Nest's old status-text string is not an envelope
  });
});


describe('idempotency keys for money actions (Constitution 5 §61–66)', () => {
  it('newIdempotencyKey is unique and passes the server pattern', async () => {
    const { newIdempotencyKey } = await import('./http-core');
    const a = newIdempotencyKey(); const b = newIdempotencyKey();
    expect(a).not.toBe(b); expect(a).toMatch(/^[A-Za-z0-9_\-:.]{8,200}$/);
  });
  it('same action + same details → same key (a retry); changed details → new key; done → the next action gets its own', async () => {
    const { createIntentKeys } = await import('./http-core');
    let n = 0; const k = createIntentKeys(() => 'k' + ++n);
    const first = k.keyFor('refund:p1', { reason: 'x', amountCents: 2000 });
    expect(k.keyFor('refund:p1', { amountCents: 2000, reason: 'x' })).toBe(first);          // key order irrelevant
    expect(k.keyFor('refund:p2', { reason: 'x', amountCents: 2000 })).not.toBe(first);       // another payment
    const corrected = k.keyFor('refund:p1', { reason: 'x', amountCents: 1500 });
    expect(corrected).not.toBe(first);                                                        // corrected amount = new request
    expect(k.keyFor('refund:p1', { reason: 'x', amountCents: 1500 })).toBe(corrected);
    k.done('refund:p1');
    expect(k.keyFor('refund:p1', { reason: 'x', amountCents: 1500 })).not.toBe(corrected);   // the NEXT refund is its own action
  });
});

describe('normalizeError — the action an app should take (Constitution 5 §221)', () => {
  it("uses the server's error.action when it is a known action", () => {
    expect(normalizeError(409, { error: { code: 'VERSION_CONFLICT', message: 'x', action: 'REFRESH' } }).action).toBe('REFRESH');
  });
  it("the server's action wins over the registry's default for that code", () => {
    expect(normalizeError(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'x', action: 'CONTACT_MANAGER' } }).action).toBe('CONTACT_MANAGER');
  });
  it('derives the action from a registered code when the server sent none (an older server)', () => {
    expect(normalizeError(409, { code: 'VERSION_CONFLICT', message: 'x' }).action).toBe('REFRESH');
    expect(normalizeError(401, { error: { code: 'AUTH_REQUIRED', message: 'x' } }).action).toBe('REAUTHENTICATE');
  });
  it('a legacy unregistered code falls back on the status — a 401 still means sign in again', () => {
    expect(normalizeError(401, {}).action).toBe('REAUTHENTICATE');                       // code defaults to "UNAUTHENTICATED"
    expect(normalizeError(409, { code: 'stale_record', message: 'old' }).action).toBe(normalizeError(409, { code: 'CONFLICT' }).action);
  });
  it('an action the client does not know is ignored, never passed through', () => {
    expect(normalizeError(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'x', action: 'FORMAT_DISK' } }).action).toBe('RETRY');
  });
});
