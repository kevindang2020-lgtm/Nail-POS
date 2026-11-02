import { classifyConnectivity, summarizeConnectivity, CONNECTIVITY_WINDOW_MIN } from './workforce-connectivity-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);

const now = Date.parse('2026-06-30T12:00:00Z');
const ago = (min: number) => new Date(now - min * 60000).toISOString();

// classification
eq(classifyConnectivity(null, false, now), 'unknown', 'no token → unknown');
eq(classifyConnectivity(ago(5), true, now), 'connected', 'recent heartbeat → connected');
eq(classifyConnectivity(ago(CONNECTIVITY_WINDOW_MIN + 1), true, now), 'disconnected', 'stale heartbeat → disconnected');
eq(classifyConnectivity(ago(CONNECTIVITY_WINDOW_MIN), true, now), 'connected', 'exactly at window → connected (inclusive)');
eq(classifyConnectivity(null, true, now), 'disconnected', 'token but no last_seen → disconnected');
eq(classifyConnectivity('not-a-date', true, now), 'disconnected', 'bad date → disconnected');

// summary reconciles + configured flag
{ const s = summarizeConnectivity([{ status: 'connected' }, { status: 'connected' }, { status: 'disconnected' }, { status: 'unknown' }]);
  eq(s.total, 4, 'total'); eq(s.connected, 2, 'connected'); eq(s.disconnected, 1, 'disconnected'); eq(s.unknown, 1, 'unknown'); eq(s.connectedRate, 50, 'rate 2/4'); ok(s.configured, 'configured when tokens exist'); }
{ const s = summarizeConnectivity([{ status: 'unknown' }, { status: 'unknown' }]); ok(!s.configured, 'not configured when all unknown (no tokens)'); eq(s.connectedRate, 0, 'rate 0 when none connected'); }
{ const s = summarizeConnectivity([]); eq(s.total, 0, 'empty total'); eq(s.connectedRate, null, 'null rate when empty'); ok(!s.configured, 'empty not configured'); }

console.log(`workforce-connectivity-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
