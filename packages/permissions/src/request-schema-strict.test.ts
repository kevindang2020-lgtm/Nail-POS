// request-schema-strict.test.ts — Security Deep Scan §40 / §110: strict mode REFUSES unknown fields (opt-in per schema or
// per call); the default still strips; the provider-webhook envelope keeps every field and refuses only non-objects.
import { describe, it, expect } from 'vitest';
import { S, validateBody } from './request-schema';
import { ValidatedBody, bodyPipeOf } from './guards/validated-body';

const BODY = S.object({ name: S.text(50), device: S.nullable(S.object({ id: S.text(20) })), lines: S.array(S.object({ qty: S.integer() })) });

describe('strict mode', () => {
  it('default: unknown fields are stripped (unchanged behaviour)', () => {
    const r = validateBody(BODY, { name: 'a', extra: 1, device: { id: 'x', model: 'y' } });
    expect(r).toMatchObject({ ok: true, value: { name: 'a', device: { id: 'x' } }, stripped: ['extra', 'device.model'] });
  });
  it('S.strict(schema): unknown fields at the top AND nested are refused with a path, never echoing the value', () => {
    const r = validateBody(S.strict(BODY), { name: 'a', extra: 'secret-value', device: { id: 'x', model: 'y' }, lines: [{ qty: 1, price: 5 }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      { path: 'extra', message: 'is not an allowed field', rule: 'UNKNOWN_FIELD' },
      { path: 'device.model', message: 'is not an allowed field', rule: 'UNKNOWN_FIELD' },
      { path: 'lines[0].price', message: 'is not an allowed field', rule: 'UNKNOWN_FIELD' },
    ]);
    expect(JSON.stringify(r.errors)).not.toContain('secret-value');
  });
  it('strict accepts an exactly-declared body and still drops prototype keys silently', () => {
    const r = validateBody(S.strict(BODY), JSON.parse('{"name":"a","__proto__":{"x":1},"device":null}'));
    expect(r).toMatchObject({ ok: true, value: { name: 'a', device: null } });
  });
  it('per call: validateBody(schema, body, { strict: true }); a nested schema may opt back out with x-strict: false', () => {
    expect(validateBody(BODY, { name: 'a', extra: 1 }, { strict: true }).ok).toBe(false);
    const loose = S.strict(S.object({ meta: { ...S.object({ a: S.text(5) }), 'x-strict': false } }));
    expect(validateBody(loose, { meta: { a: 'x', b: 'y' } })).toMatchObject({ ok: true, value: { meta: { a: 'x' } } });
    expect(validateBody(loose, { other: 1 }).ok).toBe(false);
  });
  it('the dangerous-field refusal still applies (with its own message)', () => {
    const r = validateBody(S.strict(BODY), { tenantId: 't' });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.errors[0]).toEqual({ path: 'tenantId', message: 'may not be set by the client', rule: 'NOT_ALLOWED' });
  });
  it('the Nest pipe: ValidatedBody(schema, { strict: true }) answers 400 VALIDATION_FAILED on an unknown field', () => {
    const pipe = ValidatedBody(BODY, { strict: true });
    expect(() => pipe.transform({ name: 'a', extra: 1 })).toThrow();
    try { pipe.transform({ name: 'a', extra: 1 }); } catch (e: any) { expect(e.getResponse()).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'extra', rule: 'UNKNOWN_FIELD', fields: [{ path: 'extra', rule: 'UNKNOWN_FIELD' }] } }); }
    expect(ValidatedBody(BODY).transform({ name: 'a', extra: 1 })).toEqual({ name: 'a' });
    expect(typeof bodyPipeOf).toBe('function');
  });
});

describe('provider webhook envelope', () => {
  const W = S.webhookEnvelope();
  it('keeps every field exactly (a re-serialised signature fallback still matches) — including authority-looking names', () => {
    const body = { event: 'charge.succeeded', data: { id: 'ch_1', amount: 500 }, tenant_id: 'merchant-side-id', merchantId: 'm1' };
    const r = validateBody(W, body);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.value)).toBe(JSON.stringify(body));
  });
  it('accepts a batch array and an empty body; refuses a scalar', () => {
    expect(validateBody(W, [{ a: 1 }]).ok).toBe(true);
    expect(validateBody(W, undefined)).toMatchObject({ ok: true, value: {} });
    expect(validateBody(W, 'not-json-object').ok).toBe(false);
    expect(validateBody(W, 42).ok).toBe(false);
  });
});

describe('bounded open schemas (x-maxDepth / x-maxNodes, §40 reviewed exceptions)', () => {
  const B = S.bounded(S.webhookEnvelope(), 4, 10);
  it('keeps a value within both bounds whole', () => {
    const body = { a: { b: { c: 1 } }, d: [1, 2] };
    expect(validateBody(B, body)).toMatchObject({ ok: true, value: body });
  });
  it('refuses nesting deeper than maxDepth', () => {
    const r = validateBody(B, { a: { b: { c: { d: { e: 1 } } } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ rule: 'SHAPE', params: { maxDepth: 4 } });
  });
  it('refuses more keys + items than maxNodes (counted at every level)', () => {
    const r = validateBody(B, { list: Array.from({ length: 12 }, (_, i) => i) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ rule: 'SHAPE', params: { maxNodes: 10 } });
  });
  it('bounds a nested free-form part of a declared object', () => {
    const O = S.object({ name: S.text(10), meta: S.nullable(S.bounded(S.freeObject(), 2, 5)) });
    expect(validateBody(O, { name: 'x', meta: { a: 1, b: { c: 1 } } }).ok).toBe(true);
    expect(validateBody(O, { name: 'x', meta: { a: { b: { c: 1 } } } }).ok).toBe(false);
  });
});
