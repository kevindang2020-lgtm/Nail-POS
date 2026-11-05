import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureTelemetry, track, recordPerf, recordApiLatency, markFirstScreen, flushTelemetry, resetTelemetryForTests, pendingTelemetry } from './telemetry';

// Constitution 6 §116–119: sanitized analytics + perf marks, batched to the platform's own telemetry endpoint. The PII
// proof here is the CLIENT half (nothing leaves the device unsanitized); the server re-applies the same allowlist.
const sent: Array<{ url: string; body: any }> = [];
const send = (url: string, body: string) => { sent.push({ url, body: JSON.parse(body) }); };

beforeEach(() => {
  sent.length = 0; resetTelemetryForTests();
  configureTelemetry({ app: 'tech', version: '1.6.0', platform: 'android', apiBase: () => 'https://api.example.test', send, autoFlushMs: 0 });
});

describe('mobile telemetry', () => {
  it('batches events + perf marks with app / version / platform to /api/v1/client-telemetry/events', () => {
    track('screen_viewed', { screen: '/queue' });
    recordPerf('screen_render', 42, { screen: '/queue' });
    expect(sent).toHaveLength(0);                       // batched, not one request per event
    flushTelemetry();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.example.test/api/v1/client-telemetry/events');
    expect(sent[0].body).toEqual({
      app: 'tech', version: '1.6.0', platform: 'android',
      events: [{ name: 'screen_viewed', props: { screen: '/queue' } }],
      perf: [{ metric: 'screen_render', ms: 42, labels: { screen: '/queue' } }],
    });
    flushTelemetry();
    expect(sent).toHaveLength(1);                       // an empty queue sends nothing
  });

  it('NO PII leaves the device: unknown events and props are dropped before queueing', () => {
    track('customer_viewed' as any, { name: 'Jane Doe' } as any);
    track('booking_started', { source: 'home', customerName: 'Jane Doe', phone: '8565550142', email: 'jane@example.com' } as any);
    track('booking_started', { source: 'Jane Doe' } as any);
    track('screen_viewed', { screen: '/customers/7d5b5c2e-1b7c-4f43-9a8e-0b8e7b1c2d3e?phone=8565550142' });
    flushTelemetry();
    const body = JSON.stringify(sent[0].body);
    for (const pii of ['Jane', 'jane@example.com', '8565550142', '7d5b5c2e']) expect(body).not.toContain(pii);
    expect(sent[0].body.events).toEqual([
      { name: 'booking_started', props: { source: 'home' } },
      { name: 'booking_started', props: {} },
      { name: 'screen_viewed', props: { screen: '/customers/:id' } },
    ]);
  });

  it('API latency is labelled by timeout class + outcome only; launch → first screen is recorded once', () => {
    recordApiLatency({ timeoutClass: 'FAST', ms: 120, outcome: 'ok' });
    markFirstScreen('/queue', 850);
    markFirstScreen('/earnings', 999);                  // a second screen is not "first"
    flushTelemetry();
    expect(sent[0].body.perf).toEqual([
      { metric: 'api_latency', ms: 120, labels: { timeoutClass: 'fast', outcome: 'ok' } },
      { metric: 'launch_to_first_screen', ms: 850, labels: { screen: '/queue' } },
    ]);
  });

  it('flushes on its own when the batch is full, caps the queue, and never throws', () => {
    for (let i = 0; i < 50; i++) track('screen_viewed', { screen: '/home' });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.events).toHaveLength(50);
    resetTelemetryForTests();
    configureTelemetry({ app: 'owner', version: '1.4.0', platform: 'ios', apiBase: () => '', send: () => { throw new Error('offline'); }, autoFlushMs: 0, maxBatch: 1000 });
    for (let i = 0; i < 1000; i++) track('screen_viewed', { screen: '/home' });
    expect(pendingTelemetry()).toBeLessThanOrEqual(200);
    expect(() => flushTelemetry()).not.toThrow();
  });

  it('before configure: track is a silent no-op', () => {
    resetTelemetryForTests();
    expect(() => track('app_opened', { coldStart: true })).not.toThrow();
    expect(pendingTelemetry()).toBe(0);
  });

  it('auto-flushes on a timer when configured', () => {
    vi.useFakeTimers();
    try {
      resetTelemetryForTests();
      configureTelemetry({ app: 'customer', version: '1.0.0', platform: 'web', apiBase: () => '', send, autoFlushMs: 10_000 });
      track('deal_opened', { source: 'deals' });
      vi.advanceTimersByTime(10_001);
      expect(sent[sent.length - 1]?.url).toBe('/api/v1/client-telemetry/events');
    } finally { vi.useRealTimers(); }
  });
});
