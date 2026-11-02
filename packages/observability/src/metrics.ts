// metrics.ts — Constitution 11 §34–39, §247, §278, §361–365: the in-process metrics registry.
//
// Counters, gauges and histograms live in memory and are read two ways: as a JSON snapshot for the Super Admin
// dashboards, and as Prometheus text exposition (vendor-neutral, what OpenTelemetry collectors scrape) so an
// external monitoring system can be attached later without touching modules (§188). Nothing here touches the
// database or blocks a request (§286).
//
// THE CARDINALITY GUARD (§38, §278, §395). Labels are declared at registration and the registry REFUSES the
// dangerous ones — tenant_id, customer_id, request_id, appointment_id, phone… — at that moment, with a thrown
// error, so the mistake is caught in the first test that imports the module, not in a monitoring bill. Every
// label VALUE is also capped: past LABEL_VALUE_CAP distinct values a label collapses to "other". A raw URL
// leaking into a route label (§37) therefore degrades to one bucket instead of one series per customer.
//
// Naming (§361–362): `aipowersalon_<subsystem>_<name>_<unit>`; seconds and bytes, never milliseconds in a
// seconds field. Histogram buckets (§364) are chosen per use — an AI call and a DB query do not share them.

export const FORBIDDEN_LABELS = new Set([
  'tenant_id', 'tenantid', 'customer_id', 'customerid', 'request_id', 'requestid', 'correlation_id', 'trace_id',
  'appointment_id', 'ticket_id', 'user_id', 'userid', 'actor_id', 'phone', 'email', 'url', 'path', 'raw_url', 'job_id', 'event_id',
]);
export const LABEL_VALUE_CAP = 200;

export class CardinalityError extends Error { constructor(msg: string) { super(msg); this.name = 'CardinalityError'; } }

const NAME = /^aipowersalon_[a-z0-9_]+$/;

type Labels = Record<string, string>;
const key = (labels: Labels, names: readonly string[]) => names.map((n) => labels[n] ?? '').join('\u0001');

abstract class Metric {
  protected seenValues = new Map<string, Set<string>>();
  constructor(readonly name: string, readonly help: string, readonly labelNames: readonly string[]) {
    if (!NAME.test(name)) throw new CardinalityError(`metric name "${name}" must match ${NAME} (§361)`);
    for (const l of labelNames) {
      if (FORBIDDEN_LABELS.has(l.toLowerCase())) throw new CardinalityError(`label "${l}" on ${name} is a high-cardinality identifier — put it in logs/traces, not metric labels (§38/§278)`);
    }
  }
  /** Caps distinct values per label. Deterministic: the first LABEL_VALUE_CAP values keep their names. */
  protected cap(labels: Labels): Labels {
    const out: Labels = {};
    for (const n of this.labelNames) {
      const v = String(labels[n] ?? '');
      let seen = this.seenValues.get(n);
      if (!seen) { seen = new Set(); this.seenValues.set(n, seen); }
      if (seen.has(v)) out[n] = v;
      else if (seen.size < LABEL_VALUE_CAP) { seen.add(v); out[n] = v; }
      else out[n] = 'other';
    }
    return out;
  }
  abstract snapshot(): Array<{ labels: Labels; value: number | HistogramValue }>;
}

export class Counter extends Metric {
  private values = new Map<string, { labels: Labels; value: number }>();
  inc(labels: Labels = {}, by = 1): void {
    const l = this.cap(labels); const k = key(l, this.labelNames);
    const cur = this.values.get(k); if (cur) cur.value += by; else this.values.set(k, { labels: l, value: by });
  }
  /**
   * A COPY, never the live entries. inc() mutates entries in place, so returning them let any snapshot a caller KEPT
   * go on changing — the health aggregator's 5-minute window compared the present with itself and every delta on an
   * existing series read 0. Nothing caught it until a caller held a snapshot across two reads.
   */
  snapshot() { return [...this.values.values()].map((e) => ({ labels: { ...e.labels }, value: e.value })); }
}

export class Gauge extends Metric {
  private values = new Map<string, { labels: Labels; value: number }>();
  set(value: number, labels: Labels = {}): void { const l = this.cap(labels); this.values.set(key(l, this.labelNames), { labels: l, value }); }
  inc(labels: Labels = {}, by = 1): void { const l = this.cap(labels); const k = key(l, this.labelNames); const cur = this.values.get(k); if (cur) cur.value += by; else this.values.set(k, { labels: l, value: by }); }
  dec(labels: Labels = {}, by = 1): void { this.inc(labels, -by); }
  /**
   * A COPY, never the live entries. inc() mutates entries in place, so returning them let any snapshot a caller KEPT
   * go on changing — the health aggregator's 5-minute window compared the present with itself and every delta on an
   * existing series read 0. Nothing caught it until a caller held a snapshot across two reads.
   */
  snapshot() { return [...this.values.values()].map((e) => ({ labels: { ...e.labels }, value: e.value })); }
}

export interface HistogramValue { buckets: number[]; counts: number[]; sum: number; count: number }

export class Histogram extends Metric {
  private values = new Map<string, { labels: Labels; value: HistogramValue }>();
  constructor(name: string, help: string, labelNames: readonly string[], readonly buckets: readonly number[]) {
    super(name, help, labelNames);
    if (!buckets.length || buckets.some((b, i) => i > 0 && b <= buckets[i - 1])) throw new CardinalityError(`buckets for ${name} must be ascending`);
  }
  observe(value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value) || value < 0) return;
    const l = this.cap(labels); const k = key(l, this.labelNames);
    let cur = this.values.get(k);
    if (!cur) { cur = { labels: l, value: { buckets: [...this.buckets], counts: new Array(this.buckets.length + 1).fill(0), sum: 0, count: 0 } }; this.values.set(k, cur); }
    let i = 0; while (i < this.buckets.length && value > this.buckets[i]) i++;
    cur.value.counts[i]++; cur.value.sum += value; cur.value.count++;
  }
  /** A COPY — see Counter.snapshot(). The counts array is copied too, or a kept histogram would still move. */
  snapshot() { return [...this.values.values()].map((e) => ({ labels: { ...e.labels }, value: { buckets: e.value.buckets, counts: [...e.value.counts], sum: e.value.sum, count: e.value.count } })); }
}

/** Approximate quantile from bucket counts — the standard linear interpolation; exact enough for p50/p95/p99 (§107). */
export function quantile(h: HistogramValue, q: number): number | null {
  if (h.count === 0) return null;
  const target = q * h.count; let cum = 0;
  for (let i = 0; i < h.counts.length; i++) {
    const prev = cum; cum += h.counts[i];
    if (cum >= target) {
      const lo = i === 0 ? 0 : h.buckets[i - 1];
      const hi = i < h.buckets.length ? h.buckets[i] : h.buckets[h.buckets.length - 1] * 2;
      const frac = h.counts[i] ? (target - prev) / h.counts[i] : 0;
      return lo + (hi - lo) * frac;
    }
  }
  return h.buckets[h.buckets.length - 1];
}

// §364: buckets per workload, in SECONDS.
export const BUCKETS = {
  api:   [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  db:    [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  provider: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30],
  ai:    [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  job:   [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
} as const;

export class Registry {
  private metrics = new Map<string, Metric>();
  counter(name: string, help: string, labelNames: readonly string[] = []): Counter { return this.reg(name, () => new Counter(name, help, labelNames)) as Counter; }
  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge { return this.reg(name, () => new Gauge(name, help, labelNames)) as Gauge; }
  histogram(name: string, help: string, labelNames: readonly string[], buckets: readonly number[]): Histogram { return this.reg(name, () => new Histogram(name, help, labelNames, buckets)) as Histogram; }
  private reg(name: string, make: () => Metric): Metric { const ex = this.metrics.get(name); if (ex) return ex; const m = make(); this.metrics.set(name, m); return m; }
  get(name: string): Metric | undefined { return this.metrics.get(name); }
  names(): string[] { return [...this.metrics.keys()]; }

  /** JSON snapshot for dashboards. */
  private readonly collectors: Array<() => void> = [];
  /**
   * Register a function that refreshes gauges ON DEMAND — pool counts, memory, queue depth. Called at the start
   * of every snapshot() and exposition(), so nothing polls between scrapes and a gauge is never stale by more
   * than one read. A collector that throws is skipped, never propagated (§286).
   */
  onCollect(fn: () => void): void { this.collectors.push(fn); }
  private collect(): void { for (const fn of this.collectors) { try { fn(); } catch { /* §286 */ } } }

  snapshot(): Record<string, Array<{ labels: Labels; value: number | HistogramValue }>> {
    this.collect();
    const out: Record<string, any> = {};
    for (const [n, m] of this.metrics) out[n] = m.snapshot();
    return out;
  }

  /** Prometheus text exposition — what an OpenTelemetry/Prometheus collector scrapes (§188). */
  exposition(): string {
    this.collect();
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const lbl = (l: Labels) => { const e = Object.entries(l); return e.length ? `{${e.map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : ''; };
    const lines: string[] = [];
    for (const [n, m] of this.metrics) {
      const type = m instanceof Counter ? 'counter' : m instanceof Gauge ? 'gauge' : 'histogram';
      lines.push(`# HELP ${n} ${m.help}`, `# TYPE ${n} ${type}`);
      for (const s of m.snapshot()) {
        if (typeof s.value === 'number') { lines.push(`${n}${lbl(s.labels)} ${s.value}`); continue; }
        const h = s.value; let cum = 0;
        for (let i = 0; i < h.buckets.length; i++) { cum += h.counts[i]; lines.push(`${n}_bucket${lbl({ ...s.labels, le: String(h.buckets[i]) })} ${cum}`); }
        lines.push(`${n}_bucket${lbl({ ...s.labels, le: '+Inf' })} ${h.count}`, `${n}_sum${lbl(s.labels)} ${h.sum}`, `${n}_count${lbl(s.labels)} ${h.count}`);
      }
    }
    return lines.join('\n') + '\n';
  }
}

/** The process-wide registry. Modules register their metrics on import. */
export const registry = new Registry();
