// apiPerf.ts — real, lightweight client-side API latency capture.
//
// Phase 4 of the POS UX/perf pass is "measure before you optimize." This does NOT invent numbers: it records the actual
// wall-clock duration of every API call that flows through the shared client, aggregates them per endpoint, and exposes
// a summary you can read in the running app. Overhead is a `performance.now()` diff plus a push into a capped ring
// buffer — negligible — so it can stay on in production and give a genuine baseline before any DB/bundle work.
//
// In the browser it also hangs a read-only handle off `window.__apsApiPerf` so you can, from the console:
//   __apsApiPerf.summary()   // slowest endpoints first, with p50 / p95 / max / avg (ms) and sample count
//   __apsApiPerf.reset()     // clear the window (e.g. before timing a specific workflow)

const MAX_PER_KEY = 200;
const samples = new Map<string, number[]>();

/** Collapse id-like path segments so `/items/<uuid>` and `/items/42` aggregate under one endpoint key. */
export function normalizeKey(method: string, path: string): string {
  const clean = (path.split('?')[0] || '')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')  // uuid
    .replace(/\/\d+(?=\/|$)/g, '/:id')                                                    // numeric id
    .replace(/\/[0-9a-zA-Z_-]{20,}(?=\/|$)/g, '/:id');                                    // long opaque token
  return `${method.toUpperCase()} ${clean}`;
}

export function record(method: string, path: string, ms: number): void {
  if (!(ms >= 0)) return;
  const key = normalizeKey(method, path);
  let arr = samples.get(key);
  if (!arr) { arr = []; samples.set(key, arr); }
  arr.push(ms);
  if (arr.length > MAX_PER_KEY) arr.shift();
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface EndpointStat { key: string; count: number; p50: number; p95: number; max: number; avg: number }

/** Per-endpoint latency summary, slowest (by p95) first. Computed from real captured samples. */
export function summary(): EndpointStat[] {
  const out: EndpointStat[] = [];
  for (const [key, arr] of samples) {
    if (!arr.length) continue;
    const s = [...arr].sort((a, b) => a - b);
    const sum = s.reduce((a, b) => a + b, 0);
    out.push({ key, count: s.length, p50: Math.round(percentile(s, 50)), p95: Math.round(percentile(s, 95)), max: Math.round(s[s.length - 1]), avg: Math.round(sum / s.length) });
  }
  return out.sort((a, b) => b.p95 - a.p95);
}

export function reset(): void { samples.clear(); }

if (typeof window !== 'undefined') {
  (window as any).__apsApiPerf = { summary, reset };
}
