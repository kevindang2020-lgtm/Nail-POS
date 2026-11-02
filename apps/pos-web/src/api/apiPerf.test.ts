import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeKey, record, summary, reset } from './apiPerf';

describe('apiPerf.normalizeKey — id-like segments collapse so endpoints aggregate', () => {
  it('collapses uuids, numeric ids, and long opaque tokens', () => {
    expect(normalizeKey('GET', '/pos/queue/items/3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe('GET /pos/queue/items/:id');
    expect(normalizeKey('POST', '/pos/service-done/tickets/42/send-to-checkout')).toBe('POST /pos/service-done/tickets/:id/send-to-checkout');
    expect(normalizeKey('GET', '/pos/queue/items/AB12cd34EF56gh78IJ90')).toBe('GET /pos/queue/items/:id');
    expect(normalizeKey('get', '/pos/queue/state?status=waiting')).toBe('GET /pos/queue/state'); // query stripped, method upper
  });
});

describe('apiPerf.summary — real aggregation over captured samples', () => {
  beforeEach(() => reset());

  it('computes p50 / p95 / max / avg per endpoint and orders slowest (p95) first', () => {
    for (const ms of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) record('GET', '/pos/queue/state', ms);
    record('GET', '/pos/queue/items/3f2504e0-4f89-41d3-9a0c-0305e82c3301', 500);   // one slow endpoint, id-collapsed
    record('GET', '/pos/queue/items/9c8b7a60-1234-41d3-9a0c-0305e82c9999', 700);

    const s = summary();
    expect(s[0].key).toBe('GET /pos/queue/items/:id');   // slowest by p95 comes first
    expect(s[0].count).toBe(2);
    expect(s[0].max).toBe(700);

    const state = s.find((e) => e.key === 'GET /pos/queue/state')!;
    expect(state.count).toBe(10);
    expect(state.p50).toBe(50);      // ceil(0.5*10)=5th sorted value = 50
    expect(state.p95).toBe(100);     // ceil(0.95*10)=10th = 100
    expect(state.avg).toBe(55);
  });

  it('caps memory and resets cleanly', () => {
    for (let i = 0; i < 250; i++) record('GET', '/x', i);
    expect(summary()[0].count).toBe(200);   // ring buffer cap
    reset();
    expect(summary()).toEqual([]);
  });
});
