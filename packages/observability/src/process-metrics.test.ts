// process-metrics.test — Constitution 11 §49 (CPU / memory in the registry, not only on the System Health screen).
import { describe, it, expect } from 'vitest';
import { attachProcessMetrics, processRss, processHeapUsed, processCpuSeconds, processHandles, processUptime } from './process-metrics';
import { registry } from './metrics';

const one = (m: { snapshot: () => Array<{ labels: Record<string, string>; value: unknown }> }, labels: Record<string, string> = {}) =>
  m.snapshot().find((s) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value as number | undefined;

describe('process metrics are refreshed on collect from the injected process source', () => {
  it('RSS, heap, CPU (user + system, seconds), handles and uptime land in the registry', () => {
    let cpu = { user: 2_500_000, system: 500_000 };   // microseconds, as process.cpuUsage() reports
    attachProcessMetrics({
      memoryUsage: () => ({ rss: 123_000_000, heapUsed: 45_000_000, heapTotal: 60_000_000, external: 1, arrayBuffers: 1 }),
      cpuUsage: () => cpu,
      uptime: () => 42,
      handles: () => 7,
    });
    registry.snapshot();
    expect(one(processRss)).toBe(123_000_000);
    expect(one(processHeapUsed, { space: 'used' })).toBe(45_000_000);
    expect(one(processHeapUsed, { space: 'total' })).toBe(60_000_000);
    expect(one(processCpuSeconds, { mode: 'user' })).toBe(2.5);
    expect(one(processCpuSeconds, { mode: 'system' })).toBe(0.5);
    expect(one(processHandles)).toBe(7);
    expect(one(processUptime)).toBe(42);
    cpu = { user: 4_000_000, system: 1_000_000 };
    const text = registry.exposition();   // the Prometheus scrape refreshes too
    expect(text).toContain('aipowersalon_process_cpu_seconds_total{mode="user"} 4');
    expect(text).toContain('aipowersalon_process_resident_memory_bytes 123000000');
  });

  it('a source that throws never breaks a scrape (§286)', () => {
    attachProcessMetrics({ memoryUsage: () => { throw new Error('boom'); }, cpuUsage: () => ({ user: 0, system: 0 }), uptime: () => 1, handles: () => 0 });
    expect(() => registry.exposition()).not.toThrow();
  });
});
