// metrics.vitest.spec — Constitution 11 §36–38, §278, §361–365: the registry and, above all, the cardinality guard.
import { describe, it, expect } from 'vitest';
import { Registry, CardinalityError, LABEL_VALUE_CAP, quantile, BUCKETS, FORBIDDEN_LABELS, registry } from './metrics';

describe('§38/§278 the cardinality guard — the mistake is refused at registration, not discovered on a bill', () => {
  for (const bad of ['tenant_id', 'customer_id', 'request_id', 'appointment_id', 'phone', 'url']) {
    it(`a "${bad}" label is REFUSED`, () => {
      expect(() => new Registry().counter('aipowersalon_x_total', 'x', [bad])).toThrow(CardinalityError);
    });
  }
  it('the forbidden list is not empty and includes the §395 names', () => {
    for (const n of ['request_id', 'customer_id', 'appointment_id']) expect(FORBIDDEN_LABELS.has(n)).toBe(true);
  });
  it('safe labels (route, method, status, provider) are accepted', () => {
    expect(() => new Registry().counter('aipowersalon_api_requests_total', 'x', ['method', 'route', 'status_class'])).not.toThrow();
  });
  it('§37: a raw URL leaking into a route label collapses to "other" past the cap instead of one series per customer', () => {
    const c = new Registry().counter('aipowersalon_api_requests_total', 'x', ['route']);
    for (let i = 0; i < LABEL_VALUE_CAP + 50; i++) c.inc({ route: `/customers/${i}` });
    const snap = c.snapshot();
    expect(snap.length).toBe(LABEL_VALUE_CAP + 1);
    expect(snap.find((s) => s.labels.route === 'other')!.value).toBe(50);
  });
  it('§361: a metric name outside the naming standard is refused', () => {
    expect(() => new Registry().counter('requests', 'x')).toThrow(CardinalityError);
    expect(() => new Registry().counter('aipowersalon_Api_Requests', 'x')).toThrow(CardinalityError);
  });
});

describe('counters, gauges, histograms', () => {
  it('a counter accumulates per label set', () => {
    const c = new Registry().counter('aipowersalon_t_total', 'x', ['k']);
    c.inc({ k: 'a' }); c.inc({ k: 'a' }, 3); c.inc({ k: 'b' });
    expect(c.snapshot().find((s) => s.labels.k === 'a')!.value).toBe(4);
    expect(c.snapshot().find((s) => s.labels.k === 'b')!.value).toBe(1);
  });
  it('a gauge sets, incs and decs', () => {
    const g = new Registry().gauge('aipowersalon_t_active', 'x');
    g.set(5); g.inc(); g.dec({}, 2);
    expect(g.snapshot()[0].value).toBe(4);
  });
  it('a histogram places observations in the right bucket and tracks sum/count', () => {
    const h = new Registry().histogram('aipowersalon_t_seconds', 'x', [], [0.1, 0.5, 1]);
    for (const v of [0.05, 0.3, 0.3, 0.9, 5]) h.observe(v);
    const s = h.snapshot()[0].value as any;
    expect(s.counts).toEqual([1, 2, 1, 1]);   // ≤0.1, ≤0.5, ≤1, +Inf
    expect(s.count).toBe(5);
    expect(s.sum).toBeCloseTo(6.55);
  });
  it('a value EXACTLY on a bucket boundary belongs to that bucket (le = "less than or equal")', () => {
    // A mutation flipping > to >= survived every other test: none observed a boundary value.
    const h = new Registry().histogram('aipowersalon_t_seconds', 'x', [], [0.1, 0.5, 1]);
    h.observe(0.5);
    expect((h.snapshot()[0].value as any).counts).toEqual([0, 1, 0, 0]);
  });
  it('negative or non-finite observations are ignored rather than corrupting the sum', () => {
    const h = new Registry().histogram('aipowersalon_t_seconds', 'x', [], [1]);
    h.observe(-1); h.observe(Number.NaN); h.observe(Infinity);
    expect(h.snapshot()).toHaveLength(0);
  });
  it('registering the same name twice returns the SAME metric — modules that both import it share it', () => {
    const r = new Registry();
    expect(r.counter('aipowersalon_t_total', 'x')).toBe(r.counter('aipowersalon_t_total', 'x'));
  });
  it('§364: buckets must ascend, and each workload has its own set in SECONDS', () => {
    expect(() => new Registry().histogram('aipowersalon_t_seconds', 'x', [], [1, 0.5])).toThrow();
    expect(BUCKETS.api[0]).toBeLessThan(0.01);
    expect(BUCKETS.ai[BUCKETS.ai.length - 1]).toBeGreaterThanOrEqual(60);
    expect(BUCKETS.db[BUCKETS.db.length - 1]).toBeLessThan(BUCKETS.ai[BUCKETS.ai.length - 1]);
  });
});

describe('§107 quantiles from buckets', () => {
  it('p50 and p95 land in the right buckets', () => {
    const h = { buckets: [0.1, 0.5, 1, 5], counts: [50, 40, 5, 4, 1], sum: 0, count: 100 };
    expect(quantile(h, 0.5)!).toBeLessThanOrEqual(0.1);
    const p95 = quantile(h, 0.95)!;
    expect(p95).toBeGreaterThan(0.5); expect(p95).toBeLessThanOrEqual(1);
  });
  it('an empty histogram has no quantile — never a fake zero (§332)', () => {
    expect(quantile({ buckets: [1], counts: [0, 0], sum: 0, count: 0 }, 0.5)).toBeNull();
  });
});

describe('§188 Prometheus exposition is what a collector can scrape', () => {
  it('emits HELP/TYPE lines, cumulative buckets, +Inf, sum and count', () => {
    const r = new Registry();
    r.counter('aipowersalon_api_requests_total', 'Requests', ['method']).inc({ method: 'GET' }, 3);
    r.histogram('aipowersalon_api_request_duration_seconds', 'Latency', [], [0.1, 1]).observe(0.05);
    const text = r.exposition();
    expect(text).toContain('# TYPE aipowersalon_api_requests_total counter');
    expect(text).toContain('aipowersalon_api_requests_total{method="GET"} 3');
    expect(text).toContain('aipowersalon_api_request_duration_seconds_bucket{le="0.1"} 1');
    // CUMULATIVE: the one observation at 0.05 is also ≤ 1. A non-cumulative emitter passed until this line existed.
    expect(text).toContain('aipowersalon_api_request_duration_seconds_bucket{le="1"} 1');
    expect(text).toContain('aipowersalon_api_request_duration_seconds_bucket{le="+Inf"} 1');
    expect(text).toContain('aipowersalon_api_request_duration_seconds_count 1');
  });
  it('label values with quotes and newlines are escaped', () => {
    const r = new Registry(); r.counter('aipowersalon_t_total', 'x', ['route']).inc({ route: 'a"b\nc' });
    expect(r.exposition()).toContain('route="a\\"b\\nc"');
  });
});

describe('snapshots are COPIES — a kept snapshot must not keep changing', () => {
  // The registry used to return its live entries; inc() mutates them in place. The health aggregator is the first
  // caller to keep a snapshot across two reads, and its windowed deltas silently read 0 on every existing series.
  it('a counter snapshot does not move when the counter does', () => {
    const c = registry.counter('aipowersalon_zz_copy_counter_total', 'x', ['k']);
    c.inc({ k: 'a' }, 5);
    const kept = c.snapshot();
    c.inc({ k: 'a' }, 7);
    expect(kept[0].value).toBe(5);
    expect(c.snapshot()[0].value).toBe(12);
  });
  it('a histogram snapshot\'s counts do not move either', () => {
    const h = registry.histogram('aipowersalon_zz_copy_hist_seconds', 'x', [], [1, 2]);
    h.observe(0.5);
    const kept = h.snapshot()[0].value as { count: number; counts: number[] };
    h.observe(0.5); h.observe(1.5);
    expect(kept.count).toBe(1);
    expect(kept.counts[0]).toBe(1);
  });
  it('the registry-wide snapshot is a copy too', () => {
    const c = registry.counter('aipowersalon_zz_copy_reg_total', 'x', []);
    c.inc();
    const kept = registry.snapshot();
    c.inc();
    expect(kept['aipowersalon_zz_copy_reg_total'][0].value).toBe(1);
  });
});
