// security-signals.pgtest — BUILD_PLAN Phase 14 C (Constitution 11 D8): observability → security_incidents, de-duplicated.
// Fixed clocks throughout.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { recordWebhook, resetWebhookCountsForTests } from '@aipowersalon/observability';
import { SecuritySignals, SecuritySignalsMiddleware, WindowCounter, RULES, incidentRef } from './security-signals';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM security_incidents WHERE detection_source = 'observability'; DELETE FROM alerts WHERE related_module = 'security_signal'; DELETE FROM observability_signal_state;`); });

const T0 = Date.parse('2026-04-02T10:15:00Z');
function signals(now = T0, env: Record<string, string> = {}) { const s = new SecuritySignals(db); s.now = () => now; s.env = env; return s; }
const settle = (s: SecuritySignals) => Promise.allSettled([...s.pending]);
const incidents = async () => (await pg.query(`SELECT incident_ref, category, severity, description FROM security_incidents WHERE detection_source = 'observability' ORDER BY incident_ref`)).rows;
const alertsFor = async () => (await pg.query(`SELECT severity, related_record_id, dedupe_key, type FROM alerts WHERE related_module = 'security_signal' ORDER BY dedupe_key`)).rows;

describe('the counter', () => {
  it('crosses exactly once per window, and again in a new window', () => {
    const c = new WindowCounter();
    const hits = Array.from({ length: 150 }, (_, i) => c.add('k', 1, 100, 60_000, 1000 + i).crossed).filter(Boolean);
    expect(hits).toHaveLength(1);
    expect(c.add('k', 100, 100, 60_000, 1000 + 60_000).crossed).toBe(true);
  });
  it('stays bounded under a flood of distinct keys', () => {
    const c = new WindowCounter(50);
    for (let i = 0; i < 1000; i++) c.add(`ip${i}`, 1, 100, 60_000, 0);
    expect(c.size()).toBeLessThanOrEqual(50);
  });
});

describe('401 / 403 / 429 spikes', () => {
  it('below the threshold: nothing is written', async () => {
    const s = signals();
    for (let i = 0; i < RULES.auth_failures.threshold - 1; i++) s.observeResponse({ status: 401, ip: '203.0.113.9', path: '/auth/login' });
    await settle(s);
    expect(await incidents()).toEqual([]);
  });
  it('crossing it opens ONE incident and ONE alert — not one per request after it', async () => {
    const s = signals();
    for (let i = 0; i < RULES.auth_failures.threshold * 3; i++) s.observeResponse({ status: 401, ip: '203.0.113.9', path: '/auth/login' });
    await settle(s);
    const inc = await incidents();
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ incident_ref: incidentRef('auth_failures', new Date(T0)), category: 'authentication', severity: 'medium' });
    expect(inc[0].description).toContain('ip 203.0.113.9');
    expect(await alertsFor()).toEqual([{ severity: 'medium', related_record_id: inc[0].incident_ref, dedupe_key: inc[0].incident_ref, type: 'security' }]);
  });
  it('a distributed attack from 500 addresses is still one incident per kind per hour, its description bounded', async () => {
    const s = signals();
    for (let ip = 0; ip < 500; ip++) for (let i = 0; i < RULES.forbidden.threshold; i++) s.observeResponse({ status: 403, ip: `198.51.100.${ip % 250}.${ip}`, path: '/pos/x' });
    await settle(s);
    const inc = await incidents();
    expect(inc).toHaveLength(1);
    expect(inc[0].description.length).toBeLessThanOrEqual(4000);
    expect(await alertsFor()).toHaveLength(1);
  });
  it('several API instances crossing at once: still one incident', async () => {
    const a = signals(), b = signals(), c = signals();
    for (const s of [a, b, c]) for (let i = 0; i < RULES.rate_limit_storm.threshold; i++) s.observeResponse({ status: 429, ip: '192.0.2.1', path: '/customer/booking' });
    await Promise.all([settle(a), settle(b), settle(c)]);
    expect((await incidents()).map((x: any) => x.category)).toEqual(['network']);
  });
  it('403s are also counted per salon; health and metrics paths are ignored; 2xx / 404 / 500 are not security signals', async () => {
    const s = signals();
    for (let i = 0; i < RULES.forbidden.threshold; i++) s.observeResponse({ status: 403, ip: `10.0.${i}.1`, tenantId: 'aaaaaaaa-0000-4000-8000-000000000001', path: '/pos/x' });
    for (let i = 0; i < 500; i++) { s.observeResponse({ status: 401, ip: '1.1.1.1', path: '/health/ready' }); s.observeResponse({ status: 500, ip: '1.1.1.1', path: '/x' }); s.observeResponse({ status: 404, ip: '1.1.1.1', path: '/x' }); }
    await settle(s);
    const inc = await incidents();
    expect(inc).toHaveLength(1);
    expect(inc[0].description).toContain('salon aaaaaaaa-0000-4000-8000-000000000001');
  });
  it('the next hour is a new incident', async () => {
    const s1 = signals(T0), s2 = signals(T0 + 3_600_000);
    for (const s of [s1, s2]) for (let i = 0; i < RULES.auth_failures.threshold; i++) s.observeResponse({ status: 401, ip: '203.0.113.9' });
    await Promise.all([settle(s1), settle(s2)]);
    expect(await incidents()).toHaveLength(2);
  });
  it('the middleware reports each finished response (incl. a guard\'s 401) and never blocks the request', () => {
    const seen: any[] = []; const fake = { observeResponse: (r: any) => seen.push(r) } as any;
    const res = Object.assign(new EventEmitter(), { statusCode: 401 }); let nexted = false;
    new SecuritySignalsMiddleware(fake).use({ ip: '203.0.113.5', originalUrl: '/pos/tickets', ctx: { tenantId: 't1' } }, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(seen).toEqual([]);
    res.emit('finish');
    expect(seen).toEqual([{ status: 401, ip: '203.0.113.5', tenantId: 't1', path: '/pos/tickets' }]);
  });
});

describe('webhook signature failures', () => {
  it('rejected deliveries crossing the threshold between ticks open a HIGH incident (paged) per provider source', async () => {
    resetWebhookCountsForTests();
    const s = signals();
    await s.tick();                                                          // baseline
    for (let i = 0; i < RULES.webhook_signature_failures.threshold; i++) recordWebhook('twilio', 'rejected');
    for (let i = 0; i < 50; i++) recordWebhook('twilio', 'processed');
    await s.tick();
    const inc = await incidents();
    expect(inc.map((x: any) => [x.category, x.severity])).toEqual([['fraud', 'high']]);
    expect(inc[0].description).toContain('provider twilio');
    expect((await alertsFor())[0].severity).toBe('high');
  });
});

describe('break-glass toggles', () => {
  it('the first observation of "off" is a baseline, not an incident', async () => {
    expect(await signals(T0, {}).checkBreakGlass()).toBe('unchanged');
    expect(await incidents()).toEqual([]);
  });
  it('switching it on opens one HIGH incident + alert; switching it off opens another; instances that see the same mode add nothing', async () => {
    await signals(T0, {}).checkBreakGlass();
    const a = signals(T0 + 60_000, { MAINTENANCE_BREAK_GLASS: 'full' }), b = signals(T0 + 60_000, { MAINTENANCE_BREAK_GLASS: 'full' });
    const r = await Promise.all([a.checkBreakGlass(), b.checkBreakGlass()]);
    expect(r.filter((x) => x === 'changed')).toHaveLength(1);
    let inc = await incidents();
    expect(inc.map((x: any) => [x.category, x.severity])).toEqual([['privilege', 'high']]);
    expect(inc[0].description).toContain('off → full');
    expect(await a.checkBreakGlass()).toBe('unchanged');                    // same process, same mode
    await signals(T0 + 3 * 3_600_000, { MAINTENANCE_BREAK_GLASS: 'off' }).checkBreakGlass();
    inc = await incidents();
    expect(inc).toHaveLength(2);
    expect(inc[1].description).toContain('full → off');
  });
  it('a rolling deploy cannot flip-flop it: an OLD instance that already reported its mode never writes again', async () => {
    const old = signals(T0, {}); await old.checkBreakGlass();                    // old instance: off, reported at its start
    await signals(T0 + 60_000, { MAINTENANCE_BREAK_GLASS: 'read_only' }).checkBreakGlass();
    await old.checkBreakGlass(); await old.checkBreakGlass();                    // still running during the deploy
    expect((await incidents()).map((x: any) => x.category)).toEqual(['privilege']);
  });
  it('first-ever observation already ON is reported', async () => {
    expect(await signals(T0, { MAINTENANCE_BREAK_GLASS: 'read_only' }).checkBreakGlass()).toBe('changed');
    expect((await incidents())[0].description).toContain('unset → read_only');
  });
});
