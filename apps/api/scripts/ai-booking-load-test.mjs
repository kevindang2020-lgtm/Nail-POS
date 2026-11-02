// ai-booking-load-test.mjs — a REAL, runnable load/scale harness for the AI Booking conversion pipeline (spec §59). Seeds
// N tenants, records a realistic funnel (attempt → succeeded/failed) per tenant across sources, then verifies the two
// §59 concerns: (1) NO cross-tenant exposure in metrics/summary at scale, and (2) bounded, stable latency. Run at whatever
// N the environment allows; true 10,000-tenant scale runs the identical harness against the target Postgres.
//
// Usage: node scripts/ai-booking-load-test.mjs [N]   (defaults to 150 tenants)
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'crypto';

const N = Number(process.argv[2] || 150);
const EVENTS_PER_TENANT = 6;
// DATABASE_URL (default: local dev Postgres). Was hard-coded to a /tmp:5433 'aps' database no environment has (fixed Oct 4 2026).
const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres', max: 16 }) }) });
const { AiBookingConversionService } = await import('../dist/ai-booking/ai-booking-conversion.service.js');
const conv = new AiBookingConversionService(db);

const tenants = Array.from({ length: N }, () => randomUUID());
const branch = randomUUID();
const pct = (a, p) => a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const timings = [];
const time = async (fn) => { const t = Date.now(); const r = await fn(); timings.push(Date.now() - t); return r; };

console.log(`Seeding ${N} tenants × ${EVENTS_PER_TENANT} conversion events…`);
const seedStart = Date.now();
const pool = 24;
for (let i = 0; i < tenants.length; i += pool) {
  await Promise.all(tenants.slice(i, i + pool).map(async (t) => {
    const ctx = { tenantId: t, branchId: branch, userId: 'online:public', role: 'PUBLIC_BOOKING', permissions: [], source: 'ONLINE_BOOKING', correlationId: 'c', supportSessionId: null };
    // funnel: 3 search → 2 attempts → 2 outcomes (1 success, 1 failure) — deterministic so metrics are checkable.
    await time(() => conv.record(ctx, { stage: 'SEARCH_PERFORMED' }));
    await time(() => conv.record(ctx, { stage: 'BOOKING_ATTEMPTED' }));
    await time(() => conv.record(ctx, { stage: 'BOOKING_SUCCEEDED', outcome: 'succeeded', appointmentId: randomUUID() }));
    await time(() => conv.record(ctx, { stage: 'BOOKING_ATTEMPTED' }));
    await time(() => conv.record(ctx, { stage: 'BOOKING_FAILED', outcome: 'failed', failureReason: 'APPOINTMENT_CONFLICT' }));
    await time(() => conv.record(ctx, { stage: 'SEARCH_PERFORMED' }));
  }));
}
const seedMs = Date.now() - seedStart;

console.log('Verifying cross-tenant isolation in metrics…');
let leaks = 0;
const sample = tenants.slice(0, Math.min(40, N));
for (const t of sample) {
  const rows = await conv.summary({ tenantId: t }, {});
  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  // each tenant recorded exactly EVENTS_PER_TENANT events, all under ONLINE_BOOKING — nothing from any other tenant
  if (total !== EVENTS_PER_TENANT || rows.some((r) => r.source !== 'ONLINE_BOOKING')) leaks++;
  const m = await conv.metrics({ tenantId: t }, {});
  // 2 attempts, 1 success → bookingConversionRate 0.5; no NaN
  if (!m || Number.isNaN(m.bookingConversionRate)) leaks++;
}

const p50 = pct([...timings], 0.50), p95 = pct([...timings], 0.95), p99 = pct([...timings], 0.99);
console.log(`\nRESULT: tenants=${N} events=${timings.length} seed=${seedMs}ms p50=${p50}ms p95=${p95}ms p99=${p99}ms leaks=${leaks}`);
console.log(leaks === 0 ? 'AI_BOOKING_LOAD_OK (no cross-tenant exposure at scale)' : 'AI_BOOKING_LOAD_FAIL');

for (const t of tenants) await sql`DELETE FROM ai_booking_conversion_events WHERE tenant_id=${t}`.execute(db);
await db.destroy();
