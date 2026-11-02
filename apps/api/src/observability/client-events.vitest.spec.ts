// client-events.vitest.spec — Constitution 6 §116–119 (BUILD_PLAN Phase 13, E): the mobile analytics / perf intake and the
// Super Admin count view. The privacy proof on the SERVER side: whatever a client posts, only allow-listed events, props
// and labels reach a metric or a log line.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClientEventsController, MobileTelemetryController, clientEvents, clientPerf, clientEventsDropped, mobileTelemetryCounts } from './client-events.controller';
import { ClientErrorsController, parseReport, clientErrors } from './client-errors.controller';
import { setLogSink, registry, type LogRecord } from '@aipowersalon/observability';

afterEach(() => setLogSink(null));
const req = (ip = '203.0.113.9') => ({ ip, headers: {}, socket: { remoteAddress: ip } });
const count = (m: { snapshot(): Array<{ labels: Record<string, string>; value: any }> }, l: Record<string, string>) =>
  m.snapshot().filter((s) => Object.entries(l).every(([k, v]) => s.labels[k] === v)).reduce((n, s) => n + (typeof s.value === 'number' ? s.value : s.value.count), 0);

const PII = ['Jane Doe', 'jane@example.com', '8565550142', '4111111111111111', '7d5b5c2e-1b7c-4f43-9a8e-0b8e7b1c2d3e', 'hunter2'];

describe('POST /client-telemetry/events', () => {
  it('counts allow-listed events by app / platform / event and perf marks by metric — and NOTHING personal lands', () => {
    const logs: LogRecord[] = []; setLogSink({ write: (r) => logs.push(r) });
    const c = new ClientEventsController();
    const before = count(clientEvents, { app: 'customer', platform: 'ios', event: 'booking_started' });
    const perfBefore = count(clientPerf, { app: 'customer', platform: 'ios', metric: 'api_latency' });
    c.ingest(req(), {
      app: 'customer', version: '1.0.0', platform: 'ios', email: 'jane@example.com',
      events: [
        { name: 'booking_started', props: { source: 'home', customerName: 'Jane Doe', phone: '8565550142' } },
        { name: 'booking_started', props: { source: 'jane@example.com' } },
        { name: 'customer_viewed', props: { id: '7d5b5c2e-1b7c-4f43-9a8e-0b8e7b1c2d3e' } },
      ],
      perf: [{ metric: 'api_latency', ms: 180, labels: { timeoutClass: 'fast', outcome: 'ok', url: '/customers/4111111111111111' } }],
    });
    expect(count(clientEvents, { app: 'customer', platform: 'ios', event: 'booking_started' }) - before).toBe(2);
    expect(count(clientPerf, { app: 'customer', platform: 'ios', metric: 'api_latency' }) - perfBefore).toBe(1);
    const everything = JSON.stringify({ logs, snap: registry.snapshot(), counts: mobileTelemetryCounts() });
    for (const p of PII) expect(everything).not.toContain(p);
    expect(everything).not.toContain('customer_viewed');
  });

  it('Platform Announcement §116: the POS bar\'s snapshot / realtime / receipt failures are counted per event (a stray prop is dropped)', () => {
    const c = new ClientEventsController();
    const ev = ['platform_announcement_snapshot_failed', 'platform_announcement_realtime_failed', 'platform_announcement_receipt_failed'];
    const before = ev.map((e) => count(clientEvents, { app: 'pos', platform: 'web', event: e }));
    c.ingest(req('203.0.113.77'), { app: 'pos', version: '1.0.0', platform: 'web', perf: [], events: ev.map((name) => ({ name, props: { message: 'Other salon only — secret' } })) } as never);
    ev.forEach((e, i) => expect(count(clientEvents, { app: 'pos', platform: 'web', event: e }) - before[i]).toBe(1));
    expect(JSON.stringify(registry.snapshot())).not.toContain('Other salon only');
    expect(mobileTelemetryCounts().find((r) => r.app === 'pos' && r.platform === 'web')!.events.platform_announcement_snapshot_failed).toBeGreaterThanOrEqual(1);
  });

  it('an unknown app is dropped (it is a metric label); garbage never throws; always 204-shaped (returns nothing)', () => {
    const c = new ClientEventsController();
    const before = count(clientEventsDropped, { reason: 'invalid' });
    expect(c.ingest(req(), { app: 'evil', events: [{ name: 'app_opened' }] })).toBeUndefined();
    for (const b of [null, 1, 'x', [], { app: {} }]) expect(() => c.ingest(req(), b)).not.toThrow();
    expect(count(clientEventsDropped, { reason: 'invalid' }) - before).toBeGreaterThanOrEqual(1);
  });

  it('is rate limited per IP', () => {
    const c = new ClientEventsController();
    const before = count(clientEventsDropped, { reason: 'rate_limited' });
    for (let i = 0; i < 80; i++) c.ingest(req('198.51.100.7'), { app: 'tech', version: '1', platform: 'android', events: [{ name: 'app_opened', props: {} }] });
    expect(count(clientEventsDropped, { reason: 'rate_limited' }) - before).toBeGreaterThan(0);
  });

  it('is public by design and registered as such (session middleware exclusion + unguarded-route allowlist)', () => {
    const app = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
    expect(app).toContain("{ path: 'client-telemetry/events', method: RequestMethod.POST }");
    const unguarded = readFileSync(join(process.cwd(), 'scripts/unguarded-route-check.mjs'), 'utf8');
    expect(unguarded).toMatch(/client-telemetry\\\/events/);
  });
});

describe('error reports carry the platform (C6 §118)', () => {
  it('platform is kept when allow-listed, "unknown" otherwise, and is a label on the error counter', () => {
    expect(parseReport({ app: 'tech', kind: 'render', message: 'm', platform: 'android', version: '1.6.0' })!.platform).toBe('android');
    expect(parseReport({ app: 'tech', kind: 'render', message: 'm', platform: 'Jane Doe' })!.platform).toBe('unknown');
    const before = count(clientErrors, { app: 'owner', platform: 'ios' });
    new ClientErrorsController().report(req('192.0.2.44'), { app: 'owner', kind: 'promise', message: 'x', platform: 'ios', version: '1.4.0' });
    expect(count(clientErrors, { app: 'owner', platform: 'ios' }) - before).toBe(1);
  });
});

describe('GET /super-admin/system/mobile-telemetry — the simple count view', () => {
  it('returns per app / platform counts of events, errors and perf (p50 / p95 ms) — Super Admin only', async () => {
    new ClientEventsController().ingest(req('192.0.2.50'), { app: 'owner', version: '1.4.0', platform: 'android', events: [{ name: 'approval_decided_ui', props: { decision: 'approve' } }], perf: [{ metric: 'launch_to_first_screen', ms: 1200 }] });
    const v = new MobileTelemetryController().view();
    const row = v.apps.find((r) => r.app === 'owner' && r.platform === 'android')!;
    expect(row.events.approval_decided_ui).toBeGreaterThanOrEqual(1);
    expect(row.perf.launch_to_first_screen.count).toBeGreaterThanOrEqual(1);
    expect(v.scope).toBe('instance');
    const src = readFileSync(join(process.cwd(), 'src/observability/client-events.controller.ts'), 'utf8');
    expect(src).toMatch(/@UseGuards\(SuperAdminGuard\)\s*@Controller\('super-admin\/system'\)/);
    expect(src).toMatch(/@RequirePermission\('super_admin\.system_operations\.view'\)/);
  });
});
