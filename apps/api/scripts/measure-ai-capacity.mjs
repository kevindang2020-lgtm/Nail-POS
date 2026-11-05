#!/usr/bin/env node
// measure-ai-capacity.mjs — Constitution 10 §45: MEASURED load results for the AI platform.
//
// What this measures and what it does not, stated plainly: the platform's own decision path — safety, routing,
// budget, scheduling, validation — with a deterministic fake provider. It does NOT measure provider latency,
// which is the dominant term in any real AI request and is not ours to characterise. The number that matters
// here is the overhead the platform adds per request, and whether the scheduler stays linear as the queue grows.
import { performance } from 'node:perf_hooks';

const tsx = await import('tsx/esm/api').catch(() => null);
if (tsx) tsx.register();
const { evaluateSafety } = await import('../src/ai/ai-safety-policy.ts');
const { route } = await import('../src/ai/ai-model-router.ts');
const { ProviderCircuitBreakers } = await import('../src/ai/ai-provider-health.ts');
const { AI_TASKS } = await import('../src/ai/ai-task-registry.ts');
const { validate } = await import('../src/ai/ai-output-schemas.ts');
const { evaluateBudget, selectBatch, AiRateLimiter } = await import('../src/ai/ai-budget-scheduler.ts');
const { render, PROMPT_SEED } = await import('../src/ai/ai-prompt-registry.ts');
const { buildContext } = await import('../src/ai/ai-context-builder.ts');

const env = { NODE_ENV: 'production' };
const task = AI_TASKS['review.sentiment_analyze'];
const prompt = PROMPT_SEED.find((p) => p.promptKey === 'review.sentiment_analyze');
const breakers = new ProviderCircuitBreakers();
const OUT = { sentiment: 'negative', theme: 'wait time', confidence: 0.9 };
const budgets = [{ tenantId: 't', scopeKey: '*', period: 'monthly', limitMicroUsd: 10_000_000, atLimitBehavior: 'block_low_priority' }];

const p = (xs, q) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))];
function bench(label, fn, { warm = 200, runs = 2000 } = {}) {
  for (let i = 0; i < warm; i++) fn(i);               // JIT warm-up — the realtime arc's first reading was 60x slow without this
  const xs = [];
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(i); xs.push((performance.now() - t0) * 1000); }
  console.log(`  ${label.padEnd(42)} p50 ${p(xs, .5).toFixed(1).padStart(7)} µs   p95 ${p(xs, .95).toFixed(1).padStart(7)} µs   p99 ${p(xs, .99).toFixed(1).padStart(8)} µs`);
  return p(xs, .5);
}

console.log('AI platform decision-path cost (fake provider; excludes provider latency)\n');
const safety = bench('evaluateSafety', () => evaluateSafety(task.key, { tenant: {} }));
const routing = bench('route (healthy)', () => route(task, { env, health: breakers }));
const budget = bench('evaluateBudget', () => evaluateBudget({ budgets, spendByScope: { '*:monthly': { spentMicroUsd: 1000 } }, module: task.module, priority: 2, estimatedMicroUsd: 50 }));
const ctx = bench('buildContext (1 redacted field)', () => buildContext('t1', [{ name: 'review_text', value: 'Waited 40 minutes, card 4111111111111111 charged twice', dataClass: 'CUSTOMER_PII', maxChars: 4000, untrusted: true }], { maxTotalChars: 24_000 }));
const rend = bench('render prompt', () => render(prompt, { review_text: 'Waited 40 minutes past my appointment.' }));
const val = bench('validate output', () => validate('review.sentiment.v1', OUT));
const total = safety + routing + budget + ctx + rend + val;
console.log(`\n  PLATFORM OVERHEAD PER REQUEST (p50 sum)    ${total.toFixed(1)} µs`);
console.log(`  A provider call is 300–3000 ms, so the platform is ~${(total / 1000 / 500 * 100).toFixed(3)}% of a 500 ms request.`);

console.log('\nScheduler under load (§103 fair-share, growing queue)\n');
for (const n of [100, 1_000, 10_000, 100_000]) {
  const jobs = Array.from({ length: n }, (_, i) => ({ id: `j${i}`, tenantId: `tenant-${i % 50}`, priority: (i % 5), createdAt: i }));
  const warm = 3; for (let i = 0; i < warm; i++) selectBatch(jobs, 50, 5);
  const t0 = performance.now(); const batch = selectBatch(jobs, 50, 5); const ms = performance.now() - t0;
  const tenants = new Set(batch.map((j) => j.tenantId)).size;
  console.log(`  ${String(n).padStart(7)} queued → batch of ${batch.length} in ${ms.toFixed(2)} ms  (${tenants} distinct tenants, max ${Math.max(...[...new Set(batch.map((b) => b.tenantId))].map((t) => batch.filter((b) => b.tenantId === t).length))} per tenant)`);
}

console.log('\nRate limiter (§102)\n');
const rl = new AiRateLimiter();
const rules = (t) => [{ key: `tenant:${t}`, limit: 1_000_000, windowMs: 60_000 }];
bench('rate limit check (1 rule)', (i) => rl.check(rules(`t${i % 1000}`)), { runs: 5000 });

console.log('\nMemory\n');
const before = process.memoryUsage().heapUsed;
const held = Array.from({ length: 20_000 }, (_, i) => ({ id: `j${i}`, tenantId: `tenant-${i % 200}`, priority: i % 5, createdAt: i }));
selectBatch(held, 50, 5);
const after = process.memoryUsage().heapUsed;
console.log(`  20,000 queued job descriptors: ${((after - before) / 1024 / 1024).toFixed(1)} MB (${((after - before) / 20_000).toFixed(0)} B each)`);
console.log('\nCaveat: this measures the platform\'s structures and decisions, not the SSE/HTTP path to a provider.');
