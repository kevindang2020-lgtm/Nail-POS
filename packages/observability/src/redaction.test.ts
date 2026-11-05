// redaction.vitest.spec — Constitution 11 §28/§274: "intentionally send sensitive fields through and verify they
// are removed." Every prohibited key is iterated from the exported list, so adding a key to the list adds a test.
import { describe, it, expect } from 'vitest';
import { redact, REDACTED, SECRET_KEYS, PII_KEYS, AI_CONTENT_KEYS, maskValueSecrets } from './redaction';

describe('§22 every prohibited KEY is removed, at any depth and any casing', () => {
  for (const key of SECRET_KEYS) {
    it(`"${key}" is redacted`, () => {
      const out = redact({ [key]: 'hunter2', nested: { deeper: { [key]: 'hunter2' } }, list: [{ [key]: 'hunter2' }] }) as any;
      expect(out[key]).toBe(REDACTED);
      expect(out.nested.deeper[key]).toBe(REDACTED);
      expect(out.list[0][key]).toBe(REDACTED);
      expect(JSON.stringify(out)).not.toContain('hunter2');
    });
  }
  it('camelCase / UPPER / prefixed variants are caught (Authorization, X-Api-Key, twilioAuthToken)', () => {
    const out = redact({ Authorization: 'Bearer abc', 'X-Api-Key': 'k', twilioAuthToken: 't', user_password: 'p', REFRESH_TOKEN: 'r' }) as any;
    for (const k of Object.keys(out)) expect(out[k], k).toBe(REDACTED);
  });
});

describe('§22 secrets by VALUE, where no key identifies them', () => {
  it('a JWT inside a message is masked', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(maskValueSecrets(`token was ${jwt} ok`)).not.toContain(jwt);
  });
  it('a bearer header value is masked but the scheme is kept', () => {
    expect(maskValueSecrets('Authorization: Bearer abcdefghijklmnop123')).toBe(`Authorization: Bearer ${REDACTED}`);
  });
  it('a card number (Luhn-valid) becomes ****last4 — §23', () => {
    expect(maskValueSecrets('card 4242424242424242 declined')).toBe('card ****4242 declined');
    expect(maskValueSecrets('4111 1111 1111 1111')).toBe('****1111');
  });
  it('a 16-digit NON-card number (fails Luhn) is left alone — order numbers and timestamps must survive', () => {
    expect(maskValueSecrets('order 1234567890123456')).toBe('order 1234567890123456');
  });
});

describe('§24 PII is MASKED, not removed — a masked value still identifies the record for support', () => {
  for (const key of PII_KEYS) {
    it(`"${key}" is masked`, () => {
      const out = redact({ [key]: /email/.test(key) ? 'ada.rowe@example.com' : '+1 (555) 010-1234' }) as any;
      expect(out[key]).not.toContain('ada.rowe');
      expect(out[key]).not.toContain('555');
      expect(out[key]).toMatch(/\*\*\*/);
    });
  }
  it('email keeps the first letter and the domain', () => expect((redact({ email: 'ada@example.com' }) as any).email).toBe('a***@example.com'));
  it('phone keeps the last four', () => expect((redact({ phone: '+15550101234' }) as any).phone).toBe('***1234'));
});

describe('§26 AI content is never logged automatically', () => {
  for (const key of AI_CONTENT_KEYS) {
    it(`"${key}" is omitted`, () => expect((redact({ [key]: 'Dear Jane, your appointment…' }) as any)[key]).toBe('[AI_CONTENT_OMITTED]'));
  }
});

describe('§33 the fields operations SEARCH BY must survive — over-redaction is a real failure', () => {
  it('error_code, status_code, zip_code, tenant_code, reason_code are untouched', () => {
    const src = { error_code: 'BOOKING_CONFLICT', status_code: 409, zip_code: '08109', tenant_code: 'MERCH1', reason_code: 'slot_taken', promo_code: 'SPRING10' };
    expect(redact(src)).toEqual(src);
  });
  it('ids and identifiers survive', () => {
    const src = { requestId: 'req_01J', correlationId: 'corr_1', tenantId: 't1', customer_id: 'c1', transaction_id: 'tx_9', token_count: 512 };
    expect(redact(src)).toEqual(src);
  });
  it('bypass and time_track are not "pass"/"track"', () => {
    expect(redact({ bypass: true, time_track: 'x' })).toEqual({ bypass: true, time_track: 'x' });
  });
});

describe('it never throws — a redactor that throws leads someone to log the raw object instead', () => {
  it('circular structures', () => { const a: any = { password: 'x' }; a.self = a; const out = redact(a) as any; expect(out.password).toBe(REDACTED); expect(out.self).toBe('[CIRCULAR]'); });
  it('Error objects keep name/message, mask secrets in the message, and keep the stack for the server log', () => {
    const out = redact(new Error('Bearer abcdefghijklmnop failed')) as any;
    expect(out.name).toBe('Error'); expect(out.message).not.toContain('abcdefghijklmnop'); expect(typeof out.stack).toBe('string');
  });
  it('very deep objects are truncated, not stack-overflowed', () => {
    let o: any = { password: 'x' }; for (let i = 0; i < 40; i++) o = { child: o };
    expect(() => redact(o)).not.toThrow();
  });
  it('primitives pass through', () => { expect(redact(42)).toBe(42); expect(redact(null)).toBeNull(); expect(redact(undefined)).toBeUndefined(); });
});
