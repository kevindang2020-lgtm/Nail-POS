// ai-output-schemas.vitest.spec — Constitution 10 §72–§76, §136, §285–§286.
import { describe, it, expect, vi } from 'vitest';
import { OUTPUT_SCHEMAS, validate, extractJson, validateWithRepair, confidenceOf, isLowConfidence, AiOutputSchemaInvalid, repairPrompt } from './ai-output-schemas';
import { AI_TASKS } from './ai-task-registry';
import { PROMPT_SEED } from './ai-prompt-registry';

describe('§73 every task declares a schema that exists, and every schema belongs to a task', () => {
  it('coverage is exact in both directions, and prompt outputSchemaKey agrees', () => {
    for (const t of Object.values(AI_TASKS)) expect(OUTPUT_SCHEMAS[t.outputSchema], t.key).toBeDefined();
    for (const s of Object.values(OUTPUT_SCHEMAS)) { expect(AI_TASKS[s.taskKey], s.key).toBeDefined(); expect(AI_TASKS[s.taskKey].outputSchema).toBe(s.key); }
    for (const p of PROMPT_SEED) expect(OUTPUT_SCHEMAS[p.outputSchemaKey], p.promptKey).toBeDefined();
  });
});

describe('§72/§136 validation is strict and the output is a NEW object with only schema keys', () => {
  it('accepts a correct sentiment result', () => {
    const v = validate<{ sentiment: string }>('review.sentiment.v1', { sentiment: 'negative', theme: 'wait time', confidence: 0.91 });
    expect(v).toEqual({ sentiment: 'negative', theme: 'wait time', confidence: 0.91 });
  });
  it('STRIPS a hallucinated field so it can never reach a domain service', () => {
    const v = validate('review.sentiment.v1', { sentiment: 'positive', theme: 'x', confidence: 0.5, refund_cents: 5000, tenant_id: 'other' }) as Record<string, unknown>;
    expect(v).not.toHaveProperty('refund_cents'); expect(v).not.toHaveProperty('tenant_id');
  });
  it('normalises enum CASE but never the SET', () => {
    expect((validate('review.sentiment.v1', { sentiment: 'NEGATIVE', theme: 'x', confidence: 0.5 }) as any).sentiment).toBe('negative');
    expect(() => validate('review.sentiment.v1', { sentiment: 'angry', theme: 'x', confidence: 0.5 })).toThrow(AiOutputSchemaInvalid);
  });
  it('rejects missing, mistyped, out-of-range, over-long, and non-integer cents', () => {
    const bad = (schema: string, v: unknown, re: RegExp) => { try { validate(schema, v); expect.unreachable(); } catch (e) { expect(e).toBeInstanceOf(AiOutputSchemaInvalid); expect((e as AiOutputSchemaInvalid).problems.join(' | ')).toMatch(re); } };
    bad('review.sentiment.v1', { theme: 'x', confidence: 0.5 }, /sentiment: required/);
    bad('review.sentiment.v1', { sentiment: 'positive', theme: 'x', confidence: '0.9' }, /confidence: expected finite number/);
    bad('review.sentiment.v1', { sentiment: 'positive', theme: 'x', confidence: 1.7 }, /confidence: above 1/);
    bad('review.response.v1', { reply: 'x'.repeat(701), tone: 'warm' }, /reply: longer than 700/);
    bad('review.response.v1', { reply: 'ok', tone: 'warm' }, /reply: shorter than 10/);
    bad('ocr.receipt.v1', { vendor: 'v', date: null, line_items: [], subtotal_cents: 10.5, tax_cents: 0, total_cents: 10, confidence: 0.9 }, /subtotal_cents: expected integer/);
    bad('ocr.receipt.v1', { vendor: 'v', date: null, line_items: [], subtotal_cents: -1, tax_cents: 0, total_cents: 10, confidence: 0.9 }, /subtotal_cents: below 0/);
    bad('reconciliation.explanation.v1', { likely_causes: [], summary: 's' }, /fewer than 1 items/);
    bad('checkout.upsell.v1', { suggestions: [{ item_id: 'a', pitch: 'p' }, { item_id: 'b', pitch: 'p' }, { item_id: 'c', pitch: 'p' }] }, /more than 2 items/);
    bad('receptionist.reply.v1', { reply: 'hello there', needs_human: 'yes', reason: null }, /needs_human: expected boolean/);
  });
  it('nullable fields accept null; non-nullable ones do not', () => {
    expect(() => validate('voice.summary.v1', { intent: 'book', service: null, requested_time: null, follow_up: null, summary: 's' })).not.toThrow();
    expect(() => validate('voice.summary.v1', { intent: null, service: null, requested_time: null, follow_up: null, summary: 's' })).toThrow(/intent: required/);
  });
  it('nested arrays validate each element with a path', () => {
    try { validate('reconciliation.explanation.v1', { likely_causes: [{ cause: 'c', check: 'k' }, { cause: 'c2' }], summary: 's' }); expect.unreachable(); }
    catch (e) { expect((e as AiOutputSchemaInvalid).problems).toContain('$.likely_causes[1].check: required'); }
  });
  it('an unknown schema key is itself a failure (nothing validates against nothing)', () => {
    expect(() => validate('ghost.v1', {})).toThrow(/unknown schema key/);
  });
  it('the error carries the §73 code and a 502', () => {
    try { validate('review.sentiment.v1', {}); } catch (e) { expect((e as AiOutputSchemaInvalid).code).toBe('AI_OUTPUT_SCHEMA_INVALID'); expect((e as AiOutputSchemaInvalid).status).toBe(502); }
  });
});

describe('extractJson — the ONLY leniency: find the object in provider text', () => {
  it('handles fences, prose prefix, trailing commentary', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here is the JSON:\n{"a":1}\nLet me know if…')).toEqual({ a: 1 });
    expect(extractJson('{"a":{"b":[1,2]}}')).toEqual({ a: { b: [1, 2] } });
  });
  it('refuses text with no object, and malformed JSON', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(/no JSON object/);
    expect(() => extractJson('{"a":1,}')).toThrow(/invalid JSON/);
  });
});

describe('§74 bounded repair — ONE attempt, never a loop', () => {
  const good = '{"sentiment":"positive","theme":"staff","confidence":0.8}';
  it('a valid first response needs no repair and does not call ask', async () => {
    const ask = vi.fn();
    const r = await validateWithRepair('review.sentiment.v1', good, ask);
    expect(r).toMatchObject({ repaired: false, attempts: 1 }); expect(ask).not.toHaveBeenCalled();
  });
  it('an invalid first response triggers exactly one repair with the problems listed; success is marked repaired', async () => {
    const ask = vi.fn(async (p: string) => { expect(p).toMatch(/sentiment: expected one of/); expect(p).toMatch(/Return ONLY the corrected JSON/); return good; });
    const r = await validateWithRepair('review.sentiment.v1', '{"sentiment":"happy","theme":"staff","confidence":0.8}', ask);
    expect(r).toMatchObject({ repaired: true, attempts: 2 }); expect(ask).toHaveBeenCalledTimes(1);
  });
  it('a second invalid response FAILS with both problem lists — no third attempt (§74 "do not retry indefinitely")', async () => {
    const ask = vi.fn(async () => '{"sentiment":"still wrong"}');
    await expect(validateWithRepair('review.sentiment.v1', 'not json', ask)).rejects.toMatchObject({ code: 'AI_OUTPUT_SCHEMA_INVALID' });
    expect(ask).toHaveBeenCalledTimes(1);
    try { await validateWithRepair('review.sentiment.v1', 'not json', ask); } catch (e) { const p = (e as AiOutputSchemaInvalid).problems; expect(p.some((x) => x.startsWith('attempt1:'))).toBe(true); expect(p.some((x) => x.startsWith('attempt2:'))).toBe(true); }
  });
  it('without an ask function there is no repair at all — the first failure is final', async () => {
    await expect(validateWithRepair('review.sentiment.v1', 'not json')).rejects.toBeInstanceOf(AiOutputSchemaInvalid);
  });
  it('a provider error during repair is NOT rewrapped as a schema failure', async () => {
    await expect(validateWithRepair('review.sentiment.v1', 'not json', async () => { throw new Error('api.openai.com 503: overloaded'); })).rejects.toThrow(/503/);
  });
  it('the repair prompt is bounded: at most 8 problems and 2000 chars of the original', () => {
    const p = repairPrompt({ schemaKey: 'k', problems: Array.from({ length: 30 }, (_, i) => `p${i}`), originalText: 'x'.repeat(10_000) });
    expect((p.match(/^- p/gm) ?? []).length).toBe(8); expect(p.length).toBeLessThan(2600);
  });
});

describe('§75/§76 confidence is never invented', () => {
  it('comes from the model only where the schema says so; omitted elsewhere', () => {
    expect(confidenceOf('review.sentiment.v1', { sentiment: 'positive', theme: 'x', confidence: 0.42 })).toBe(0.42);
    expect(confidenceOf('review.response.v1', { reply: 'hello there friend', tone: 'warm', confidence: 0.99 })).toBeUndefined();   // schema says none — even if the model volunteers one
    expect(confidenceOf('review.sentiment.v1', { sentiment: 'positive', theme: 'x' })).toBeUndefined();
  });
  it('low-confidence threshold', () => {
    expect(isLowConfidence(0.59)).toBe(true); expect(isLowConfidence(0.6)).toBe(false); expect(isLowConfidence(undefined)).toBe(false);
  });
  it('every schema that declares model confidence actually has a confidence field, and none that says none has one', () => {
    for (const s of Object.values(OUTPUT_SCHEMAS)) {
      const has = s.root.t === 'object' && 'confidence' in s.root.fields;
      expect(has, s.key).toBe(s.confidence === 'model');
    }
  });
});

describe('§285/§286 a provider 200 with bad output is FAILED_VALIDATION, never COMPLETED', () => {
  it('the happy text validates; the same call with garbage throws — there is no status in between', async () => {
    await expect(validateWithRepair('money.explanation.v1', '{"explanation":"Two voids in five minutes on one drawer.","first_check":"drawer 2 void log"}')).resolves.toMatchObject({ repaired: false });
    await expect(validateWithRepair('money.explanation.v1', '{"explanation":"…"}')).rejects.toMatchObject({ code: 'AI_OUTPUT_SCHEMA_INVALID' });
  });
});
