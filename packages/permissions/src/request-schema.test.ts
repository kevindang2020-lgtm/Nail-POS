// request-schema.test.ts — BUILD_PLAN Phase 12 (#17): the body validator, keyword by keyword.
import { describe, it, expect } from 'vitest';
import { validateBody, S, DANGEROUS_UNKNOWN, type BodySchema } from './request-schema';
import { ValidatedBody, validationFailed } from './guards/validated-body';

const REFUND: BodySchema = S.object({
  ticketId: S.uuid(),
  amountCents: S.cents({ exclusiveMinimum: 0 }),
  reason: S.text(200, { minLength: 1 }),
  lines: S.array(S.object({ lineId: S.uuid(), qty: S.integer({ minimum: 1 }) }, ['lineId']), { maxItems: 3 }),
  note: S.nullable(S.text(10)),
  method: S.enumOf(['CARD', 'CASH']),
}, ['ticketId', 'amountCents'], { 'x-forbidden': ['status'] });
const T = '11111111-1111-4111-8111-111111111111';

describe('validateBody', () => {
  it('a valid body passes; unknown fields are stripped (and reported), declared ones kept', () => {
    const r = validateBody(REFUND, { ticketId: T, amountCents: 500, extra: 1, lines: [{ lineId: T, qty: 2, junk: true }] });
    expect(r).toEqual({ ok: true, value: { ticketId: T, amountCents: 500, lines: [{ lineId: T, qty: 2 }] }, stripped: ['extra', 'lines[0].junk'] });
  });
  it('required, type, integer, minimum, exclusiveMinimum, format, enum, maxLength, minLength — each with its field path', () => {
    const r = validateBody(REFUND, { amountCents: 1.5, reason: '', note: 'x'.repeat(11), method: 'CHEQUE', lines: [{ qty: 0 }] });
    expect(r.ok).toBe(false);
    const errs = (r as any).errors;
    expect(errs).toEqual(expect.arrayContaining([
      // rule + params (Vietnamese POS §58): a stable code beside the English, so a client words it in its own language
      { path: 'ticketId', message: 'is required', rule: 'REQUIRED' },
      { path: 'amountCents', message: 'must be integer', rule: 'TYPE', params: { type: 'integer' } },
      { path: 'reason', message: 'must not be empty', rule: 'NOT_EMPTY' },
      { path: 'note', message: 'must be at most 10 characters', rule: 'MAX_LENGTH', params: { max: 10 } },
      { path: 'method', message: 'must be one of: CARD, CASH', rule: 'ENUM', params: { allowed: 'CARD, CASH' } },
      { path: 'lines[0].lineId', message: 'is required', rule: 'REQUIRED' },
      { path: 'lines[0].qty', message: 'must be ≥ 1', rule: 'MIN', params: { min: 1 } },
    ]));
    expect(validateBody(REFUND, { ticketId: 'nope', amountCents: 0 })).toMatchObject({ ok: false, errors: [{ path: 'ticketId', message: 'must be a valid uuid' }, { path: 'amountCents', message: 'must be > 0' }] });
  });
  it('a dangerous UNKNOWN field is refused, not stripped (global list + the schema\'s x-forbidden); declared ones are fine', () => {
    for (const k of [...DANGEROUS_UNKNOWN, 'status']) {
      expect(validateBody(REFUND, { ticketId: T, amountCents: 1, [k]: 'x' })).toMatchObject({ ok: false, errors: [{ path: k, message: 'may not be set by the client' }] });
    }
    expect(validateBody(S.object({ tenantId: S.uuid() }), { tenantId: T })).toMatchObject({ ok: true, value: { tenantId: T } });
  });
  it('prototype keys never survive', () => {
    const r: any = validateBody(S.object({ a: S.integer() }), JSON.parse('{"a":1,"__proto__":{"polluted":true},"constructor":1}'));
    expect(r.ok).toBe(true); expect(Object.keys(r.value)).toEqual(['a']); expect(({} as any).polluted).toBeUndefined();
    // even where extra properties are kept (a free-form object), the prototype keys are dropped
    const f: any = validateBody(S.freeObject(), JSON.parse('{"k":1,"__proto__":{"polluted":true}}'));
    expect(f.value.k).toBe(1); expect(f.value.polluted).toBeUndefined(); expect(Object.getPrototypeOf(f.value)).toBe(Object.prototype);
  });
  it('null only where nullable; arrays bounded; no coercion of "5"', () => {
    expect(validateBody(REFUND, { ticketId: T, amountCents: 1, note: null })).toMatchObject({ ok: true });
    expect(validateBody(REFUND, { ticketId: T, amountCents: null })).toMatchObject({ ok: false });
    expect(validateBody(REFUND, { ticketId: T, amountCents: '5' })).toMatchObject({ ok: false, errors: [{ path: 'amountCents', message: 'must be integer' }] });
    expect(validateBody(REFUND, { ticketId: T, amountCents: 1, lines: [{ lineId: T }, { lineId: T }, { lineId: T }, { lineId: T }] })).toMatchObject({ ok: false, errors: [{ path: 'lines', message: 'must have at most 3 items' }] });
    expect(validateBody(S.object({ n: S.oneOfTypes(['number', 'string']) }), { n: '5' })).toMatchObject({ ok: true, value: { n: '5' } });
  });
  it('no body on an object schema is {}; a non-object body is refused; anyOf picks the first shape that fits', () => {
    expect(validateBody(S.object({ a: S.integer() }), undefined)).toEqual({ ok: true, value: {}, stripped: [] });
    expect(validateBody(S.object({}), [1, 2])).toMatchObject({ ok: false, errors: [{ path: '(body)', message: 'must be object' }] });
    const either: BodySchema = { anyOf: [S.object({ id: S.uuid() }, ['id']), S.object({ phone: S.text(20) }, ['phone'])] };
    expect(validateBody(either, { phone: '555', x: 1 })).toEqual({ ok: true, value: { phone: '555' }, stripped: ['x'] });
    expect(validateBody(either, { x: 1 })).toMatchObject({ ok: false, errors: [{ path: '(body)', message: 'does not match any allowed shape' }] });
    const tip = S.object({ tip: S.nullable({ anyOf: [S.enumOf(['none', 'p15']), S.object({ customCents: S.integer() })] }) });
    expect(validateBody(tip, { tip: null })).toMatchObject({ ok: true }); expect(validateBody(tip, { tip: 'p15' })).toMatchObject({ ok: true });
    expect(validateBody(tip, { tip: { customCents: 300 } })).toMatchObject({ ok: true }); expect(validateBody(tip, { tip: 'p99' })).toMatchObject({ ok: false });
  });
  it('dates / date-times / emails / patterns / free objects', () => {
    const s = S.object({ d: S.date(), at: S.dateTime(), e: S.email(), code: S.string({ pattern: '^[A-Z]{3}$' }), meta: S.freeObject() });
    expect(validateBody(s, { d: '2026-10-08', at: '2026-10-08T10:00:00.000Z', e: 'a@b.co', code: 'ABC', meta: { any: { thing: 1 } } })).toMatchObject({ ok: true, value: { meta: { any: { thing: 1 } } } });
    expect(validateBody(s, { d: '2026-13-45', at: 'yesterday', e: 'nope', code: 'abc' })).toMatchObject({ ok: false, errors: [{ path: 'd' }, { path: 'at' }, { path: 'e' }, { path: 'code' }] });
  });
});

describe('ValidatedBody pipe', () => {
  it('returns the stripped body; refuses with 400 VALIDATION_FAILED + field paths, never echoing values', () => {
    const pipe = ValidatedBody(REFUND);
    expect(pipe.transform({ ticketId: T, amountCents: 5, junk: 'x' })).toEqual({ ticketId: T, amountCents: 5 });
    let e: any; try { pipe.transform({ ticketId: T, amountCents: -1, reason: 'secret-value-x'.repeat(30) }); } catch (x) { e = x; }
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse()).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: [{ path: 'amountCents', message: 'must be ≥ 0' }, { path: 'amountCents', message: 'must be > 0' }, { path: 'reason', message: 'must be at most 200 characters' }] } });
    expect(JSON.stringify(e.getResponse())).not.toContain('secret-value-x');
    expect(validationFailed([]).getResponse()).toMatchObject({ code: 'VALIDATION_FAILED', message: 'Some fields are invalid.' });
  });
});
