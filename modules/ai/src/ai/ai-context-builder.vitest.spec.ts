// ai-context-builder.vitest.spec — Constitution 10 §55–§62.
import { describe, it, expect } from 'vitest';
import { buildContext, classifyFieldName, redactText, pseudonym, ProhibitedAiDataError, type ContextField } from './ai-context-builder';

const F = (name: string, value: unknown, dataClass: ContextField['dataClass'] = 'BUSINESS_INTERNAL', extra: Partial<ContextField> = {}): ContextField => ({ name, value, dataClass, maxChars: 500, ...extra });
const opts = { maxTotalChars: 4000 };

describe('§60 PROHIBITED data is refused by field NAME before any provider exists', () => {
  it.each(['password', 'Password', 'user_password', 'pwd', 'otp', 'one_time_code', 'mfa_secret', 'cvv', 'CVC2', 'card_number', 'pan', 'auth_token', 'accessToken', 'refresh-token', 'api_key', 'apiKey', 'client_secret', 'private_key', 'db_password', 'connection_string', 'stripe_token', 'merchant_secret'])('%s', (name) => {
    expect(classifyFieldName(name)).toBe('PROHIBITED');
    expect(() => buildContext('t1', [F(name, 'x', 'PUBLIC')], opts)).toThrow(ProhibitedAiDataError);
  });
  it('cannot be laundered by declaring a friendly class', () => {
    expect(() => buildContext('t1', [F('cvv', '123', 'PUBLIC')], opts)).toThrow(/PROHIBITED AI data/);
  });
  it('declared PROHIBITED or SECURITY_SENSITIVE is refused even with an innocent name', () => {
    expect(() => buildContext('t1', [F('note', 'x', 'PROHIBITED')], opts)).toThrow(ProhibitedAiDataError);
    expect(() => buildContext('t1', [F('note', 'x', 'SECURITY_SENSITIVE')], opts)).toThrow(ProhibitedAiDataError);
  });
  it('ordinary names are not misclassified', () => {
    for (const n of ['review_text', 'salon_name', 'service', 'total_cents', 'customer_id', 'display_name', 'passport_number_last4']) expect(classifyFieldName(n), n).not.toBe('PROHIBITED');
  });
  it('the error is a 500 with the §60 code — a programming error, never blamed on the user', () => {
    try { buildContext('t1', [F('otp', '1')], opts); } catch (e) { expect((e as ProhibitedAiDataError).status).toBe(500); expect((e as ProhibitedAiDataError).code).toBe('AI_PROHIBITED_DATA'); }
  });
});

describe('§61 FINANCIAL_SENSITIVE is masked unless the workflow is approved', () => {
  it('bank account → last 4 by default; full value only with financialWorkflowApproved', () => {
    expect(buildContext('t1', [F('bank_account', '000123456789')], opts).values.bank_account).toBe('…6789');
    expect(buildContext('t1', [F('bank_account', '000123456789')], { ...opts, financialWorkflowApproved: true }).values.bank_account).toBe('000123456789');
    expect(classifyFieldName('routing_number')).toBe('FINANCIAL_SENSITIVE');
  });
});

describe('§62 free-text redaction', () => {
  it('masks a Luhn-valid card number but not an order number of similar length', () => {
    const r = redactText('Paid with 4111 1111 1111 1111, order 1234 5678 9012 3456 thanks');
    expect(r.text).toMatch(/\[CARD…1111\]/);
    expect(r.text).toMatch(/order 1234 5678 9012 3456/);      // fails Luhn → untouched
    expect(r.redactions.CARD).toBe(1);
  });
  it('masks SSN shapes, stated auth codes, API keys, bearer tokens', () => {
    const r = redactText('ssn 123-45-6789; your OTP is 482913; key sk_live_abcdefghijklmnopqrstuvwx; Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc');
    expect(r.text).not.toMatch(/123-45-6789|482913|sk_live_abcdefghijklmnopqrstuvwx|eyJhbGci/);
    expect(r.text).toMatch(/\[GOV_ID\]/); expect(r.text).toMatch(/OTP is \[AUTH_CODE\]/); expect(r.text).toMatch(/\[KEY\]/); expect(r.text).toMatch(/\[BEARER\]/);
  });
  it('email and phone are redacted by default and kept when the task allows them', () => {
    const t = 'call me at (856) 555-0142 or jo@example.com';
    expect(redactText(t).text).toBe('call me at [PHONE] or [EMAIL]');
    expect(redactText(t, ['PHONE', 'EMAIL']).text).toBe(t);
  });
  it('a review with nothing sensitive is untouched', () => {
    const t = 'Great gel set, lasted 3 weeks. 5 stars.';
    expect(redactText(t)).toEqual({ text: t, redactions: {} });
  });
});

describe('§56–§58 the builder', () => {
  it('produces only declared fields, with a manifest that names classes and counts but never values', () => {
    const b = buildContext('t1', [F('review_text', 'my card 4111111111111111 was charged twice', 'CUSTOMER_PII', { untrusted: true }), F('salon_name', 'Lotus', 'PUBLIC')], opts);
    expect(Object.keys(b.values)).toEqual(['review_text', 'salon_name']);
    expect(b.values.review_text).toMatch(/\[CARD…1111\]/);
    expect(b.manifest[0]).toMatchObject({ name: 'review_text', dataClass: 'CUSTOMER_PII', redactions: { CARD: 1 }, truncated: false });
    expect(JSON.stringify(b.manifest)).not.toMatch(/4111|Lotus/);
  });
  it('§58 pseudonymizes PII the task can do without — stable within a tenant, different across tenants', () => {
    const a = buildContext('t1', [F('customer_email', 'jo@example.com', 'CUSTOMER_PII', { pseudonymize: true })], opts).values.customer_email as string;
    const b = buildContext('t1', [F('customer_email', 'jo@example.com', 'CUSTOMER_PII', { pseudonymize: true })], opts).values.customer_email as string;
    const c = buildContext('t2', [F('customer_email', 'jo@example.com', 'CUSTOMER_PII', { pseudonymize: true })], opts).values.customer_email as string;
    expect(a).toBe(b); expect(a).not.toBe(c); expect(a).toMatch(/^customer_email#[0-9a-f]{10}$/); expect(a).not.toMatch(/example/);
    expect(pseudonym('t', 'k', 'v')).toBe(pseudonym('t', 'k', 'v'));
  });
  it('§57 truncates an over-budget string, REFUSES an over-budget object (a truncated JSON is a lie)', () => {
    const b = buildContext('t1', [F('transcript', 'x'.repeat(2000), 'CUSTOMER_PII', { maxChars: 100 })], opts);
    expect((b.values.transcript as string).length).toBeLessThan(120); expect(b.manifest[0].truncated).toBe(true);
    expect(() => buildContext('t1', [F('customers', Array.from({ length: 200 }, (_, i) => ({ id: i, name: 'n' })), 'CUSTOMER_PII', { maxChars: 100 })], opts)).toThrow(/truncated JSON is a lie/);
  });
  it('§57 refuses a context that exceeds the total ceiling', () => {
    // per-field budgets must be wide enough that the TOTAL is what trips — the first draft left them at 500 and both got truncated first
    expect(() => buildContext('t1', [F('a', 'x'.repeat(3000), 'PUBLIC', { maxChars: 5000 }), F('b', 'y'.repeat(3000), 'PUBLIC', { maxChars: 5000 })], { maxTotalChars: 4000 })).toThrow(/exceeds 4000 chars at field "b"/);
  });
  it('§7 refuses to build without a tenant', () => { expect(() => buildContext('', [], opts)).toThrow(/requires a tenantId/); });
});
