// code-lookup-limit.test.ts — the lookup-by-code limit: the front-desk load model the budgets are sized from, the
// enumeration it stops, the weights, and the classifier. Fixed clock throughout (never today's date).
import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import {
  CODE_LOOKUP_BUDGET, CODE_LOOKUP_WINDOW_MS, HIT_WEIGHT, MISS_WEIGHT, InMemoryCodeLookupStore, blockedDimension, callerKeyFor,
  classifyLookupError, classifyLookupResult, type CodeLookupKeys,
} from './code-lookup-limit';

const T0 = Date.UTC(2026, 0, 15, 10, 0, 0);
const clock = () => { let t = T0; return { now: () => t, advance: (ms: number) => { t += ms; } }; };
const keys = (o: Partial<CodeLookupKeys> = {}): CodeLookupKeys => ({ kind: 'gift_card', caller: 'user:u1', ip: '203.0.113.7', tenantId: 't1', ...o });

describe('the budgets come from a busy front desk (the load model)', () => {
  // Peak day: three stations behind one IP; each rings up a gift-card transaction every 90 s, touches the card ~3 times
  // per transaction (look up, pay, reload / re-check) and mistypes a number about once every 5 transactions.
  const WINDOW_MIN = CODE_LOOKUP_WINDOW_MS / 60_000;
  const txPerStation = WINDOW_MIN * 60 / 90;                 // 10
  const hitsPerStation = txPerStation * 3;                    // 30
  const missesPerStation = txPerStation / 5;                  // 2
  const station = hitsPerStation * HIT_WEIGHT + missesPerStation * MISS_WEIGHT;   // 5 … with the weights below
  const salon = station * 3;

  it('every key keeps ≥ 2× headroom over the busiest salon', () => {
    expect(station).toBeLessThanOrEqual(5);
    expect(CODE_LOOKUP_BUDGET.caller / station).toBeGreaterThanOrEqual(2);
    expect(CODE_LOOKUP_BUDGET.ip / salon).toBeGreaterThanOrEqual(2);
    expect(CODE_LOOKUP_BUDGET.tenant / salon).toBeGreaterThanOrEqual(2);
  });

  it('the three stations run a whole peak hour through the real store without one refusal', async () => {
    const c = clock(); const store = new InMemoryCodeLookupStore(c.now);
    let refused = 0;
    for (let tx = 0; tx < 40; tx++) {            // 40 transactions per station per hour
      for (const st of ['user:a', 'user:b', 'user:c']) {
        for (let touch = 0; touch < 3; touch++) {
          const a = await store.admit(keys({ caller: st }));
          if (!a.allowed) { refused++; continue; }
          await store.settle(a.attemptId!, touch === 0 && tx % 5 === 4 ? 'miss' : 'hit');
        }
      }
      c.advance(90_000);
    }
    expect(refused).toBe(0);
  });

  it('a guessing script is stopped after the caller budget of misses, with a Retry-After', async () => {
    const c = clock(); const store = new InMemoryCodeLookupStore(c.now);
    let admitted = 0; let last: any = null;
    for (let i = 0; i < 100; i++) {
      const a = await store.admit(keys());
      if (!a.allowed) { last = a; break; }
      admitted++; await store.settle(a.attemptId!, 'miss');
    }
    expect(admitted).toBe(CODE_LOOKUP_BUDGET.caller);
    expect(last).toMatchObject({ allowed: false, blockedBy: 'caller' });
    expect(last.retryAfterMs).toBeGreaterThan(0);
    expect(last.retryAfterMs).toBeLessThanOrEqual(CODE_LOOKUP_WINDOW_MS);
    c.advance(CODE_LOOKUP_WINDOW_MS + 1);           // the window slides: the caller may try again
    expect((await store.admit(keys())).allowed).toBe(true);
  });

  it('rotating users at one salon still hits the salon budget; another salon is untouched', async () => {
    const c = clock(); const store = new InMemoryCodeLookupStore(c.now);
    let admitted = 0;
    for (let i = 0; i < 200; i++) {
      const a = await store.admit(keys({ caller: `user:${i}`, ip: `198.51.100.${i % 250}` }));
      if (!a.allowed) { expect(a.blockedBy).toBe('tenant'); break; }
      admitted++; await store.settle(a.attemptId!, 'miss');
    }
    expect(admitted).toBe(CODE_LOOKUP_BUDGET.tenant);
    expect((await store.admit(keys({ caller: 'user:other', tenantId: 't2', ip: '192.0.2.1' }))).allowed).toBe(true);
  });

  it('one IP rotating users across salons hits the IP budget', async () => {
    const c = clock(); const store = new InMemoryCodeLookupStore(c.now);
    let admitted = 0;
    for (let i = 0; i < 200; i++) {
      const a = await store.admit(keys({ caller: `user:${i}`, tenantId: `t${i}` }));
      if (!a.allowed) { expect(a.blockedBy).toBe('ip'); break; }
      admitted++; await store.settle(a.attemptId!, 'miss');
    }
    expect(admitted).toBe(CODE_LOOKUP_BUDGET.ip);
  });

  it('a neutral outcome (validation error) is refunded; a hit costs a tenth of a miss', async () => {
    const c = clock(); const store = new InMemoryCodeLookupStore(c.now);
    for (let i = 0; i < 50; i++) { const a = await store.admit(keys()); expect(a.allowed).toBe(true); await store.settle(a.attemptId!, 'neutral'); }
    for (let i = 0; i < 100; i++) { const a = await store.admit(keys()); expect(a.allowed).toBe(true); await store.settle(a.attemptId!, 'hit'); }   // 100 × 0.1 = 10
    expect(blockedDimension({ caller: 10, ip: 10, tenant: 10 }, keys())).toBeNull();
    expect(blockedDimension({ caller: 11.5, ip: 0, tenant: 0 }, keys())).toBe('caller');
  });
});

describe('the caller key never comes from a client header', () => {
  it('user, then a server-authenticated device, then the IP', () => {
    expect(callerKeyFor({ ctx: { userId: 'u9' }, headers: { 'x-device-id': 'spoof' } }, '1.2.3.4')).toBe('user:u9');
    expect(callerKeyFor({ deviceId: 'd7', headers: { 'x-device-id': 'spoof' } }, '1.2.3.4')).toBe('device:d7');
    expect(callerKeyFor({ headers: { 'x-device-id': 'spoof' } }, '1.2.3.4')).toBe('ip:1.2.3.4');
  });
});

describe('the classifier', () => {
  it('results: found:false and ok:false/not_found are misses; a real card is a hit', () => {
    expect(classifyLookupResult({ found: false })).toBe('miss');
    expect(classifyLookupResult({ ok: false, reason: 'not_found' })).toBe('miss');
    expect(classifyLookupResult({ ok: false, reason: 'claimed' })).toBe('hit');
    expect(classifyLookupResult({ found: true, balanceCents: 500 })).toBe('hit');
  });
  it('errors: unknown-code wording and 404 are misses; permission / 5xx are neutral; 409 used is a hit', () => {
    expect(classifyLookupError(new HttpException('Gift card not found', 400))).toBe('miss');
    expect(classifyLookupError(new HttpException('Invalid gift card', 400))).toBe('miss');
    expect(classifyLookupError(new HttpException('That reward code was not found.', 400))).toBe('miss');
    expect(classifyLookupError(new HttpException({ message: 'That code isn’t valid here.', reasons: [{ code: 'unknown_code' }] }, 400))).toBe('miss');
    expect(classifyLookupError(new HttpException('Not here', 404))).toBe('miss');
    expect(classifyLookupError(new HttpException('Forbidden', 403))).toBe('neutral');
    expect(classifyLookupError(new HttpException('This ticket is already paid.', 400))).toBe('neutral');
    expect(classifyLookupError(new Error('db down'))).toBe('neutral');
    expect(classifyLookupError(new HttpException({ message: 'That code has already been used.', reasons: [{ code: 'code_used' }] }, 409))).toBe('hit');
  });
});
