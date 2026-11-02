// gateway-security.vitest.spec — Constitution 9 §196 (origin), §149/§150 (connect abuse), §239 security tests.
import { describe, it, expect } from 'vitest';
import { ConnectLimiter } from './realtime-transport-core';
import { isOriginAllowed, computeAllowedOrigins } from '../common/allowed-origins';
import { InProcessEmitter } from './realtime.gateway';
import { RealtimeController } from './realtime.controller';
import { RealtimeStreamFactory } from './realtime-stream';

const ctx = { tenantId: 'tenant-A', branchId: 'branch-1', userId: 'u-1', role: 'OWNER', permissions: [] };

describe('§196 origin validation', () => {
  it('the production list is the app origins plus native shells — never the marketing site (Security Deep Scan C5); dev adds the Vite ports', () => {
    const prod = computeAllowedOrigins({ NODE_ENV: 'production' } as any);
    expect(prod).toContain('https://app.aipowersalon.com');
    expect(prod).not.toContain('https://aipowersalon.com');            // a credentialed stream from WordPress is refused
    expect(prod).not.toContain('https://www.aipowersalon.com');
    expect(prod.some((o) => o.startsWith('http://localhost:'))).toBe(false);
    const dev = computeAllowedOrigins({ NODE_ENV: 'development' } as any);
    expect(dev).toContain('http://localhost:5173');
    expect(computeAllowedOrigins({ WEB_CORS_ORIGINS: 'https://pos.example.test' } as any)).toContain('https://pos.example.test');
  });
  it('an unknown Origin is refused; a missing Origin (native shell, curl) is allowed — identical to CORS', () => {
    const list = ['https://aipowersalon.com'];
    expect(isOriginAllowed('https://evil.example', list)).toBe(false);
    expect(isOriginAllowed('https://aipowersalon.com', list)).toBe(true);
    expect(isOriginAllowed(undefined, list)).toBe(true);
  });
  it('the gateway refuses the stream with 403 BEFORE opening it', () => {
    const bus = new InProcessEmitter(); const ctrl = new RealtimeController(new RealtimeStreamFactory(bus));
    expect(() => ctrl.stream({ ctx, headers: { origin: 'https://evil.example' } })).toThrow(/origin/);
    expect(bus.metrics.originRejected).toBe(1);
    expect(bus.metrics.connectionsOpened).toBe(0);           // nothing was subscribed
  });
});

describe('§149/§150 connect limiter', () => {
  it('allows `max` opens in the window, then refuses with a retry-after until the oldest expires', () => {
    const l = new ConnectLimiter(3, 10_000);
    expect(l.attempt('u:1', 0).ok).toBe(true);
    expect(l.attempt('u:1', 1000).ok).toBe(true);
    expect(l.attempt('u:1', 2000).ok).toBe(true);
    const r = l.attempt('u:1', 3000);
    expect(r).toEqual({ ok: false, retryAfterMs: 7000 });     // first attempt at 0 leaves the window at 10 000
    expect(l.attempt('u:2', 3000).ok).toBe(true);            // another principal is unaffected (§107 noisy neighbour)
    expect(l.attempt('u:1', 10_001).ok).toBe(true);          // the window slid
  });
  it('the gateway answers 429 with retryAfterMs on the 31st open inside a minute', () => {
    const bus = new InProcessEmitter(); const ctrl = new RealtimeController(new RealtimeStreamFactory(bus));
    for (let i = 0; i < 30; i++) ctrl.stream({ ctx, headers: {} });
    let err: any;
    try { ctrl.stream({ ctx, headers: {} }); } catch (e) { err = e; }
    expect(err?.getStatus?.()).toBe(429);
    expect(err?.getResponse?.().retryAfterMs).toBeGreaterThan(0);
    expect(bus.metrics.connectsRateLimited).toBe(1);
  });
});
