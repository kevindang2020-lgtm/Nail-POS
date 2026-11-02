// measure-realtime-capacity.mjs — Constitution 9 §242/§243: per-connection memory, open/close cost, subscription
// leak, and steady-state fan-out, measured in a REAL Node process against the REAL stream factory.
//
//   npm run build && node --expose-gc scripts/measure-realtime-capacity.mjs
//
// Not a test and not a gate: numbers depend on the machine. It exists so "capacity" is a measurement rather than a
// guess, and so a regression (a leak, a fan-out that went superlinear) is one command away. Run it before and after
// any change to the emitter or the factory. WARM UP BEFORE TIMING: the first fan-out call measured 1314µs for 25
// subscribers and 21µs after 50 warm-up calls — a 60x JIT artefact that would have been reported as the real cost.
//
// A real SSE connection also holds an OS socket and Node's HTTP response buffer, which this does not measure:
// treat the per-connection figure as the gateway's own overhead, a floor, not a capacity plan.
import { InProcessEmitter } from '../dist/realtime/realtime.gateway.js';
import { RealtimeStreamFactory } from '../dist/realtime/realtime-stream.js';
import { InMemoryPresenceStore, PresenceService } from '../dist/realtime/presence.js';
import { EVENTS } from '@aipowersalon/realtime-contracts';

const mb = () => { global.gc?.(); return process.memoryUsage().heapUsed / 1048576; };
const bus = new InProcessEmitter();
const presence = new PresenceService(new InMemoryPresenceStore());
const f = new RealtimeStreamFactory(bus, undefined, null, presence);
const ctx = (i) => ({ tenantId: `t-${i % 50}`, branchId: `b-${i % 200}`, userId: `u-${i}`, role: 'FRONT_DESK', permissions: [] });

const base = mb();
const N = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) ?? 5000); const subs = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) subs.push(f.open({ ctx: ctx(i), headers: {} }, () => [`tenant:${ctx(i).tenantId}:branch:${ctx(i).branchId}`]).subscribe(() => {}));
await new Promise((r) => setTimeout(r, 200));
const openMs = Date.now() - t0;
const withConns = mb();
console.log(`open ${N} streams: ${openMs}ms · heap ${base.toFixed(1)} → ${withConns.toFixed(1)} MB · ${(((withConns - base) * 1048576) / N / 1024).toFixed(1)} KB/connection`);
console.log(`presence entries: ${(await presence.platformView()).connections} · subscribers: ${bus.totalSubscribers()}`);

// fan-out: one event to the busiest room
const room = `tenant:t-0:branch:b-0`;
const n = bus.subscriberCount(room);
for (let w = 0; w < 50; w++) bus.toTenant({ tenantId: 't-0', branchId: 'b-0' }, EVENTS.queueUpdated, { x: 1 });   // JIT warm-up
const samples = [];
for (let r = 0; r < 200; r++) { const f0 = process.hrtime.bigint(); bus.toTenant({ tenantId: 't-0', branchId: 'b-0' }, EVENTS.queueUpdated, { x: 1 }); samples.push(Number(process.hrtime.bigint() - f0) / 1000); }
samples.sort((a, b) => a - b);
const p = (q) => samples[Math.floor(samples.length * q)];
console.log(`fan-out to ${n} subscribers (steady state, 200 samples): p50 ${p(0.5).toFixed(0)}µs · p95 ${p(0.95).toFixed(0)}µs · ${(p(0.5) / n).toFixed(1)}µs per subscriber`);

// teardown
const t1 = Date.now();
for (const s of subs) s.unsubscribe();
await new Promise((r) => setTimeout(r, 200));
const after = mb();
console.log(`close ${N}: ${Date.now() - t1}ms · heap → ${after.toFixed(1)} MB · retained ${((after - base) * 1048576 / N).toFixed(0)} B/connection · subscribers ${bus.totalSubscribers()} · presence ${(await presence.platformView()).connections}`);
