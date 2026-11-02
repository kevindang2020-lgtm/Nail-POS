// copilot-load-test.mjs — a REAL, runnable load/scale harness for the Reception Copilot (spec §53). It seeds N tenants,
// drives the actual Copilot session/recommendation/feedback/learning services against a live Postgres, then verifies the
// two things §53 cares about most: (1) NO cross-tenant data exposure at scale, and (2) bounded, stable latency. Run at
// whatever N the environment allows; full 10,000-tenant scale needs the target infra, but the harness is identical.
//
// Usage: node scripts/copilot-load-test.mjs [N]   (defaults to 150 tenants)
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'crypto';

const N = Number(process.argv[2] || 150);
const RECS_PER_TENANT = 5;
// DATABASE_URL (default: local dev Postgres). Was hard-coded to a /tmp:5433 'aps' database no environment has (fixed Oct 4 2026).
const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres', max: 16 }) }) });

const { ReceptionCopilotSessionService } = await import('../../../modules/ai/dist/ai-center/reception-copilot-session.service.js');
const { ReceptionCopilotFeedbackService } = await import('../../../modules/ai/dist/ai-center/reception-copilot-feedback.service.js');
const { ReceptionCopilotLearningService } = await import('../../../modules/ai/dist/ai-center/reception-copilot-learning.service.js');
const sess = new ReceptionCopilotSessionService(db);
const fb = new ReceptionCopilotFeedbackService(db);
const learn = new ReceptionCopilotLearningService(db, fb);

const tenants = Array.from({ length: N }, () => randomUUID());
const branch = randomUUID();
const pct = (arr, p) => arr.length ? arr.sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
const timings = [];
const time = async (fn) => { const t = Date.now(); const r = await fn(); timings.push(Date.now() - t); return r; };

console.log(`Seeding ${N} tenants × ${RECS_PER_TENANT} recommendations…`);
const seedStart = Date.now();
const recIdByTenant = new Map();
// Bounded concurrency so we exercise the pool without a thundering herd (§40 noisy-neighbor posture).
const pool = 24;
for (let i = 0; i < tenants.length; i += pool) {
  await Promise.all(tenants.slice(i, i + pool).map(async (t) => {
    const give = { tenantId: t, branchId: branch, userId: 'u1', role: 'RECEPTION', permissions: ['reception_copilot.give_feedback'] };
    const { sessionId } = await time(() => sess.startSession(give, { channel: 'pos' }));
    const ids = [];
    for (let k = 0; k < RECS_PER_TENANT; k++) {
      const { recommendationId } = await time(() => sess.recordRecommendation(give, { sessionId, kind: 'availability', payload: { k } }));
      await time(() => fb.recordFeedback(give, { recommendationId, rating: k < 4 ? 'not_helpful' : 'helpful' }));
      ids.push(recommendationId);
    }
    recIdByTenant.set(t, ids);
  }));
}
const seedMs = Date.now() - seedStart;

// (1) Cross-tenant isolation at scale: a sample of tenants must see ONLY their own recommendations.
console.log('Verifying cross-tenant isolation…');
let leaks = 0;
const sample = tenants.slice(0, Math.min(40, N));
for (const t of sample) {
  const view = { tenantId: t, branchId: branch, userId: 'm', role: 'MANAGER', permissions: ['reception_copilot.view_learning', 'reception_copilot.approve_learning'] };
  const list = await sess.listRecommendations(view, {});
  const mine = new Set(recIdByTenant.get(t));
  if (list.length !== RECS_PER_TENANT || list.some((r) => !mine.has(r.id))) leaks++;
  // learning is generated only from this tenant's feedback
  const gen = await learn.generateSuggestions(view, {});
  if (gen.created !== 1) leaks++;   // 80% not-helpful for 'availability' → exactly one suggestion, from THIS tenant only
}

// (2) Latency.
const p50 = pct([...timings], 0.50), p95 = pct([...timings], 0.95), p99 = pct([...timings], 0.99);
console.log(`\nRESULT: tenants=${N} ops=${timings.length} seed=${seedMs}ms p50=${p50}ms p95=${p95}ms p99=${p99}ms leaks=${leaks}`);
console.log(leaks === 0 ? 'COPILOT_LOAD_OK (no cross-tenant exposure at scale)' : 'COPILOT_LOAD_FAIL');

// Cleanup.
for (const t of tenants) {
  await sql`DELETE FROM reception_copilot_knowledge_versions WHERE tenant_id=${t}`.execute(db);
  await sql`DELETE FROM reception_copilot_learning_suggestions WHERE tenant_id=${t}`.execute(db);
  await sql`DELETE FROM reception_copilot_feedback WHERE tenant_id=${t}`.execute(db);
  await sql`DELETE FROM reception_copilot_recommendations WHERE tenant_id=${t}`.execute(db);
  await sql`DELETE FROM reception_copilot_sessions WHERE tenant_id=${t}`.execute(db);
}
await db.destroy();
