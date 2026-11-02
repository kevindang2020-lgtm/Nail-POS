// realtime-telemetry.vitest.spec — Constitution 11 §50–51: the gateway's counters reach the registry unchanged.
import { describe, it, expect } from 'vitest';
import { attachRealtimeTelemetry, rtConnections, rtReconnectsPerMin, rtDeliveryLatency, eventLoopLag, rtBackboneFailures } from './realtime-telemetry';
import { registry } from './metrics';

const snap = (over: Partial<Record<string, number | null>> = {}) => ({
  connectionsOpened: 10, connectionsClosed: 3, reconnects: 4, reconnectsPerMinute: 2, authFailuresPerMinute: 1,
  eventsDelivered: 500, eventsDropped: 7, eventsPerMinute: 60, latencyP50Ms: 12, latencyP95Ms: 80, latencyP99Ms: 400,
  resyncsRequired: 2, slowClientDrops: 1, slowClientDisconnects: 1, backbonePublishFailures: 0, ...over,
}) as never;

describe('the bridge reads the gateway on collect', () => {
  it('connections, reconnects and backbone failures are the gateway\'s own numbers', () => {
    attachRealtimeTelemetry({ snapshot: () => snap({ backbonePublishFailures: 3 }), activeConnections: () => 42 });
    registry.snapshot();
    expect(rtConnections.snapshot()[0].value).toBe(42);
    expect(rtReconnectsPerMin.snapshot()[0].value).toBe(2);
    expect(rtBackboneFailures.snapshot()[0].value).toBe(3);
  });

  it('delivery latency is exported in SECONDS by quantile (§362) — 80 ms p95 is 0.08', () => {
    attachRealtimeTelemetry({ snapshot: () => snap(), activeConnections: () => 1 });
    registry.snapshot();
    const p95 = rtDeliveryLatency.snapshot().find((s) => s.labels.quantile === '0.95')?.value as number;
    expect(p95).toBeCloseTo(0.08);
  });

  it('a null latency (no traffic yet) leaves the gauge UNSET rather than reporting 0 ms', () => {
    attachRealtimeTelemetry({ snapshot: () => snap({ latencyP50Ms: null, latencyP95Ms: null, latencyP99Ms: null }), activeConnections: () => 0 });
    // Any earlier value from another test is fine; what must not happen is a 0 being written.
    const before = rtDeliveryLatency.snapshot().map((s) => s.value);
    registry.snapshot();
    expect(rtDeliveryLatency.snapshot().map((s) => s.value)).not.toContain(0);
    expect(rtDeliveryLatency.snapshot().length).toBeGreaterThanOrEqual(before.length);
  });

  it('event-loop lag is measured and exported in seconds', async () => {
    attachRealtimeTelemetry({ snapshot: () => snap(), activeConnections: () => 0 });
    await new Promise((r) => setTimeout(r, 60));   // let the sampler take a few readings
    registry.snapshot();
    const p50 = eventLoopLag.snapshot().find((s) => s.labels.quantile === '0.5')?.value as number;
    expect(p50).toBeGreaterThanOrEqual(0);
    expect(p50).toBeLessThan(1);   // seconds, not nanoseconds — a unit slip here reads as a 20-million-second lag
  });
});
